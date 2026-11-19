from django.apps import AppConfig


class TimeclockConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.timeclock"
    # See AccountsConfig: the label is what the database knows this app by.
    label = "timeclock"

    def ready(self):
        # Whenever a shift or one of its breaks is saved or removed — the
        # watch, the phone, the website, an edit — the person's phones hear
        # "clock.updated" on the realtime stream and fetch the clock again.
        from django.db.models.signals import post_delete, post_save

        from apps.chat import realtime

        from .models import Break, Shift

        def moved(sender, instance, **kwargs):
            if sender is Shift:
                user_id = instance.user_id
            else:  # a break: its shift may be going in the same delete
                user_id = Shift.objects.filter(pk=instance.shift_id).values_list("user_id", flat=True).first()
            if user_id:
                realtime.publish([user_id], "clock.updated")

        for model in (Shift, Break):
            post_save.connect(moved, sender=model, dispatch_uid=f"clock-updated-save-{model.__name__}")
            post_delete.connect(moved, sender=model, dispatch_uid=f"clock-updated-delete-{model.__name__}")
