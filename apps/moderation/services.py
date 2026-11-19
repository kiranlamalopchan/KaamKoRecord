"""Reporting rules shared by the website and API."""

from django.contrib.auth import get_user_model
from django.http import Http404
from django.shortcuts import get_object_or_404

from .models import Kind

REPORT_RECEIVED = "Thanks — it's been reported and will be reviewed within 24 hours."

TAKE_DOWN, DISMISS = "take_down", "dismiss"


def reported_thing(report):
    """What a report is about, or None if it is already gone."""
    from apps.chat.models import Message
    from apps.noticeboard.models import Comment, Notice
    from apps.stories.models import Story

    model = {
        Kind.NOTICE: Notice, Kind.COMMENT: Comment, Kind.STORY: Story,
        Kind.MESSAGE: Message, Kind.USER: get_user_model(),
    }.get(report.kind)
    return model.objects.filter(pk=report.target_id).first() if model else None


def is_up(report, thing=None):
    """Whether what was reported can still be seen."""
    thing = thing if thing is not None else reported_thing(report)
    if thing is None:
        return False
    if report.kind == Kind.MESSAGE:
        return thing.unsent_at is None
    if report.kind == Kind.USER:
        return thing.is_active
    return not getattr(thing, "hidden", False)


def resolve(report, action):
    """
    A moderator's answer to a report, applied to every open report of the
    same thing. Taking it down hides a notice, comment or story from everyone
    (an admin can bring it back in the admin) and removes a message as unsend
    does. Dismissing marks the reports handled and brings back anything the
    reports had hidden on their own. A person can only be dismissed here.
    Returns how many reports were closed.
    """
    from django.utils import timezone
    from .models import Report

    if action not in (TAKE_DOWN, DISMISS):
        raise ValueError("Choose take down or dismiss.")
    if action == TAKE_DOWN and report.kind == Kind.USER:
        raise ValueError("A person can't be taken down here. Dismiss the report, or ask an admin.")
    thing = reported_thing(report)
    if thing is not None:
        if report.kind == Kind.MESSAGE:
            if action == TAKE_DOWN and thing.unsent_at is None:
                from apps.chat.services import remove_message
                remove_message(thing)
        elif report.kind != Kind.USER and hasattr(thing, "hidden"):
            hide = action == TAKE_DOWN
            if thing.hidden != hide:
                thing.hidden = hide
                thing.save(update_fields=["hidden"])
    return Report.objects.filter(kind=report.kind, target_id=report.target_id, handled_at__isnull=True).update(
        handled_at=timezone.now())


def report_target(kind, pk):
    from apps.noticeboard.models import Comment, Notice
    from apps.stories.models import Story

    model = {
        Kind.NOTICE: Notice, Kind.COMMENT: Comment,
        Kind.STORY: Story, Kind.USER: get_user_model(),
    }.get(kind)
    if model is None:
        raise Http404
    return get_object_or_404(model, pk=pk)
