"""Small, non-blocking bridge from database writes to connected phones."""

import json
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

log = logging.getLogger(__name__)


def user_group(user_id):
    return f"chat_user_{int(user_id)}"


def publish(user_ids, event, **data):
    """Publish after commit; a Redis outage never rolls back a saved message."""
    recipients = {int(user_id) for user_id in user_ids if user_id}
    payload = {"type": event, **data}

    def send():
        layer = get_channel_layer()
        if layer is None:
            return
        for user_id in recipients:
            try:
                async_to_sync(layer.group_send)(
                    user_group(user_id), {"type": "chat.event", "payload": payload},
                )
            except Exception as exc:
                log.warning(json.dumps({
                    "kind": "network", "name": type(exc).__name__,
                    "message": "Chat realtime publish failed", "app": "KaamKoRecord",
                    "platform": "server", "user_id": user_id,
                }))

    transaction.on_commit(send)


# ---- who is looking at which conversation right now ------------------------
#
# The app says so over its realtime socket while a conversation is open on
# screen (and the app in front), every VIEW_REFRESH seconds; it says it left,
# or the socket closes, when it isn't. A message to somebody looking at that
# conversation needs no notification: it is already on their screen. A mark
# not refreshed lapses after VIEW_TTL, so a phone that dies quietly never
# silences anything for long.

VIEW_TTL = 45


def _view_key(user_id, conversation_id):
    return f"chat:viewing:{int(user_id)}:{conversation_id}"


def mark_viewing(user_id, conversation_id, channel, on=True):
    """This socket (`channel`) has the conversation open, or no longer does."""
    from django.core.cache import cache
    from django.utils import timezone

    key = _view_key(user_id, conversation_id)
    now = timezone.now().timestamp()
    screens = {ch: until for ch, until in (cache.get(key) or {}).items() if until > now}
    if on:
        screens[channel] = now + VIEW_TTL
    else:
        screens.pop(channel, None)
    if screens:
        cache.set(key, screens, timeout=VIEW_TTL)
    else:
        cache.delete(key)


def is_viewing(user_id, conversation_id):
    """Whether any of the person's phones has this conversation open right now."""
    from django.core.cache import cache
    from django.utils import timezone

    now = timezone.now().timestamp()
    return any(until > now for until in (cache.get(_view_key(user_id, conversation_id)) or {}).values())
