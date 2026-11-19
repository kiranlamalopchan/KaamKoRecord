"""
The pages and POSTs behind blocking and reporting on the site. Mounted by
the project under /safety/. The app does the same through apps.api.
"""

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from mywork.http import safe_next as _back

from .models import Block, Kind, Reason, Report
from .services import REPORT_RECEIVED, report_target as _target

User = get_user_model()


def _is_fetch(request):
    return request.headers.get("X-Requested-With") == "fetch" or "application/json" in request.headers.get("Accept", "")


def rules(request):
    """The community rules — public, and linked from the way in."""
    return render(request, "moderation/rules.html")


@login_required
@require_POST
def block(request, username):
    them = get_object_or_404(User, username=username, is_active=True)
    if them.pk == request.user.pk:
        return redirect(_back(request, reverse("home")))
    Block.block(request.user, them)
    messages.success(request, f"{them.get_username()} is blocked. You won't see each other's posts, and they can't send you a request.")
    if _is_fetch(request):
        return JsonResponse({"blocked": True})
    return redirect(_back(request, reverse("moderation:blocked")))


@login_required
@require_POST
def unblock(request, username):
    them = get_object_or_404(User, username=username)
    Block.unblock(request.user, them)
    messages.success(request, f"{them.get_username()} is unblocked.")
    if _is_fetch(request):
        return JsonResponse({"blocked": False})
    return redirect(_back(request, reverse("moderation:blocked")))


@login_required
def blocked(request):
    """Everyone you have blocked, each with a way back."""
    rows = Block.objects.filter(blocker=request.user).select_related("blocked", "blocked__profile")
    return render(request, "moderation/blocked.html", {"blocks": rows})


@login_required
def report(request):
    """
    Flag a notice, a comment, a story or a person. GET shows the short
    form; POST files it. `kind` and `id` say what; `reason` and an
    optional `note` say why.
    """
    kind = request.POST.get("kind") or request.GET.get("kind") or ""
    pk = request.POST.get("id") or request.GET.get("id") or ""
    if kind not in Kind.values or not pk.isdigit():
        raise Http404
    target = _target(kind, int(pk))
    who = target if kind == Kind.USER else getattr(target, "author", None)
    if who is not None and who.pk == request.user.pk:
        messages.info(request, "You can't report your own.")
        return redirect(_back(request, reverse("home")))

    if request.method == "POST":
        reason = request.POST.get("reason") or Reason.OTHER
        if reason not in Reason.values:
            reason = Reason.OTHER
        Report.file(request.user, kind, target, reason, request.POST.get("note", ""))
        if _is_fetch(request):
            return JsonResponse({"detail": REPORT_RECEIVED})
        messages.success(request, REPORT_RECEIVED)
        return redirect(_back(request, reverse("home")))

    quoted = ""
    if kind in (Kind.NOTICE, Kind.COMMENT):
        quoted = target.body
    elif kind == Kind.STORY:
        quoted = target.caption
    return render(request, "moderation/report.html", {
        "kind": kind,
        "target": target,
        "quoted": quoted,
        "who": who,
        "reasons": Reason.choices,
        "next": _back(request, reverse("home")),
        "already_blocked": who is not None and Block.is_blocking(request.user, who),
    })


# ---- running the board -------------------------------------------------------------

@login_required
def reports(request):
    """
    What people reported, for moderators: one line per reported thing, with
    Take down and Dismiss. Everyone else gets a 404 — a page only moderators
    use is a page only moderators need to know exists.
    """
    from .roles import is_moderator
    from .services import DISMISS, TAKE_DOWN, is_up, resolve

    if not is_moderator(request.user):
        raise Http404
    if request.method == "POST":
        report = get_object_or_404(Report, pk=request.POST.get("report") or 0)
        action = request.POST.get("action")
        if action not in (TAKE_DOWN, DISMISS):
            messages.error(request, "Choose take down or dismiss.")
        else:
            try:
                resolve(report, action)
                messages.success(request, "Taken down." if action == TAKE_DOWN else "Report dismissed.")
            except ValueError as why:
                messages.error(request, str(why))
        return redirect(f"{reverse('moderation:reports')}?status={request.POST.get('status') or 'open'}")

    handled = request.GET.get("status") == "handled"
    rows = Report.objects.filter(handled_at__isnull=not handled).select_related(
        "reporter", "reporter__profile", "accused", "accused__profile")[:200]
    lines, seen = [], set()
    for report in rows:
        key = (report.kind, report.target_id)
        if not handled and key in seen:
            continue
        seen.add(key)
        count = Report.objects.filter(kind=report.kind, target_id=report.target_id, handled_at__isnull=True).count()
        lines.append({"report": report, "count": count, "up": is_up(report), "can_take_down": report.kind != Kind.USER})
    return render(request, "moderation/reports.html", {"lines": lines, "handled": handled})


@login_required
@require_POST
def moderator(request, username):
    """An admin makes somebody a moderator (on=1) or stops it (on=0)."""
    from .roles import is_admin, set_moderator

    if not is_admin(request.user):
        raise Http404
    them = get_object_or_404(User, username=username, is_active=True)
    if them.is_staff:
        messages.error(request, f"{them.get_username()} is an admin, and admins already moderate.")
    else:
        on = request.POST.get("on") == "1"
        set_moderator(them, on)
        messages.success(request, f"{them.get_username()} is now a moderator." if on else f"{them.get_username()} is no longer a moderator.")
    return redirect(_back(request, reverse("notices:person", args=[them.get_username()])))
