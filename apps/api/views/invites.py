"""Inviting friends and the Champion badge (apps/invites)."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.invites.services import InviteError, record, summary


class Invites(APIView):
    """GET: your code and link, how many you've brought in, and your Champion level."""

    def get(self, request):
        return Response(summary(request.user))


class InvitedBy(APIView):
    """POST {invited_by: invite code}: say who invited you (in your first fortnight, once)."""

    def post(self, request):
        try:
            record(request.user, request.data.get("invited_by") or "")
        except InviteError as why:
            return Response({"invited_by": [str(why)], "detail": str(why)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(summary(request.user))
