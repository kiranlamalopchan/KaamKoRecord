from django.apps import AppConfig


class ModerationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.moderation"
    verbose_name = "Moderation"

    def ready(self):
        # Groups changed in Django's admin, not only through set_moderator:
        # the moderator badges follow at once.
        from django.contrib.auth import get_user_model
        from django.contrib.auth.models import Group
        from django.db.models.signals import m2m_changed, post_delete, post_save

        from .roles import forget_moderators

        m2m_changed.connect(forget_moderators, sender=get_user_model().groups.through, dispatch_uid="moderators-users")
        post_save.connect(forget_moderators, sender=Group, dispatch_uid="moderators-group-saved")
        post_delete.connect(forget_moderators, sender=Group, dispatch_uid="moderators-group-deleted")
