"""A friend wrote to you."""

from datetime import timedelta
from urllib.parse import quote

from django.utils import timezone

from apps.accounts.avatars import display_name
from apps.chat.models import Conversation, ConversationMember
from apps.notifications.models import Kind
from apps.notifications.notify import notify


def chat_url(user):
    """The profile page on the site, the conversation in the app (mobile/src/nav/paths.ts)."""
    return f"/profile/?chat={quote(user.get_username())}"


def conversation_url(conversation_id):
    """The conversation in the app (mobile/src/nav/paths.ts); the site shows the profile page."""
    return f"/profile/?conversation={conversation_id}"


def preview(message):
    """What a notification says: the words, or what was attached — never a file name."""
    body = message.body if len(message.body) <= 160 else message.body[:157] + "…"
    if body:
        return body
    kinds = [attachment.kind for attachment in message.attachments.all()]
    if not kinds:
        return "Sent a photo" if message.photo else ""
    if all(kind == "photo" for kind in kinds):
        return "Sent a photo" if len(kinds) == 1 else f"Sent {len(kinds)} photos"
    return {
        "video": "Sent a video", "audio": "Sent a voice message", "file": "Sent a file",
    }.get(kinds[0], "Sent an attachment")


def message_posted(message, mentions=()):
    """
    Everybody else in the conversation hears about it, except where they
    muted it — and a mention gets through a mute, which is what it is for.
    The line is kept to one per conversation (dedupe_key) but buzzes each time.
    """
    conversation = message.conversation
    if conversation is None:
        return []
    if conversation.kind == Conversation.Kind.DIRECT:
        if message.recipient_id:
            if not message.body:
                message.body_preview = preview(message)
            return [message_sent(message)]
        return []
    mentioned = {user.pk for user in mentions}
    now = timezone.now()
    members = (
        ConversationMember.objects.filter(conversation=conversation)
        .exclude(user_id=message.sender_id).select_related("user")
    )
    sender = display_name(message.sender)
    title = conversation.title or "Group"
    text = preview(message)
    made = []
    for member in members:
        muted = member.muted_until and member.muted_until > now
        if member.user_id in mentioned:
            made.append(notify(
                member.user, Kind.MESSAGE, f"{sender} mentioned you in {title}", body=text,
                url=conversation_url(conversation.pk), actor=message.sender,
                dedupe_key=f"chat:{conversation.pk}", renotify_after=timedelta(0),
            ))
        elif not muted:
            made.append(notify(
                member.user, Kind.MESSAGE, title, body=f"{sender}: {text}",
                url=conversation_url(conversation.pk), actor=message.sender,
                dedupe_key=f"chat:{conversation.pk}", renotify_after=timedelta(0),
            ))
    return made


def message_sent(message):
    """
    One line in the inbox per conversation, however many messages are
    waiting in it — and a buzz for each, which is what a zero-length quiet
    window asks for: the line is rewritten, and said out loud again.
    """
    body = message.body if len(message.body) <= 160 else message.body[:157] + "…"
    if not body:
        body = getattr(message, "body_preview", "") or ("Sent a photo" if message.photo else "")
    if message.conversation_id and ConversationMember.objects.filter(
        conversation_id=message.conversation_id,
        user=message.recipient,
        muted_until__gt=timezone.now(),
    ).exists():
        return None
    return notify(
        message.recipient, Kind.MESSAGE, display_name(message.sender),
        body=body, url=chat_url(message.sender), actor=message.sender,
        dedupe_key=f"chat:{message.conversation_id or message.sender_id}", renotify_after=timedelta(0),
    )
