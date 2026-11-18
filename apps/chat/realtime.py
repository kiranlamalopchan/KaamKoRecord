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
