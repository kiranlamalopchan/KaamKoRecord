"""Blocking a person and reporting a post — the app's side of apps.moderation."""

from django.contrib.auth import get_user_model
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.moderation import roles
from apps.moderation.models import Block, Kind, Reason, Report
from apps.moderation.services import DISMISS, REPORT_RECEIVED, TAKE_DOWN, is_up, report_target as _target, reported_thing, resolve

from .. import serialize

User = get_user_model()


class BlockPerson(APIView):
    """POST blocks `username`; DELETE unblocks. Either answers with where things stand."""

    def post(self, request, username):
        them = get_object_or_404(User, username=username, is_active=True)
        if them.pk == request.user.pk:
            return Response({"detail": "You can't block yourself."}, status=status.HTTP_400_BAD_REQUEST)
        Block.block(request.user, them)
        return Response({"blocked": True, "detail": f"{them.get_username()} is blocked. You won't see each other's posts."})

    def delete(self, request, username):
        them = get_object_or_404(User, username=username)
        Block.unblock(request.user, them)
        return Response({"blocked": False, "detail": f"{them.get_username()} is unblocked."})


class Blocked(APIView):
    """Everyone you have blocked — the list under Profile."""

    def get(self, request):
        rows = Block.objects.filter(blocker=request.user).select_related("blocked", "blocked__profile")
        return Response({
            "people": [
                {"person": serialize.person(request, b.blocked, request.user), "since": b.created_at.strftime("%-d %b %Y")}
                for b in rows
            ],
        })


class ReportThing(APIView):
    """
    POST {kind, id, reason, note?}: flag a notice, comment, story or person.
    Answers with the reasons it knows about too, so a screen can offer them
    without a second call (GET gives the same list on its own).
    """

    def get(self, request):
        return Response({"reasons": [{"value": v, "label": l} for v, l in Reason.choices]})

    def post(self, request):
        kind = request.data.get("kind") or ""
        pk = str(request.data.get("id") or "")
        if kind not in Kind.values or not pk.isdigit():
            return Response({"detail": "Nothing to report."}, status=status.HTTP_400_BAD_REQUEST)
        target = _target(kind, int(pk))
        who = target if kind == Kind.USER else getattr(target, "author", None)
        if who is not None and who.pk == request.user.pk:
            return Response({"detail": "You can't report your own."}, status=status.HTTP_400_BAD_REQUEST)
        reason = request.data.get("reason") or Reason.OTHER
        if reason not in Reason.values:
            reason = Reason.OTHER
        Report.file(request.user, kind, target, reason, request.data.get("note") or "")
        return Response(
            {"detail": REPORT_RECEIVED},
            status=status.HTTP_201_CREATED,
        )


# ---- running the board: admins choose moderators, moderators answer reports ----

REPORTS_PAGE = 30


class Moderator(APIView):
    """POST makes `username` a moderator; DELETE stops it. Admins only."""

    def _person(self, request, username):
        if not roles.is_admin(request.user):
            raise Http404  # a door only admins need to know is there
        return get_object_or_404(User, username=username, is_active=True)

    def post(self, request, username):
        them = self._person(request, username)
        if them.is_staff:
            return Response({"detail": f"{them.get_username()} is an admin, and admins already moderate."}, status=status.HTTP_400_BAD_REQUEST)
        roles.set_moderator(them, True)
        return Response({"is_moderator": True, "detail": f"{them.get_username()} is now a moderator."})

    def delete(self, request, username):
        them = self._person(request, username)
        if them.is_staff:
            return Response({"detail": f"{them.get_username()} is an admin, and admins always moderate."}, status=status.HTTP_400_BAD_REQUEST)
        roles.set_moderator(them, False)
        return Response({"is_moderator": False, "detail": f"{them.get_username()} is no longer a moderator."})


def report_row(request, report):
    thing = reported_thing(report)
    open_reports = Report.objects.filter(kind=report.kind, target_id=report.target_id, handled_at__isnull=True)
    return {
        "id": report.pk,
        "kind": report.kind,
        "kind_label": report.get_kind_display(),
        "reason": report.reason,
        "reason_label": report.get_reason_display(),
        "note": report.note,
        "excerpt": report.excerpt,
        "reporter": serialize.person(request, report.reporter, request.user),
        "accused": serialize.person(request, report.accused, request.user) if report.accused else None,
        "reports": open_reports.count() if report.handled_at is None else 1,
        "up": is_up(report, thing),
        "can_take_down": report.kind != Kind.USER,
        "created": report.created_at.isoformat(),
        "handled": report.handled_at.isoformat() if report.handled_at else None,
    }


class Reports(APIView):
    """GET ?status=open|handled: what people reported, newest first. Moderators only."""

    def get(self, request):
        if not roles.is_moderator(request.user):
            raise Http404
        handled = request.GET.get("status") == "handled"
        rows = Report.objects.filter(handled_at__isnull=not handled).select_related(
            "reporter", "reporter__profile", "accused", "accused__profile")
        if not handled:
            # One line per reported thing: the newest report of each stands for the rest.
            seen, unique = set(), []
            for report in rows:
                if (report.kind, report.target_id) not in seen:
                    seen.add((report.kind, report.target_id))
                    unique.append(report)
            rows = unique
        page, meta = serialize.page_of(request, rows, REPORTS_PAGE)
        meta.update(results=[report_row(request, r) for r in page],
                    open=Report.objects.filter(handled_at__isnull=True).values("kind", "target_id").distinct().count())
        return Response(meta)


class ReportAction(APIView):
    """POST {action: take_down|dismiss}: answer a report (and every other report of the same thing)."""

    def post(self, request, pk):
        if not roles.is_moderator(request.user):
            raise Http404
        report = get_object_or_404(Report, pk=pk)
        action = request.data.get("action")
        if action not in (TAKE_DOWN, DISMISS):
            return Response({"detail": "Choose take down or dismiss."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            closed = resolve(report, action)
        except ValueError as why:
            return Response({"detail": str(why)}, status=status.HTTP_400_BAD_REQUEST)
        report.refresh_from_db()
        detail = "Taken down." if action == TAKE_DOWN else "Report dismissed."
        return Response({"report": report_row(request, report), "closed": closed, "detail": detail})
