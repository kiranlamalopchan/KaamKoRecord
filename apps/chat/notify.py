"""A friend wrote to you."""

from datetime import timedelta
from urllib.parse import quote

from django.utils import timezone

from apps.accounts.avatars import display_name
from apps.chat.models import Conversation, ConversationMember, Message
from apps.chat.realtime import is_viewing
from apps.notifications.models import Kind
from apps.notifications.notify import notify


# A burst of messages buzzes once. Later ones in the same chat only rewrite the
# line (newest words, how many are waiting) until the earlier ones are read,
# or the chat has been this quiet for this long since it last buzzed.
CHAT_QUIET = timedelta(minutes=15)


def waiting(recipient_id, conversation, last_read_id=None):
    """How many messages from others in this chat `recipient` hasn't read yet (not "Asha added Ram" lines)."""
    said = Message.objects.filter(conversation=conversation, event="", unsent_at__isnull=True)
    if conversation.kind == Conversation.Kind.DIRECT:
        return said.filter(recipient_id=recipient_id, read_at__isnull=True).count()
    rows = said.exclude(sender_id=recipient_id)
    if last_read_id:
        rows = rows.filter(pk__gt=last_read_id)
    return rows.count()


def quiet_for(count):
    """The first unread message buzzes; the rest wait out CHAT_QUIET."""
    return timedelta(0) if count <= 1 else CHAT_QUIET


def counted(title, count):
    return title if count <= 1 else f"{title} · {count} new messages"


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
    The line is kept to one per conversation (dedupe_key); a burst buzzes once.
    Nobody is told about a message in a conversation they have open on their
    screen right now: they are reading it as it arrives.
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
        if is_viewing(member.user_id, conversation.pk):
            continue
        muted = member.muted_until and member.muted_until > now
        count = waiting(member.user_id, conversation, member.last_read_message_id)
        if member.user_id in mentioned:
            # Being named is always worth a buzz.
            made.append(notify(
                member.user, Kind.MESSAGE, f"{sender} mentioned you in {title}", body=text,
                url=conversation_url(conversation.pk), actor=message.sender,
                dedupe_key=f"chat:{conversation.pk}", renotify_after=timedelta(0),
            ))
        elif not muted:
            made.append(notify(
                member.user, Kind.MESSAGE, counted(title, count), body=f"{sender}: {text}",
                url=conversation_url(conversation.pk), actor=message.sender,
                dedupe_key=f"chat:{conversation.pk}", renotify_after=quiet_for(count),
            ))
    return made


def message_sent(message):
    """
    One line in the inbox per conversation, however many messages are
    waiting in it. The first unread message buzzes; the ones after it only
    rewrite the line ("Noah · 4 new messages", newest words) until they are
    read, or the chat has been quiet for CHAT_QUIET.
    """
    body = message.body if len(message.body) <= 160 else message.body[:157] + "…"
    if not body:
        body = getattr(message, "body_preview", "") or ("Sent a photo" if message.photo else "")
    if message.conversation_id and is_viewing(message.recipient_id, message.conversation_id):
        return None  # it's on their screen as it arrives
    if message.conversation_id and ConversationMember.objects.filter(
        conversation_id=message.conversation_id,
        user=message.recipient,
        muted_until__gt=timezone.now(),
    ).exists():
        return None
    count = waiting(message.recipient_id, message.conversation) if message.conversation_id else 1
    return notify(
        message.recipient, Kind.MESSAGE, counted(display_name(message.sender), count),
        body=body, url=chat_url(message.sender), actor=message.sender,
        dedupe_key=f"chat:{message.conversation_id or message.sender_id}", renotify_after=quiet_for(count),
    )
