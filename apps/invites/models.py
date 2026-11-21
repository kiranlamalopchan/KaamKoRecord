"""
Who invited whom — for the Champion badge.

Everybody has an invite code of their own (made the first time it is asked
for), which rides in the link they share. A new person is linked to whoever
invited them once, by that code (or the inviter's username) at sign-up or
within a fortnight after; it never changes after that. The invite *counts*
only when they start using the app — their first workplace or shift — so a
badge can't be earned with empty accounts.
"""

import secrets

from django.conf import settings
from django.db import IntegrityError, models

# No 0/O or 1/I/L: a code is read off a screen and typed by hand.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6


class InviteCode(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="invite_code")
    code = models.CharField(max_length=12, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user}: {self.code}"

    @classmethod
    def for_user(cls, user):
        """The person's own code, made the first time it is needed."""
        existing = cls.objects.filter(user=user).first()
        if existing:
            return existing
        for _ in range(10):
            # Capital letters and digits only (ALPHABET), never lower case.
            code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH)).upper()
            try:
                return cls.objects.create(user=user, code=code)
            except IntegrityError:
                existing = cls.objects.filter(user=user).first()
                if existing:  # made at the same moment by another request
                    return existing
        raise RuntimeError("Couldn't make a unique invite code")


class Invitation(models.Model):
    inviter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="invitations_sent")
    invited = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="invited_by")
    created_at = models.DateTimeField(auto_now_add=True)
    # When the invited person started using the app — from then on it counts.
    active_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["inviter", "active_at"])]

    def __str__(self):
        return f"{self.inviter} → {self.invited}{'' if self.active_at else ' (not started yet)'}"
