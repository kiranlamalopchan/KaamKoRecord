from django.apps import AppConfig


class InvitesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.invites"
    verbose_name = "Invites"

    def ready(self):
        # Somebody invited counts once they use the app: their first workplace
        # or their first shift (whichever comes first) makes the invite count.
        from django.db.models.signals import post_save

        from apps.timeclock.models import Shift, Workplace

        from .services import activate

        def started(sender, instance, created, **_):
            if created:
                activate(instance.user)

        post_save.connect(started, sender=Workplace, dispatch_uid="invites-first-workplace")
        post_save.connect(started, sender=Shift, dispatch_uid="invites-first-shift")
