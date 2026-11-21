"""
Invites and the Champion badge.

- `record(invited, text)`: link a new person to whoever invited them, by the
  inviter's invite code — at sign-up, or within CLAIM_DAYS after. Only the
  code: usernames are never passed around for this.
- `activate(user)`: they started using the app (first workplace or shift);
  from now on the invite counts, and the inviter hears about it — and about
  any level it takes them to.
- Levels: Bronze Champion at 10 people who use the app, Silver at 25, Gold at 50.
- `champion(user)`: the level beside somebody's name, from a short-lived
  cache, because it is asked for every name on a page.
"""

from datetime import timedelta

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from .models import InviteCode, Invitation

LEVELS = (("gold", 50), ("silver", 25), ("bronze", 10))
LEVEL_NAMES = {"bronze": "Bronze Champion", "silver": "Silver Champion", "gold": "Gold Champion"}
LEVEL_EMOJI = {"bronze": "🥉", "silver": "🥈", "gold": "🥇"}
# How long after joining somebody can still say who invited them.
CLAIM_DAYS = 14
INVITE_LINK = "https://kaamkorecord.com/get/?src=invite&ref={code}"

_LEVELS_KEY = "invites:champion-levels"
_LEVELS_FOR = 300


class InviteError(Exception):
    """Said to the person as it is: written for them."""


def level_for(count):
    for level, needed in LEVELS:
        if count >= needed:
            return level
    return None


def next_level(count):
    """(level, how many it needs) for the next level up, or (None, None) at the top."""
    for level, needed in reversed(LEVELS):
        if count < needed:
            return level, needed
    return None, None


def find_inviter(text):
    """The active person an invite code belongs to, or None."""
    text = (text or "").strip()
    if not text:
        return None
    by_code = InviteCode.objects.filter(code__iexact=text.replace(" ", "").replace("-", "")).select_related("user").first()
    return by_code.user if by_code and by_code.user.is_active else None


def check(invited, text):
    """The inviter `text` names, if `invited` may say so; InviteError if not."""
    inviter = find_inviter(text)
    if inviter is None:
        raise InviteError("We couldn't find that invite code. Check it and try again.")
    if invited is not None:
        if inviter.pk == invited.pk:
            raise InviteError("You can't invite yourself.")
        if Invitation.objects.filter(invited=invited).exists():
            raise InviteError("You've already said who invited you.")
        if invited.date_joined < timezone.now() - timedelta(days=CLAIM_DAYS):
            raise InviteError(f"Who invited you can only be added in your first {CLAIM_DAYS} days.")
        if inviter.date_joined > invited.date_joined:
            raise InviteError("They joined after you, so they couldn't have invited you.")
    return inviter


def record(invited, text):
    """Link `invited` to their inviter. Returns the Invitation; InviteError if it can't be."""
    inviter = check(invited, text)
    try:
        with transaction.atomic():
            invitation = Invitation.objects.create(inviter=inviter, invited=invited)
    except IntegrityError:
        raise InviteError("You've already said who invited you.")
    if _has_started(invited):
        activate(invited)
    return invitation


def _has_started(user):
    return user.workplaces.exists() or user.shifts.exists()


def activated_count(user):
    return Invitation.objects.filter(inviter=user, active_at__isnull=False).count()


def activate(user):
    """`user` started using the app: their invite (if any) counts from now."""
    invitation = Invitation.objects.filter(invited=user, active_at__isnull=True).select_related("inviter", "invited").first()
    if invitation is None:
        return
    updated = Invitation.objects.filter(pk=invitation.pk, active_at__isnull=True).update(active_at=timezone.now())
    if not updated:
        return
    cache.delete(_LEVELS_KEY)
    _tell_inviter(invitation)


def _tell_inviter(invitation):
    from apps.accounts.avatars import display_name
    from apps.notifications.models import Kind
    from apps.notifications.notify import notify

    inviter, invited = invitation.inviter, invitation.invited
    count = activated_count(inviter)
    level = level_for(count)
    reached = level if level and dict(LEVELS)[level] == count else None
    upcoming, needed = next_level(count)
    progress = f"{count} of {needed} for {LEVEL_NAMES[upcoming]}." if upcoming else f"{count} people so far."
    notify(
        inviter, Kind.FRIEND_ACCEPTED,
        f"{display_name(invited)} started using KaamKoRecord with your invite",
        body=progress, url="/profile#invite", actor=invited, dedupe_key=f"invite-joined-{invitation.pk}",
    )
    if reached:
        notify(
            inviter, Kind.FRIEND_ACCEPTED, f"You're a {LEVEL_NAMES[reached]}!",
            body=f"{count} people use KaamKoRecord thanks to you. Your badge now shows beside your name.",
            url="/profile#invite", emoji=LEVEL_EMOJI[reached], dedupe_key=f"champion-{reached}-{inviter.pk}",
        )


def champion_levels():
    """{user id: level} for everybody with a level, kept for a few minutes."""
    levels = cache.get(_LEVELS_KEY)
    if levels is None:
        counts = (Invitation.objects.filter(active_at__isnull=False).values("inviter")
                  .annotate(n=Count("id")).filter(n__gte=LEVELS[-1][1]))
        levels = {row["inviter"]: level_for(row["n"]) for row in counts}
        cache.set(_LEVELS_KEY, levels, _LEVELS_FOR)
    return levels


def champion(user):
    """"bronze", "silver", "gold" or None — the medal beside somebody's name."""
    if not user or not getattr(user, "pk", None):
        return None
    return champion_levels().get(user.pk)


def summary(user):
    """What Profile → Invite friends shows."""
    from apps.accounts.avatars import display_name

    code = InviteCode.for_user(user).code
    joined = activated_count(user)
    waiting = Invitation.objects.filter(inviter=user, active_at__isnull=True).count()
    upcoming, needed = next_level(joined)
    mine = Invitation.objects.filter(invited=user).select_related("inviter").first()
    can_say = mine is None and user.date_joined >= timezone.now() - timedelta(days=CLAIM_DAYS)
    return {
        "code": code,
        "link": INVITE_LINK.format(code=code),
        "joined": joined,
        "waiting": waiting,
        "level": level_for(joined),
        "next_level": upcoming,
        "next_at": needed,
        "levels": [{"level": level, "at": at} for level, at in reversed(LEVELS)],
        "invited_by": display_name(mine.inviter) if mine else None,
        "can_say_invited_by": can_say,
    }
