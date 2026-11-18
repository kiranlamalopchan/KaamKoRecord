"""
Conversations for the app, direct and group, keyed by their stable id.

The older username-keyed endpoints in chat.py stay as they are for the app
versions already in the stores; these are what the current app uses. The
rules themselves live in apps/chat/services.py.
"""

import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from urllib.parse import urlencode

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db.models import OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Profile
from apps.chat import media, notify, services
from apps.chat.models import (
    MAX_LENGTH, Conversation, ConversationMember, Message, MessageAttachment, MessageHidden, MessagePin,
)
from apps.chat.realtime import publish
from apps.moderation.models import Block, Kind as ReportKind, Reason, Report
from apps.stories.ranged import ranged_file_response

from .. import serialize
from . import uploads
from .chat import message_json

PAGE = 30
INBOX_PAGE = 25
FILE_AGE = 60 * 60
file_signer = TimestampSigner(salt="chat-attachment")
EPOCH = datetime(1970, 1, 1, tzinfo=dt_timezone.utc)

# Sends per person per minute; attachments count as sends too.
SEND_RATE = 40
FORWARD_TARGETS = 10


def bad(text, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": text}, status=code)


def not_found():
    return bad("We couldn't find that conversation.", status.HTTP_404_NOT_FOUND)


def rate_ok(user, scope, allowed, window=60):
    key = f"chat:rate:{scope}:{user.pk}:{int(timezone.now().timestamp()) // window}"
    if cache.add(key, 1, timeout=window + 5):
        return True
    try:
        return cache.incr(key) <= allowed
    except ValueError:
        return True


def parse_id(raw):
    raw = str(raw or "")
    if raw.isascii() and raw.isdigit() and len(raw) <= 18:
        return int(raw)
    return None


# ---- what goes out -----------------------------------------------------------------

def signed(request, name, args, viewer, **extra):
    access = file_signer.sign(f"{args[0]}:{viewer.pk}")
    path = reverse(f"api:{name}", args=args)
    return request.build_absolute_uri(f"{path}?{urlencode({'access': access, **extra})}")


def attachment_json(request, attachment, viewer):
    url = signed(request, "message_attachment", [attachment.pk], viewer)
    return {
        "id": str(attachment.pk),
        "kind": attachment.kind,
        "url": url,
        "thumb": signed(request, "message_attachment", [attachment.pk], viewer, thumb=1) if attachment.poster else None,
        "download": signed(request, "message_attachment", [attachment.pk], viewer, download=1),
        "name": attachment.safe_name() if attachment.kind == "file" else attachment.display_name,
        "content_type": attachment.content_type,
        "size": attachment.size,
        "duration": attachment.duration,
        "width": attachment.width,
        "height": attachment.height,
        "quality": attachment.quality,
        "waveform": attachment.waveform,
    }


def item_json(request, message, viewer, ctx):
    data = message_json(request, message, viewer)
    data["conversation_id"] = str(message.conversation_id)
    data["sender"] = ctx["people"].get(message.sender_id) or serialize.person(request, message.sender, viewer)
    data["attachments"] = [] if message.unsent_at else [attachment_json(request, a, viewer) for a in message.attachments.all()]
    data["forwarded"] = message.forwarded
    data["event"] = message.event or None
    data["pinned"] = message.pk in ctx["pins"]
    if ctx["group"] and data["mine"]:
        read, delivered = ctx["receipts"]
        data["status"] = "read" if message.pk <= read else "delivered" if message.pk <= delivered else "sent"
        data["read"] = data["status"] == "read"
    if data["reply"] and message.reply_to:
        original = message.reply_to
        data["reply"]["sender"] = (ctx["people"].get(original.sender_id) or {}).get("name", "")
        data["reply"]["attachment"] = None if original.unsent_at else next(
            (a.kind for a in original.attachments.all()), None,
        )
    return data


def context(request, member, messages=()):
    conversation, viewer = member.conversation, member.user
    group = conversation.kind == Conversation.Kind.GROUP
    ids = {m.sender_id for m in messages} | {m.reply_to.sender_id for m in messages if m.reply_to_id and m.reply_to}
    people = {}
    if ids:
        from django.contrib.auth import get_user_model
        for user in get_user_model().objects.filter(pk__in=ids).select_related("profile"):
            people[user.pk] = serialize.person(request, user, viewer)
    pins = set(MessagePin.objects.filter(user=viewer, message__conversation=conversation).values_list("message_id", flat=True))
    return {
        "group": group,
        "people": people,
        "pins": pins,
        "receipts": services.receipts(conversation, viewer) if group else (0, 0),
    }


def messages_query(member):
    return (
        services.visible(member)
        .select_related("sender", "sender__profile", "reply_to", "reply_to__sender")
        .prefetch_related("reactions", "attachments", "reply_to__attachments")
    )


def conversation_json(request, member, *, last=None, unread=None):
    conversation, me = member.conversation, member.user
    now = timezone.now()
    data = {
        "id": str(conversation.pk),
        "kind": conversation.kind,
        "pinned": member.pinned_at is not None,
        "muted": bool(member.muted_until and member.muted_until > now),
        "archived": member.archived_at is not None,
        "role": member.role,
    }
    if conversation.kind == Conversation.Kind.DIRECT:
        other = services.direct_other(conversation, me)
        person = serialize.person(request, other, me)
        data.update({"title": person["name"], "person": person, "photo": person["photo"], "initial": person["initial"], "hue": person["hue"]})
    else:
        title = conversation.title or "Group"
        data.update({
            "title": title,
            "person": None,
            "photo": signed(request, "message_group_photo", [conversation.pk], me) if conversation.photo else None,
            "initial": title[:1].upper(),
            "hue": sum(map(ord, str(conversation.pk))) % 360,
            "member_count": ConversationMember.objects.filter(conversation=conversation).count(),
        })
    if last is not None:
        data["last"] = {
            "id": last.pk,
            "body": "" if last.unsent_at else last.body[:200],
            "mine": last.sender_id == me.pk,
            "sender": Profile.of(last.sender).name if conversation.kind == Conversation.Kind.GROUP and not last.event else "",
            "at": last.created_at.isoformat(),
            "time": timezone.localtime(last.created_at).strftime("%-I:%M %p").lower(),
            "day": timezone.localtime(last.created_at).strftime("%a %-d %b"),
            "unsent": last.unsent_at is not None,
            "event": last.event or None,
            "attachment": None if last.unsent_at else notify.preview(last) if not last.body else None,
            "status": None,
        }
        if last.sender_id == me.pk and not last.event:
            if conversation.kind == Conversation.Kind.GROUP:
                read, delivered = services.receipts(conversation, me)
                data["last"]["status"] = "read" if last.pk <= read else "delivered" if last.pk <= delivered else "sent"
            else:
                data["last"]["status"] = "read" if last.read_at else "delivered" if last.delivered_at else "sent"
    if unread is not None:
        data["unread"] = unread
    return data


# ---- the inbox ------------------------------------------------------------------------

class Inbox(APIView):
    """
    GET: conversations, newest activity first, pinned ones at the top of the
    first page. ?before=<last message id> pages on; ?q= searches names and
    messages; ?unread=1 and ?archived=1 filter.
    POST {username} opens (or makes) the one direct conversation with a friend;
    POST {title, usernames} makes a group.
    """

    def get(self, request):
        me = request.user
        last = Subquery(
            Message.objects.filter(
                conversation_id=OuterRef("conversation_id"),
                created_at__gte=Coalesce(OuterRef("history_from"), Value(EPOCH)),
            ).exclude(hidden_for__user=me).order_by("-pk").values("pk")[:1]
        )
        members = (
            ConversationMember.objects.filter(user=me).select_related("conversation")
            .annotate(last_id=last).filter(last_id__isnull=False)
        )
        archived = str(request.GET.get("archived") or "") == "1"
        members = members.filter(archived_at__isnull=not archived)
        query = str(request.GET.get("q") or "").strip()[:100]
        unread_only = str(request.GET.get("unread") or "") == "1"
        before = parse_id(request.GET.get("before"))
        scanning = bool(query or unread_only)
        if before:
            members = members.filter(last_id__lt=before, pinned_at__isnull=True)
        elif not scanning:
            pinned = list(members.filter(pinned_at__isnull=False).order_by("-pinned_at")[:20])
            members = members.filter(pinned_at__isnull=True)
        rows = list(members.order_by("-last_id")[: 200 if scanning else INBOX_PAGE + 1])
        if not before and not scanning:
            rows = pinned + rows
        more = False
        if not scanning and len(rows) - (0 if before else len(pinned)) > INBOX_PAGE:
            more = True
            rows = rows[:-1]

        # Direct threads with somebody blocked or gone are not shown.
        conversation_ids = [m.conversation_id for m in rows]
        others = {}
        for other in (
            ConversationMember.objects.filter(conversation_id__in=conversation_ids).exclude(user=me)
            .filter(conversation__kind=Conversation.Kind.DIRECT).select_related("user")
        ):
            others[other.conversation_id] = other.user
        hidden = Block.ids_for(me)
        lasts = {
            m.pk: m for m in Message.objects.filter(pk__in=[m.last_id for m in rows])
            .select_related("sender", "sender__profile").prefetch_related("attachments")
        }
        matches = set()
        if query:
            matches = set(
                Message.objects.filter(conversation_id__in=conversation_ids, body__icontains=query, unsent_at__isnull=True, event="")
                .exclude(hidden_for__user=me).values_list("conversation_id", flat=True)
            )
        out = []
        for member in rows:
            conversation = member.conversation
            if conversation.kind == Conversation.Kind.DIRECT:
                other = others.get(conversation.pk)
                if other is None or not other.is_active or other.pk in hidden:
                    continue
                name = Profile.of(other).name
                names = (name.casefold(), other.get_username().casefold())
            else:
                names = ((conversation.title or "").casefold(),)
            if query and not any(query.casefold() in n for n in names) and conversation.pk not in matches:
                continue
            unread = services.unread_count(member)
            if unread_only and unread < 1:
                continue
            out.append(conversation_json(request, member, last=lasts.get(member.last_id), unread=unread))
            if scanning and len(out) >= 50:
                break
        next_cursor = rows[-1].last_id if more and rows else None
        return Response({"conversations": out, "next": next_cursor, "unread": total_unread(me)})

    def post(self, request):
        me = request.user
        try:
            if request.data.get("username"):
                from django.contrib.auth import get_user_model
                other = get_user_model().objects.filter(username=str(request.data["username"]), is_active=True).first()
                if other is None or other.pk == me.pk or not Message.can_talk(me, other):
                    return bad("You can only message your friends.")
                conversation = Conversation.for_pair(me, other)
            else:
                conversation = services.create_group(me, request.data.get("title"), request.data.get("usernames"))
                publish(services.member_ids(conversation), "conversation.updated", conversation_id=str(conversation.pk))
        except ValidationError as why:
            return bad(" ".join(why.messages))
        member = ConversationMember.objects.select_related("conversation").get(conversation=conversation, user=me)
        return Response(conversation_json(request, member), status=status.HTTP_201_CREATED)


def total_unread(user):
    """Across every conversation the person can see, unarchived or not."""
    total = 0
    hidden = Block.ids_for(user)
    for member in ConversationMember.objects.filter(user=user).select_related("conversation"):
        if member.conversation.kind == Conversation.Kind.DIRECT:
            other = services.direct_other(member.conversation, user)
            if other is None or other.pk in hidden or not other.is_active:
                continue
        if member.muted_until and member.muted_until > timezone.now():
            continue
        total += services.unread_count(member)
    return total


class InboxUnread(APIView):
    def get(self, request):
        return Response({"unread": total_unread(request.user)})


# ---- one conversation -------------------------------------------------------------------

def collect_attachments(request):
    """The processed attachments in a send request. Raises ValidationError."""
    quality = "hd" if str(request.data.get("quality") or "") == "hd" else "standard"
    photos = request.FILES.getlist("photos") or request.FILES.getlist("photo")
    if len(photos) > media.limit("photo_batch"):
        raise ValidationError(f"You can send up to {media.limit('photo_batch')} photos at once.")
    processed = [media.process_photo(photo, quality) for photo in photos]
    singles = [(kind, request.FILES.get(kind)) for kind in ("video", "audio", "file") if request.FILES.get(kind)]
    upload_id = str(request.data.get("upload_id") or "")
    if upload_id:
        kind = str(request.data.get("upload_kind") or "")
        if kind not in ("video", "file"):
            raise ValidationError("That upload can't be attached.")
        assembled = uploads.take(request.user, upload_id, media.safe_filename(request.data.get("upload_name")), "")
        if assembled is None:
            raise ValidationError("That upload didn't finish. Please send it again.")
        singles.append((kind, assembled))
    if len(singles) > 1 or (singles and processed):
        raise ValidationError("Send photos, a video, a voice message or a file one kind at a time.")
    for kind, upload in singles:
        if kind == "video":
            processed.append(media.process_video(upload, quality))
        elif kind == "audio":
            processed.append(media.process_audio(upload, request.data.get("waveform")))
        else:
            processed.append(media.process_file(upload))
    return processed


class ConversationView(APIView):
    """
    GET: the newest page (or ?before=<id> older, ?after=<id> newer), oldest
    first, and the conversation marked read. POST: say something, with
    attachments. PATCH: inbox settings for me, and the group's name/photo.
    """

    def get(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        rows = messages_query(member)
        before, after = parse_id(request.GET.get("before")), parse_id(request.GET.get("after"))
        if after:
            page = list(rows.filter(pk__gt=after).order_by("pk")[: PAGE * 4 + 1])
            more_newer = len(page) > PAGE * 4
            page = list(reversed(page[: PAGE * 4]))
            more = None
        else:
            if before:
                rows = rows.filter(pk__lt=before)
            page = list(rows.order_by("-pk")[: PAGE + 1])
            more = len(page) > PAGE
            page = page[:PAGE]
            more_newer = False
        newest = page[0] if page and not before else None
        first_unread = None
        if not before and not after:
            first_unread = self._first_unread(member)
        if newest is not None and services.mark_seen(member, newest):
            publish(services.member_ids(member.conversation), "receipt.updated", conversation_id=str(member.conversation_id))
        ctx = context(request, member, page)
        conversation = member.conversation
        can_send, why_not = True, ""
        try:
            services.may_send(member)
        except ValidationError as why:
            can_send, why_not = False, " ".join(why.messages)
        typing = [
            name for name in (cache.get(f"chat:typing:{conversation.pk}") or {}).keys()
            if name != request.user.get_username()
        ]
        return Response({
            "conversation": conversation_json(request, member),
            "messages": [item_json(request, m, request.user, ctx) for m in reversed(page)],
            "more": more,
            "more_newer": more_newer,
            "first_unread": first_unread,
            "can_send": can_send,
            "why_not": why_not,
            "max_length": MAX_LENGTH,
            "limits": media.public_limits(),
            "typing": typing,
        })

    def _first_unread(self, member):
        rows = services.visible(member).exclude(sender_id=member.user_id).filter(event="")
        if member.conversation.kind == Conversation.Kind.DIRECT:
            rows = rows.filter(read_at__isnull=True)
        elif member.last_read_message_id:
            rows = rows.filter(pk__gt=member.last_read_message_id)
        else:
            return None
        first = rows.order_by("pk").values_list("pk", flat=True).first()
        return first

    def post(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        if not rate_ok(request.user, "send", SEND_RATE):
            return bad("You're sending messages very quickly. Wait a moment and try again.", status.HTTP_429_TOO_MANY_REQUESTS)
        client_id = request.data.get("client_id") or None
        try:
            client_id = uuid.UUID(str(client_id)) if client_id else None
        except (TypeError, ValueError, AttributeError):
            return bad("Please retry that message.")
        if client_id:
            # A retry of something already saved answers before any file is processed again.
            existing = Message.objects.filter(sender=request.user, client_id=client_id).first()
            if existing and existing.conversation_id == member.conversation_id:
                return self._answer(request, member, existing, created=False)
        reply_to = None
        if request.data.get("reply_to"):
            reply_id = parse_id(request.data.get("reply_to"))
            reply_to = services.visible(member).filter(pk=reply_id).first() if reply_id else None
            if reply_to is None:
                return bad("The message you replied to is no longer available.")
        upload_id = str(request.data.get("upload_id") or "")
        try:
            attachments = collect_attachments(request)
            message = services.post(member, request.data.get("body"), client_id=client_id, reply_to=reply_to, attachments=attachments)
        except ValidationError as why:
            return bad(" ".join(why.messages))
        finally:
            if upload_id:
                uploads.discard(request.user, upload_id)
        created = getattr(message, "_was_created", True)
        if created:
            deliver(message, member)
        return self._answer(request, member, message, created)

    def _answer(self, request, member, message, created):
        message = messages_query(member).get(pk=message.pk)
        data = item_json(request, message, request.user, context(request, member, [message]))
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def patch(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        now = timezone.now()
        fields = []
        for name in ("pinned", "archived", "muted", "unread"):
            if name in request.data and not isinstance(request.data[name], bool):
                return bad("Choose on or off for that setting.")
        if "pinned" in request.data:
            member.pinned_at = now if request.data["pinned"] else None
            fields.append("pinned_at")
        if "archived" in request.data:
            member.archived_at = now if request.data["archived"] else None
            fields.append("archived_at")
        if "muted" in request.data:
            member.muted_until = now + timedelta(days=3650) if request.data["muted"] else None
            fields.append("muted_until")
        if "unread" in request.data:
            member.marked_unread = request.data["unread"]
            fields.append("marked_unread")
        if fields:
            member.save(update_fields=fields)
        try:
            if "title" in request.data:
                services.rename(member, request.data.get("title"))
            if "photo" in request.FILES:
                services.set_photo(member, request.FILES["photo"])
            elif request.data.get("remove_photo") in (True, "1", "true"):
                services.set_photo(member, None)
        except services.NotAllowed:
            return bad("That only applies to groups.")
        except ValidationError as why:
            return bad(" ".join(why.messages))
        if not fields and not ({"title", "remove_photo"} & set(request.data.keys())) and "photo" not in request.FILES:
            return bad("Choose a conversation setting to change.")
        if {"title", "photo", "remove_photo"} & (set(request.data.keys()) | set(request.FILES.keys())):
            publish(services.member_ids(member.conversation), "conversation.updated", conversation_id=str(member.conversation_id))
        member.refresh_from_db()
        return Response(conversation_json(request, member))

    def delete(self, request, conversation_id):
        """Hide the whole conversation from my inbox (others keep it); groups: leave."""
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        if member.conversation.kind == Conversation.Kind.GROUP and str(request.GET.get("leave") or "") == "1":
            ids = services.member_ids(member.conversation)
            services.leave(member)
            publish(ids, "conversation.updated", conversation_id=str(member.conversation_id))
            return Response(status=status.HTTP_204_NO_CONTENT)
        ids = list(services.visible(member).values_list("pk", flat=True))
        MessageHidden.objects.bulk_create(
            [MessageHidden(message_id=pk, user=request.user) for pk in ids], ignore_conflicts=True,
        )
        member.pinned_at = None
        member.marked_unread = False
        member.save(update_fields=["pinned_at", "marked_unread"])
        return Response(status=status.HTTP_204_NO_CONTENT)


def deliver(message, member):
    """After a new message: notifications, then the realtime nudge to every member's phones."""
    mentions = services.mentioned(member, message.body)
    notify.message_posted(message, mentions)
    publish(
        services.member_ids(member.conversation), "message.created",
        conversation_id=str(member.conversation_id), message_id=message.pk,
        client_id=str(message.client_id) if message.client_id else None,
    )


class ConversationTyping(APIView):
    def post(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        key = f"chat:typing:{member.conversation_id}"
        typing = cache.get(key) or {}
        now = timezone.now().timestamp()
        typing = {name: at for name, at in typing.items() if now - at < 8}
        typing[request.user.get_username()] = now
        cache.set(key, typing, timeout=8)
        ids = [pk for pk in services.member_ids(member.conversation) if pk != request.user.pk]
        publish(ids, "typing", conversation_id=str(member.conversation_id), username=request.user.get_username(),
                name=Profile.of(request.user).name)
        return Response(status=status.HTTP_204_NO_CONTENT)


class Members(APIView):
    """GET the members; POST {usernames} to add (admins); DELETE …/<username>/ to remove or leave; PATCH {role}."""

    def get(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        rows = (
            ConversationMember.objects.filter(conversation=member.conversation)
            .select_related("user", "user__profile").order_by("-role", "joined_at")
        )
        return Response({"members": [
            {**serialize.person(request, row.user, request.user), "role": row.role}
            for row in rows
        ]})

    def post(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        try:
            services.add_members(member, request.data.get("usernames"))
        except services.NotAllowed:
            return bad("You can only add people to a group.")
        except ValidationError as why:
            return bad(" ".join(why.messages))
        publish(services.member_ids(member.conversation), "conversation.updated", conversation_id=str(member.conversation_id))
        return self.get(request, conversation_id)

    def delete(self, request, conversation_id, username):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        ids = services.member_ids(member.conversation)
        try:
            services.remove_member(member, username)
        except services.NotAllowed:
            return bad("That only applies to groups.")
        except ValidationError as why:
            return bad(" ".join(why.messages))
        publish(ids, "conversation.updated", conversation_id=str(member.conversation_id))
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request, conversation_id, username):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        try:
            services.set_role(member, username, str(request.data.get("role") or ""))
        except services.NotAllowed:
            return bad("That only applies to groups.")
        except ValidationError as why:
            return bad(" ".join(why.messages))
        return self.get(request, conversation_id)


class Gallery(APIView):
    """Shared photos, videos, voice messages, files or links, newest first. ?kind=&before=<attachment created iso>."""

    def get(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        kind = str(request.GET.get("kind") or "photo")
        visible_ids = services.visible(member).filter(unsent_at__isnull=True)
        if kind == "link":
            rows = list(visible_ids.filter(Q(body__icontains="http://") | Q(body__icontains="https://")).order_by("-pk")[:60])
            import re
            links = []
            for message in rows:
                for url in re.findall(r"https?://[^\s<>\"]+", message.body):
                    links.append({"url": url[:500], "message_id": message.pk, "at": message.created_at.isoformat()})
            return Response({"items": links[:100], "next": None})
        if kind not in MessageAttachment.Kind.values:
            return bad("Choose photos, videos, voice messages, files or links.")
        rows = MessageAttachment.objects.filter(message__in=visible_ids, kind=kind).select_related("message")
        before = parse_id(request.GET.get("before"))
        if before:
            rows = rows.filter(message_id__lt=before)
        rows = list(rows.order_by("-message_id", "-created_at")[:61])
        more = len(rows) > 60
        rows = rows[:60]
        return Response({
            "items": [{**attachment_json(request, a, request.user), "message_id": a.message_id, "at": a.created_at.isoformat()} for a in rows],
            "next": rows[-1].message_id if more else None,
        })


class Search(APIView):
    def get(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        found = services.search(member, request.GET.get("q"))
        return Response({"results": [
            {
                "id": m.pk, "body": m.body[:200], "mine": m.sender_id == request.user.pk,
                "sender": Profile.of(m.sender).name, "at": m.created_at.isoformat(),
                "day": timezone.localtime(m.created_at).strftime("%a %-d %b"),
            } for m in found
        ]})


class Pins(APIView):
    def get(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        pinned = list(
            messages_query(member).filter(pins__user=request.user, unsent_at__isnull=True).order_by("-pins__pinned_at")[:50]
        )
        ctx = context(request, member, pinned)
        return Response({"messages": [item_json(request, m, request.user, ctx) for m in pinned]})


class Read(APIView):
    """POST {message_id}: I've seen up to here (the thread was open when it arrived)."""

    def post(self, request, conversation_id):
        member = services.membership(request.user, conversation_id)
        if member is None:
            return not_found()
        message_id = parse_id(request.data.get("message_id"))
        newest = services.visible(member).filter(pk=message_id).first() if message_id else None
        if newest is None:
            return bad("That message is no longer available.")
        if services.mark_seen(member, newest):
            publish(services.member_ids(member.conversation), "receipt.updated", conversation_id=str(member.conversation_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---- one message -----------------------------------------------------------------------------

def _message_or_404(request, pk):
    message, member = services.message_for(request.user, pk)
    return message, member


class Delivered(APIView):
    def post(self, request, pk):
        message, member = _message_or_404(request, pk)
        if message is None:
            return bad("We couldn't find that message.", status.HTTP_404_NOT_FOUND)
        if services.mark_delivered(request.user, message):
            publish([message.sender_id], "receipt.updated", conversation_id=str(message.conversation_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class Hide(APIView):
    """Delete for me: gone from my side, untouched on everybody else's."""

    def post(self, request, pk):
        message, member = _message_or_404(request, pk)
        if message is None:
            return bad("We couldn't find that message.", status.HTTP_404_NOT_FOUND)
        MessageHidden.objects.get_or_create(message=message, user=request.user)
        MessagePin.objects.filter(message=message, user=request.user).delete()
        publish([request.user.pk], "message.hidden", conversation_id=str(message.conversation_id), message_id=message.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class Pin(APIView):
    """Toggle a pin on a message, for me."""

    def post(self, request, pk):
        message, member = _message_or_404(request, pk)
        if message is None or message.event:
            return bad("We couldn't find that message.", status.HTTP_404_NOT_FOUND)
        existing = MessagePin.objects.filter(message=message, user=request.user)
        if existing.exists():
            existing.delete()
            pinned = False
        else:
            if MessagePin.objects.filter(user=request.user, message__conversation_id=message.conversation_id).count() >= 50:
                return bad("You can pin up to 50 messages in a conversation.")
            MessagePin.objects.create(message=message, user=request.user)
            pinned = True
        return Response({"pinned": pinned})


class Forward(APIView):
    """POST {conversation_ids: [...]}: the same words and attachments, sent again by me."""

    def post(self, request, pk):
        message, member = _message_or_404(request, pk)
        if message is None or message.unsent_at or message.event:
            return bad("That message can't be forwarded.", status.HTTP_404_NOT_FOUND)
        targets = request.data.get("conversation_ids")
        if not isinstance(targets, list) or not targets:
            return bad("Choose who to forward it to.")
        if len(targets) > FORWARD_TARGETS:
            return bad(f"You can forward to up to {FORWARD_TARGETS} conversations at once.")
        if not rate_ok(request.user, "send", SEND_RATE - len(targets)):
            return bad("You're sending messages very quickly. Wait a moment and try again.", status.HTTP_429_TOO_MANY_REQUESTS)
        sent, failed = [], []
        for target_id in targets:
            target = services.membership(request.user, target_id)
            if target is None:
                failed.append(str(target_id))
                continue
            copies = []
            for attachment in message.attachments.all():
                with attachment.file.open("rb") as f:
                    data = f.read()
                poster = None
                if attachment.poster:
                    with attachment.poster.open("rb") as p:
                        poster = media.ContentFile(p.read(), name=attachment.poster.name.rsplit("/", 1)[-1])
                copies.append(media.Processed(
                    kind=attachment.kind, file=media.ContentFile(data, name=attachment.file.name.rsplit("/", 1)[-1]),
                    content_type=attachment.content_type, display_name=attachment.display_name, poster=poster,
                    duration=attachment.duration, width=attachment.width, height=attachment.height,
                    quality=attachment.quality, waveform=attachment.waveform,
                ))
            try:
                copy = services.post(target, message.body, attachments=copies, forwarded=True)
            except ValidationError:
                failed.append(str(target_id))
                continue
            deliver(copy, target)
            sent.append(str(target_id))
        if not sent:
            return bad("That message couldn't be forwarded. Check you can still message them.")
        return Response({"sent": sent, "failed": failed})


class ReportMessage(APIView):
    """
    Report a message. What is sent to the moderators is the reported message
    itself (the reporter's own copy) — never the rest of the conversation.
    """

    def post(self, request, pk):
        message, member = _message_or_404(request, pk)
        if message is None or message.sender_id == request.user.pk or message.event:
            return bad("We couldn't find that message.", status.HTTP_404_NOT_FOUND)
        reason = str(request.data.get("reason") or Reason.OTHER)
        if reason not in Reason.values:
            return bad("Choose a reason.")
        Report.file(request.user, ReportKind.MESSAGE, message, reason, str(request.data.get("note") or "")[:300])
        return Response({"reported": True}, status=status.HTTP_201_CREATED)


# ---- files --------------------------------------------------------------------------------------

def _unsigned(request, pk):
    try:
        payload = file_signer.unsign(str(request.GET.get("access") or ""), max_age=FILE_AGE)
        target, viewer_id = payload.rsplit(":", 1)
        return target, int(viewer_id)
    except (BadSignature, SignatureExpired, ValueError, TypeError):
        return None, None


class AttachmentFile(APIView):
    """
    A short-lived link to one attachment, checked again on every request:
    the viewer must still be in the conversation and still able to see the
    message. Ranges are answered, which video players need.
    """

    permission_classes = [AllowAny]

    def get(self, request, pk):
        target, viewer_id = _unsigned(request, pk)
        gone = Response({"detail": "That link has expired. Reopen the conversation."}, status=status.HTTP_404_NOT_FOUND)
        if target != str(pk):
            return gone
        attachment = MessageAttachment.objects.select_related("message").filter(pk=pk).first()
        if attachment is None or attachment.message.unsent_at:
            return gone
        from django.contrib.auth import get_user_model
        viewer = get_user_model().objects.filter(pk=viewer_id, is_active=True).first()
        if viewer is None or services.message_for(viewer, attachment.message_id)[0] is None:
            return gone
        field = attachment.poster if request.GET.get("thumb") and attachment.poster else attachment.file
        content_type = attachment.content_type if field == attachment.file else (
            "image/webp" if field.name.endswith(".webp") else "image/jpeg"
        )
        response = ranged_file_response(request, field.path, content_type)
        response["Cache-Control"] = f"private, max-age={FILE_AGE}"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        if attachment.kind == "file" or request.GET.get("download"):
            from django.utils.http import content_disposition_header
            response["Content-Disposition"] = content_disposition_header(True, attachment.safe_name() if attachment.kind == "file" else field.name.rsplit("/", 1)[-1])
        return response

    head = get


class GroupPhoto(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk):
        target, viewer_id = _unsigned(request, pk)
        if target != str(pk):
            return not_found()
        conversation = get_object_or_404(Conversation, pk=pk)
        if not conversation.photo or not ConversationMember.objects.filter(conversation=conversation, user_id=viewer_id).exists():
            return not_found()
        content_type = "image/webp" if conversation.photo.name.endswith(".webp") else "image/jpeg"
        response = ranged_file_response(request, conversation.photo.path, content_type)
        response["Cache-Control"] = f"private, max-age={FILE_AGE}"
        response["X-Content-Type-Options"] = "nosniff"
        return response
