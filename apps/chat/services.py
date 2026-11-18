"""
The rules for conversations, in one place: who may see what, who may say
something, and what a group's admins may change. The API (apps/api/views/
conversations.py) only translates requests into these calls.

History policy for groups: the people a group is created with see all of
it; somebody added later sees from the moment they were added
(ConversationMember.history_from), never what was said before them.
"""

import re
import uuid

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.avatars import display_name
from apps.moderation.filter import REFUSED, objectionable
from apps.moderation.models import Block

from .models import (
    MAX_LENGTH, Conversation, ConversationMember, Message, MessageAttachment,
)

GROUP_LIMIT = 50
MENTION = re.compile(r"(?<![\w@])@([A-Za-z0-9_.+-]{1,150})")


class NotAllowed(Exception):
    """The person may not do this here. The API answers 404 or 403."""


# ---- who is in what ----------------------------------------------------------------

def membership(user, conversation_id):
    """The person's membership, or None — also None for a direct thread across a block."""
    try:
        conversation_id = uuid.UUID(str(conversation_id))
    except (TypeError, ValueError):
        return None
    member = (
        ConversationMember.objects.select_related("conversation")
        .filter(conversation_id=conversation_id, user=user).first()
    )
    if member is None:
        return None
    if member.conversation.kind == Conversation.Kind.DIRECT:
        other = direct_other(member.conversation, user)
        if other is None or not other.is_active or Block.between(user, other):
            return None
    return member


def direct_other(conversation, user):
    other = (
        ConversationMember.objects.filter(conversation=conversation).exclude(user=user)
        .select_related("user", "user__profile").first()
    )
    return other.user if other else None


def visible(member):
    """The messages this member can see in their conversation."""
    rows = Message.objects.filter(conversation_id=member.conversation_id).exclude(hidden_for__user_id=member.user_id)
    if member.history_from:
        rows = rows.filter(created_at__gte=member.history_from)
    return rows


def message_for(user, pk):
    """(message, membership) for a message this person can see, or (None, None)."""
    message = Message.objects.select_related("conversation", "reply_to").filter(pk=pk).first()
    if message is None:
        return None, None
    if message.conversation_id is None:
        # Never linked to a conversation (written before conversations existed
        # and somehow missed by the backfill): link it now.
        if message.recipient_id is None:
            return None, None
        if user.pk not in (message.sender_id, message.recipient_id):
            return None, None
        other = message.recipient if message.sender_id == user.pk else message.sender
        message.conversation = Conversation.for_pair(user, other)
        message.save(update_fields=["conversation"])
    member = membership(user, message.conversation_id)
    if member is None or not visible(member).filter(pk=message.pk).exists():
        return None, None
    return message, member


def member_ids(conversation):
    return list(ConversationMember.objects.filter(conversation=conversation).values_list("user_id", flat=True))


# ---- saying something ---------------------------------------------------------------

def clean_body(body, *, required):
    if body is None:
        body = ""
    if not isinstance(body, str):
        raise ValidationError("Write a message using text.")
    body = body.strip()
    if required and not body:
        raise ValidationError("Write something or choose a photo first.")
    if len(body) > MAX_LENGTH:
        raise ValidationError(f"That is too long — keep it under {MAX_LENGTH} characters.")
    if body and objectionable(body):
        raise ValidationError(REFUSED)
    return body


def may_send(member):
    """Raise ValidationError when this member can't write here now."""
    conversation = member.conversation
    if conversation.kind == Conversation.Kind.DIRECT:
        other = direct_other(conversation, member.user)
        if other is None or not Message.can_talk(member.user, other):
            raise ValidationError("You can only message your friends.")
        return other
    blocked = Block.ids_for(member.user)
    if ConversationMember.objects.filter(conversation=conversation, user_id__in=blocked).exists():
        raise ValidationError("You can't send in this group while you have blocked one of its members.")
    return None


def post(member, body="", *, client_id=None, reply_to=None, attachments=(), forwarded=False):
    """
    Say something in a conversation. Idempotent on (sender, client_id): a
    retry returns the message the first try made, with `_was_created`
    False, and keeps no second copy of any attachment.
    """
    sender, conversation = member.user, member.conversation
    attachments = list(attachments)
    body = clean_body(body, required=not attachments)
    if client_id:
        existing = Message.objects.filter(sender=sender, client_id=client_id).first()
        if existing:
            if existing.conversation_id != conversation.pk:
                raise ValidationError("That message could not be retried safely.")
            existing._was_created = False
            return existing
    recipient = may_send(member)
    if reply_to is not None and not visible(member).filter(pk=reply_to.pk).exists():
        raise ValidationError("The message you replied to is no longer available.")
    saved = []
    try:
        with transaction.atomic():
            message = Message(
                conversation=conversation, sender=sender, recipient=recipient, body=body,
                client_id=client_id, reply_to=reply_to, forwarded=forwarded,
            )
            message.save(force_insert=True)
            for item in attachments:
                row = MessageAttachment(
                    message=message, kind=item.kind, content_type=item.content_type,
                    display_name=item.display_name, size=item.size, duration=item.duration,
                    width=item.width, height=item.height, quality=item.quality, waveform=item.waveform,
                )
                row.file.save(item.file.name, item.file, save=False)
                saved.append(row.file)
                if item.poster:
                    row.poster.save(item.poster.name, item.poster, save=False)
                    saved.append(row.poster)
                row.save(force_insert=True)
    except IntegrityError:
        for stored in saved:
            stored.storage.delete(stored.name)
        if not client_id:
            raise
        message = Message.objects.get(sender=sender, client_id=client_id)
        if message.conversation_id != conversation.pk:
            raise ValidationError("That message could not be retried safely.")
        message._was_created = False
        return message
    except Exception:
        for stored in saved:
            try:
                stored.storage.delete(stored.name)
            except Exception:
                pass
        raise
    touch(conversation)
    message._was_created = True
    return message


def touch(conversation):
    """New activity: to the top of everybody's inbox and out of anybody's archive."""
    now = timezone.now()
    Conversation.objects.filter(pk=conversation.pk).update(updated_at=now)
    ConversationMember.objects.filter(conversation=conversation).update(archived_at=None)


def event(conversation, actor, kind, text):
    """A line the group says about itself, e.g. "Asha added Ram"."""
    message = Message.objects.create(conversation=conversation, sender=actor, body=text[:MAX_LENGTH], event=kind)
    touch(conversation)
    return message


def mentioned(member, body):
    """Members named with @username in a group message, never the sender."""
    if member.conversation.kind != Conversation.Kind.GROUP or "@" not in (body or ""):
        return []
    names = {name.lower() for name in MENTION.findall(body)}
    if not names:
        return []
    members = (
        ConversationMember.objects.filter(conversation=member.conversation)
        .exclude(user=member.user).select_related("user")
    )
    return [m.user for m in members if m.user.get_username().lower() in names or ("everyone" in names)]


# ---- reading -------------------------------------------------------------------------

def mark_seen(member, newest):
    """Move the person's delivered and read pointers up to `newest` (never back)."""
    if newest is None:
        return False
    moved = False
    fields = []
    if member.last_read_message_id is None or member.last_read_message_id < newest.pk:
        member.last_read_message = newest
        fields.append("last_read_message")
        moved = True
    if member.last_delivered_message_id is None or member.last_delivered_message_id < newest.pk:
        member.last_delivered_message = newest
        fields.append("last_delivered_message")
    if member.marked_unread:
        member.marked_unread = False
        fields.append("marked_unread")
    if fields:
        member.save(update_fields=fields)
    # Direct threads also keep the per-message stamps the released app reads.
    now = timezone.now()
    incoming = Message.objects.filter(conversation_id=member.conversation_id, pk__lte=newest.pk).exclude(sender=member.user)
    if incoming.filter(delivered_at__isnull=True).update(delivered_at=now):
        moved = True
    if member.conversation.kind == Conversation.Kind.DIRECT:
        if incoming.filter(read_at__isnull=True).update(read_at=now):
            moved = True
    return moved


def mark_delivered(user, message):
    """The phone has the message (it arrived over the realtime stream)."""
    member = membership(user, message.conversation_id)
    if member is None or message.sender_id == user.pk:
        return False
    if member.last_delivered_message_id and member.last_delivered_message_id >= message.pk:
        return False
    member.last_delivered_message = message
    member.save(update_fields=["last_delivered_message"])
    Message.objects.filter(
        conversation_id=member.conversation_id, pk__lte=message.pk, delivered_at__isnull=True,
    ).exclude(sender=user).update(delivered_at=timezone.now())
    return True


def unread_count(member):
    rows = visible(member).exclude(sender_id=member.user_id).filter(event="")
    if member.conversation.kind == Conversation.Kind.DIRECT:
        rows = rows.filter(read_at__isnull=True)
    elif member.last_read_message_id:
        rows = rows.filter(pk__gt=member.last_read_message_id)
    count = rows.count()
    return max(count, 1 if member.marked_unread else 0)


def receipts(conversation, viewer):
    """
    For the viewer's own messages in a group: the lowest read and delivered
    pointers among everybody else, so a message is "read" once all have read it.
    """
    others = ConversationMember.objects.filter(conversation=conversation).exclude(user=viewer)
    pointers = list(others.values_list("last_read_message_id", "last_delivered_message_id"))
    if not pointers:
        return 0, 0
    read = min((r or 0) for r, _ in pointers)
    delivered = min(max(d or 0, r or 0) for r, d in pointers)
    return read, delivered


# ---- groups ------------------------------------------------------------------------------

def _require_admin(member):
    if member.conversation.kind != Conversation.Kind.GROUP:
        raise NotAllowed
    if member.role != ConversationMember.Role.ADMIN:
        raise ValidationError("Only group admins can do that.")


def friends_from(user, usernames):
    if not isinstance(usernames, (list, tuple)):
        raise ValidationError("Choose friends to add.")
    names = {str(name) for name in usernames if isinstance(name, str)}
    people = list(get_user_model().objects.filter(username__in=names, is_active=True))
    if len(people) != len(names):
        raise ValidationError("Some of those people couldn't be found.")
    for person in people:
        if person.pk == user.pk:
            continue
        if not Message.can_talk(user, person):
            raise ValidationError("Groups can only include your friends.")
    return [person for person in people if person.pk != user.pk]


def create_group(creator, title, usernames):
    conversation = Conversation.create_group(creator, title, friends_from(creator, usernames))
    event(conversation, creator, "created", f"{display_name(creator)} created the group")
    return conversation


def add_members(member, usernames):
    _require_admin(member)
    people = friends_from(member.user, usernames)
    if not people:
        raise ValidationError("Choose friends to add.")
    conversation = member.conversation
    existing = set(member_ids(conversation))
    people = [person for person in people if person.pk not in existing]
    if not people:
        raise ValidationError("They are already in this group.")
    if len(existing) + len(people) > GROUP_LIMIT:
        raise ValidationError(f"A group can have up to {GROUP_LIMIT} people.")
    now = timezone.now()
    ConversationMember.objects.bulk_create(
        [ConversationMember(conversation=conversation, user=person, history_from=now) for person in people],
        ignore_conflicts=True,
    )
    names = ", ".join(display_name(person) for person in people)
    event(conversation, member.user, "added", f"{display_name(member.user)} added {names}")
    return people


def remove_member(member, username):
    conversation = member.conversation
    target = ConversationMember.objects.select_related("user").filter(
        conversation=conversation, user__username=username,
    ).first()
    if target is None:
        raise ValidationError("They aren't in this group.")
    if target.user_id == member.user_id:
        return leave(member)
    _require_admin(member)
    target.delete()
    event(conversation, member.user, "removed", f"{display_name(member.user)} removed {display_name(target.user)}")
    return target.user


def leave(member):
    conversation = member.conversation
    if conversation.kind != Conversation.Kind.GROUP:
        raise NotAllowed
    with transaction.atomic():
        was_admin = member.role == ConversationMember.Role.ADMIN
        member.delete()
        rest = ConversationMember.objects.filter(conversation=conversation).order_by("joined_at", "pk")
        if was_admin and not rest.filter(role=ConversationMember.Role.ADMIN).exists():
            heir = rest.first()
            if heir:
                heir.role = ConversationMember.Role.ADMIN
                heir.save(update_fields=["role"])
    if ConversationMember.objects.filter(conversation=conversation).exists():
        event(conversation, member.user, "left", f"{display_name(member.user)} left the group")
    return member.user


def set_role(member, username, role):
    _require_admin(member)
    if role not in ConversationMember.Role.values:
        raise ValidationError("Choose admin or member.")
    target = ConversationMember.objects.select_related("user").filter(
        conversation=member.conversation, user__username=username,
    ).first()
    if target is None:
        raise ValidationError("They aren't in this group.")
    if role == ConversationMember.Role.MEMBER and not ConversationMember.objects.filter(
        conversation=member.conversation, role=ConversationMember.Role.ADMIN,
    ).exclude(pk=target.pk).exists():
        raise ValidationError("A group needs at least one admin.")
    target.role = role
    target.save(update_fields=["role"])
    return target


def rename(member, title):
    _require_admin(member)
    title = (title or "").strip() if isinstance(title, str) else ""
    if not title:
        raise ValidationError("Give the group a name.")
    if len(title) > 100:
        raise ValidationError("Keep the group name under 100 characters.")
    if objectionable(title):
        raise ValidationError(REFUSED)
    conversation = member.conversation
    conversation.title = title
    conversation.save(update_fields=["title", "updated_at"])
    event(conversation, member.user, "renamed", f"{display_name(member.user)} named the group {title}")


def set_photo(member, upload):
    from .media import process_photo

    _require_admin(member)
    conversation = member.conversation
    old = conversation.photo.name if conversation.photo else ""
    if upload is None:
        conversation.photo = ""
    else:
        processed = process_photo(upload, "standard")
        conversation.photo.save(f"{uuid.uuid4().hex}.{processed.file.name.rsplit('.', 1)[-1]}", processed.file, save=False)
    conversation.save(update_fields=["photo", "updated_at"])
    if old:
        conversation.photo.storage.delete(old)
    event(conversation, member.user, "photo", f"{display_name(member.user)} changed the group photo")


def search(member, query, limit=40):
    query = (query or "").strip()[:100]
    if not query:
        return []
    return list(
        visible(member).filter(event="", unsent_at__isnull=True)
        .filter(Q(body__icontains=query) | Q(attachments__display_name__icontains=query))
        .distinct().select_related("sender", "sender__profile")[:limit]
    )
