from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("notifications", "0007_alter_notification_kind")]
    operations = [
        migrations.AddField(model_name="device", name="notify_messages", field=models.BooleanField(default=True)),
        migrations.AddField(model_name="device", name="notify_roster", field=models.BooleanField(default=True)),
        migrations.AddField(model_name="device", name="notify_notices", field=models.BooleanField(default=True)),
        migrations.AddField(model_name="device", name="notify_pay", field=models.BooleanField(default=True)),
        migrations.AddField(model_name="device", name="notify_friends", field=models.BooleanField(default=True)),
    ]
