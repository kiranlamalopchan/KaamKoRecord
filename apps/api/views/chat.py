"""Messages between friends, for the app. See apps/chat/models.py."""

import mimetypes
import secrets
import uuid
from collections import Counter
from datetime import timedelta
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db.models import Case, F, IntegerField, Q, When, prefetch_related_objects
from django.forms import ImageField
from django.http import FileResponse
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.chat import notify, services
from apps.accounts.models import Friendship
from apps.chat.consumers import ticket_signer
from apps.chat.models import Conversation, ConversationMember, MAX_LENGTH, Message, MessageReaction
from apps.chat.realtime import publish
from apps.moderation.models import Block

from .. import serialize

# A screenful and a bit; older ones are asked for as the thread is scrolled up.
PAGE = 30


REACTIONS = {"👍", "❤️", "😂", "😮", "😢", "🙏"}
MAX_PHOTO = 8 * 1024 * 1024
PHOTO_MAX_AGE = 15 * 60
photo_signer = TimestampSigner(salt="chat-photo")


def message_json(request, message, viewer):
    sent = timezone.localtime(message.created_at)
    reactions = list(message.reactions.all())
    counts = Counter(reaction.emoji for reaction in reactions)
    photo = None
    if message.photo:
        access = photo_signer.sign(f"{message.pk}:{viewer.pk}")
        path = reverse("api:message_photo", args=[message.pk])
        photo = request.build_absolute_uri(f"{path}?{urlencode({'access': access})}")
    reply = None
    if message.reply_to_id:
        original = message.reply_to
        reply = {
            "id": original.pk,
            "body": "" if original.unsent_at else original.body[:180],
            "mine": original.sender_id == viewer.pk,
            "photo": bool(original.photo and not original.unsent_at),
            "unsent": original.unsent_at is not None,
        }
    state = "read" if message.read_at else "delivered" if message.delivered_at else "sent"
    return {
        "id": message.pk,
        "client_id": str(message.client_id) if message.client_id else None,
        "body": message.body,
        "mine": message.sender_id == viewer.pk,
        "at": message.created_at.isoformat(),
        "day": sent.strftime("%a %-d %b"),
        "time": sent.strftime("%-I:%M %p").lower(),
        "read": message.read_at is not None,
        "status": state,
        "edited": message.edited_at is not None,
        "unsent": message.unsent_at is not None,
        "reply": reply,
        "photo": photo,
        "reactions": [{"emoji": emoji, "count": counts[emoji]} for emoji in sorted(counts)],
        "my_reaction": next((reaction.emoji for reaction in reactions if reaction.user_id == viewer.pk), None),
    }


class Threads(APIView):
    """Everyone you have a conversation with, newest first, and how many lines are unread."""

    def get(self, request):
        me = request.user
        threads = Message.threads_for(me)
        prefetch_related_objects([last for _, last, _ in threads], "reactions")
        query = str(request.GET.get("q") or "").strip()[:100].casefold()
        archived = str(request.GET.get("archived") or "") == "1"
        unread_only = str(request.GET.get("unread") or "") == "1"
        message_matches = set()
        if query:
            message_matches = set(
                Message.objects.filter(Q(sender=me) | Q(recipient=me), body__icontains=query)
                .annotate(other_id=Case(
                    When(sender=me, then=F("recipient_id")),
                    default=F("sender_id"), output_field=IntegerField(),
                ))
                .values_list("other_id", flat=True)
            )
        rows = []
        for other, last, unread in threads:
            conversation = last.conversation or Conversation.for_pair(me, other)
            membership, _ = ConversationMember.objects.get_or_create(conversation=conversation, user=me)
            if bool(membership.archived_at) != archived:
                continue
            name = getattr(getattr(other, "profile", None), "name", other.get_username())
            if query and query not in name.casefold() and query not in other.get_username().casefold() and other.pk not in message_matches:
                continue
            unread = max(unread, 1 if membership.marked_unread else 0)
            if unread_only and unread < 1:
                continue
            rows.append((membership.pinned_at is not None, other, last, unread, membership, conversation))
        rows.sort(key=lambda row: (not row[0], -row[2].pk))
        return Response({
            "threads": [
                {
                    "conversation_id": str(conversation.pk),
                    "person": serialize.person(request, other, me),
                    "last": message_json(request, last, me),
                    "unread": unread,
                    "pinned": membership.pinned_at is not None,
                    "muted": bool(membership.muted_until and membership.muted_until > timezone.now()),
                    "archived": membership.archived_at is not None,
                }
                for _, other, last, unread, membership, conversation in rows
            ],
            "unread": sum(row[3] for row in rows),
        })


class Unread(APIView):
    def get(self, request):
        return Response({"unread": Message.unread_count(request.user)})


class Thread(APIView):
    """
    GET: the newest page of a conversation (or the page before ?before=<id>),
    oldest first, and their lines marked read. POST {body}: say something.
    """

    def _other(self, request, username):
        other = get_object_or_404(get_user_model(), username=username, is_active=True)
        # Somebody blocked is somebody who is not there.
        if other.pk == request.user.pk or Block.between(request.user, other):
            return None
        return other

    def get(self, request, username):
        me, other = request.user, self._other(request, username)
        if other is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        conversation = Conversation.for_pair(me, other)
        rows = Message.between(me, other).exclude(hidden_for__user=me).select_related("reply_to").prefetch_related("reactions")
        before = str(request.GET.get("before") or "")
        if before.isascii() and before.isdigit() and len(before) <= 18:
            rows = rows.filter(pk__lt=int(before))
        page = list(rows[: PAGE + 1])
        more = len(page) > PAGE
        page = page[:PAGE]
        now = timezone.now()
        Message.objects.filter(recipient=me, sender=other, delivered_at__isnull=True).update(delivered_at=now)
        read = Message.mark_read(me, other)
        membership, _ = ConversationMember.objects.get_or_create(conversation=conversation, user=me)
        newest = page[0] if page else Message.between(me, other).first()
        membership.marked_unread = False
        membership.last_read_message = newest
        membership.save(update_fields=["marked_unread", "last_read_message"])
        if read:
            publish([other.pk], "receipt.updated", conversation_id=str(conversation.pk))
        return Response({
            "conversation_id": str(conversation.pk),
            "person": serialize.person(request, other, me),
            "can_send": Message.can_talk(me, other),
            "max_length": MAX_LENGTH,
            "messages": [message_json(request, m, me) for m in reversed(page)],
            "more": more,
            "typing": bool(cache.get(f"chat:typing:{other.pk}:{me.pk}")),
        })

    def post(self, request, username):
        me, other = request.user, self._other(request, username)
        if other is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            photo = request.FILES.get("photo")
            if photo and (photo.size > MAX_PHOTO or not str(getattr(photo, "content_type", "")).startswith("image/")):
                return Response({"detail": "Choose an image smaller than 8 MB."}, status=status.HTTP_400_BAD_REQUEST)
            if photo:
                try:
                    photo = ImageField().clean(photo)
                except ValidationError:
                    return Response({"detail": "Choose a valid image smaller than 8 MB."}, status=status.HTTP_400_BAD_REQUEST)
            client_id = request.data.get("client_id") or None
            try:
                client_id = uuid.UUID(str(client_id)) if client_id else None
            except (TypeError, ValueError, AttributeError):
                return Response({"detail": "Please retry that message."}, status=status.HTTP_400_BAD_REQUEST)
            reply_to = None
            if request.data.get("reply_to"):
                reply_id = str(request.data.get("reply_to") or "")
                if not reply_id.isascii() or not reply_id.isdigit() or len(reply_id) > 18:
                    return Response({"detail": "The message you replied to is no longer available."}, status=status.HTTP_400_BAD_REQUEST)
                reply_to = Message.objects.select_related("sender", "recipient").filter(pk=int(reply_id)).first()
                if reply_to is None:
                    return Response({"detail": "The message you replied to is no longer available."}, status=status.HTTP_400_BAD_REQUEST)
            message = Message.send(me, other, request.data.get("body"), photo=photo, client_id=client_id, reply_to=reply_to)
        except ValidationError as why:
            return Response({"detail": " ".join(why.messages)}, status=status.HTTP_400_BAD_REQUEST)
        created = getattr(message, "_was_created", True)
        if created:
            notify.message_sent(message)
            publish([me.pk, other.pk], "message.created", conversation_id=str(message.conversation_id), message_id=message.pk)
        message = Message.objects.select_related("reply_to").prefetch_related("reactions").get(pk=message.pk)
        return Response(message_json(request, message, me), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class Typing(Thread):
    def post(self, request, username):
        other = self._other(request, username)
        if other is None or not Message.can_talk(request.user, other):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        cache.set(f"chat:typing:{request.user.pk}:{other.pk}", True, timeout=8)
        conversation = Conversation.for_pair(request.user, other)
        publish([other.pk], "typing", conversation_id=str(conversation.pk), username=request.user.get_username())
        return Response(status=status.HTTP_204_NO_CONTENT)


class React(APIView):
    def post(self, request, pk):
        message, member = services.message_for(request.user, pk)
        if message is None or message.event or message.unsent_at:
            return Response({"detail": "We couldn't find that message."}, status=status.HTTP_404_NOT_FOUND)
        emoji = str(request.data.get("emoji") or "")
        if emoji not in REACTIONS:
            return Response({"detail": "Choose one of the reactions shown."}, status=status.HTTP_400_BAD_REQUEST)
        existing = MessageReaction.objects.filter(message=message, user=request.user).first()
        if existing and existing.emoji == emoji:
            existing.delete()
        else:
            MessageReaction.objects.update_or_create(message=message, user=request.user, defaults={"emoji": emoji})
        message = Message.objects.select_related("reply_to").prefetch_related("reactions").get(pk=pk)
        publish(services.member_ids(member.conversation), "reaction.updated", conversation_id=str(message.conversation_id), message_id=message.pk)
        return Response(message_json(request, message, request.user))


class MessageDetail(APIView):
    """Edit or unsend your own recent message."""

    def _message(self, request, pk):
        message, member = services.message_for(request.user, pk)
        if message is None or message.sender_id != request.user.pk or message.event:
            raise Http404
        self.audience = services.member_ids(member.conversation)
        if timezone.now() - message.created_at > timedelta(minutes=15) or message.unsent_at:
            return None
        return message

    def patch(self, request, pk):
        message = self._message(request, pk)
        if message is None:
            return Response({"detail": "That message can no longer be edited."}, status=status.HTTP_409_CONFLICT)
        body = request.data.get("body")
        if not isinstance(body, str) or not body.strip():
            return Response({"detail": "Write a message first."}, status=status.HTTP_400_BAD_REQUEST)
        body = body.strip()
        if len(body) > MAX_LENGTH:
            return Response({"detail": f"That is too long — keep it under {MAX_LENGTH} characters."}, status=status.HTTP_400_BAD_REQUEST)
        from apps.moderation.filter import REFUSED, objectionable
        if objectionable(body):
            return Response({"detail": REFUSED}, status=status.HTTP_400_BAD_REQUEST)
        message.body = body
        message.edited_at = timezone.now()
        message.save(update_fields=["body", "edited_at"])
        publish(self.audience, "message.updated", conversation_id=str(message.conversation_id), message_id=message.pk)
        return Response(message_json(request, message, request.user))

    def delete(self, request, pk):
        message = self._message(request, pk)
        if message is None:
            return Response({"detail": "That message can no longer be unsent."}, status=status.HTTP_409_CONFLICT)
        services.remove_message(message, self.audience)
        return Response(message_json(request, message, request.user))


class ConversationSettings(APIView):
    def patch(self, request, conversation_id):
        membership = get_object_or_404(
            ConversationMember, conversation_id=conversation_id, user=request.user,
        )
        now = timezone.now()
        fields = []
        for name in ("pinned", "archived", "muted", "unread"):
            if name in request.data and not isinstance(request.data[name], bool):
                return Response({"detail": "Choose on or off for that setting."}, status=status.HTTP_400_BAD_REQUEST)
        if "pinned" in request.data:
            membership.pinned_at = now if bool(request.data["pinned"]) else None
            fields.append("pinned_at")
        if "archived" in request.data:
            membership.archived_at = now if bool(request.data["archived"]) else None
            fields.append("archived_at")
        if "muted" in request.data:
            membership.muted_until = now + timedelta(days=3650) if bool(request.data["muted"]) else None
            fields.append("muted_until")
        if "unread" in request.data:
            membership.marked_unread = bool(request.data["unread"])
            fields.append("marked_unread")
        if not fields:
            return Response({"detail": "Choose a conversation setting to change."}, status=status.HTTP_400_BAD_REQUEST)
        membership.save(update_fields=fields)
        return Response({
            "conversation_id": str(membership.conversation_id),
            "pinned": membership.pinned_at is not None,
            "archived": membership.archived_at is not None,
            "muted": bool(membership.muted_until and membership.muted_until > now),
            "unread": membership.marked_unread,
        })


class People(APIView):
    """Friends eligible for a new direct conversation."""

    def get(self, request):
        query = str(request.GET.get("q") or "").strip()[:100]
        rows = Friendship.objects.filter(user=request.user, friend__is_active=True).select_related("friend", "friend__profile")
        if query:
            rows = rows.filter(Q(friend__username__icontains=query) | Q(friend__profile__display_name__icontains=query))
        hidden = Block.ids_for(request.user)
        people = [row.friend for row in rows[:30] if row.friend_id not in hidden]
        return Response({"people": [serialize.person(request, person, request.user) for person in people]})


class RealtimeTicket(APIView):
    def post(self, request):
        nonce = secrets.token_urlsafe(18)
        ticket = ticket_signer.sign(f"{request.user.pk}:{nonce}")
        return Response({"ticket": ticket, "expires_in": 60, "path": "/ws/chat/"})


class Photo(APIView):
    """A short-lived participant-only link for one private message photo."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            payload = photo_signer.unsign(str(request.GET.get("access") or ""), max_age=PHOTO_MAX_AGE)
            message_id, viewer_id = (int(part) for part in payload.split(":"))
        except (BadSignature, SignatureExpired, ValueError, TypeError):
            return Response({"detail": "That photo link has expired. Reopen the conversation."}, status=status.HTTP_404_NOT_FOUND)
        message = get_object_or_404(Message.objects.select_related("sender", "recipient").exclude(photo=""), pk=pk)
        if message_id != message.pk or viewer_id not in (message.sender_id, message.recipient_id):
            return Response({"detail": "We couldn't find that photo."}, status=status.HTTP_404_NOT_FOUND)
        if Block.between(message.sender, message.recipient):
            return Response({"detail": "We couldn't find that photo."}, status=status.HTTP_404_NOT_FOUND)
        content_type = mimetypes.guess_type(message.photo.name)[0] or "application/octet-stream"
        response = FileResponse(message.photo.open("rb"), content_type=content_type)
        response["Cache-Control"] = f"private, max-age={PHOTO_MAX_AGE}"
        response["X-Content-Type-Options"] = "nosniff"
        return response
