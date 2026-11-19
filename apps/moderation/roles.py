"""Who may run the board: admins (staff) and the moderators they choose."""

from django.contrib.auth.models import Group
from django.core.cache import cache

MODERATORS = "Moderators"
# Who wears the Moderator badge is asked for every name on a page, so the
# list is kept for a minute and cleared whenever an admin changes it.
_IDS_KEY = "moderation:moderator-ids"
_IDS_FOR = 60


def moderator_ids():
    ids = cache.get(_IDS_KEY)
    if ids is None:
        ids = set(Group.objects.filter(name=MODERATORS).values_list("user__id", flat=True)) - {None}
        cache.set(_IDS_KEY, ids, _IDS_FOR)
    return ids


def badge(user):
    """The mark beside a name: "admin", "moderator", or None."""
    if not user or not getattr(user, "pk", None):
        return None
    if user.is_staff:
        return "admin"
    return "moderator" if user.pk in moderator_ids() else None


def is_admin(user):
    return bool(user and getattr(user, "is_authenticated", False) and user.is_active and user.is_staff)


def is_moderator(user):
    """Admins moderate too; everybody else only when an admin made them a moderator."""
    if not (user and getattr(user, "is_authenticated", False) and user.is_active):
        return False
    return user.is_staff or user.groups.filter(name=MODERATORS).exists()


def set_moderator(user, on):
    group, _ = Group.objects.get_or_create(name=MODERATORS)
    if on:
        user.groups.add(group)
    else:
        user.groups.remove(group)
    forget_moderators()


def forget_moderators(**_):
    """Drop the kept list, so the next badge drawn asks again (also hooked to group changes in apps.py)."""
    cache.delete(_IDS_KEY)
