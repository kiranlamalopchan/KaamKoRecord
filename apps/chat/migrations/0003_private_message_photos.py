from pathlib import Path

import apps.chat.models
from django.conf import settings
from django.db import migrations, models


def move_private(apps, schema_editor):
    Message = apps.get_model("chat", "Message")
    public = Path(settings.MEDIA_ROOT)
    private = Path(settings.BASE_DIR) / "private_media"
    for message in Message.objects.exclude(photo="").iterator():
        source = public / message.photo.name
        target = private / message.photo.name
        if source.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            source.replace(target)


def move_public(apps, schema_editor):
    Message = apps.get_model("chat", "Message")
    public = Path(settings.MEDIA_ROOT)
    private = Path(settings.BASE_DIR) / "private_media"
    for message in Message.objects.exclude(photo="").iterator():
        source = private / message.photo.name
        target = public / message.photo.name
        if source.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            source.replace(target)


class Migration(migrations.Migration):
    dependencies = [("chat", "0002_message_photo_reactions")]
    operations = [
        migrations.AlterField(
            model_name="message",
            name="photo",
            field=models.ImageField(blank=True, storage=apps.chat.models.PrivateMessageStorage(), upload_to=apps.chat.models.message_photo_path),
        ),
        migrations.RunPython(move_private, move_public),
    ]
