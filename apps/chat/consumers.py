"""Authenticated realtime chat stream using a short-lived, one-use ticket."""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner

from .realtime import user_group

TICKET_AGE = 60
ticket_signer = TimestampSigner(salt="chat-realtime")


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        query = parse_qs(self.scope.get("query_string", b"").decode("utf-8", "ignore"))
        ticket = (query.get("ticket") or [""])[0]
        try:
            payload = ticket_signer.unsign(ticket, max_age=TICKET_AGE)
            user_id, nonce = payload.split(":", 1)
            user_id = int(user_id)
        except (BadSignature, SignatureExpired, TypeError, ValueError):
            await self.close(code=4401)
            return
        if not cache.add(f"chat:ticket:{nonce}", True, timeout=TICKET_AGE):
            await self.close(code=4401)
            return
        if not await self._active_user(user_id):
            await self.close(code=4401)
            return
        self.user_id = user_id
        self.group_name = user_group(user_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected"})

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def chat_event(self, event):
        await self.send_json(event["payload"])

    @database_sync_to_async
    def _active_user(self, user_id):
        return get_user_model().objects.filter(pk=user_id, is_active=True).exists()
