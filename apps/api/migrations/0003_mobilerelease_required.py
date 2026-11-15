from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_mobilerelease'),
    ]

    operations = [
        migrations.AddField(
            model_name='mobilerelease',
            name='required',
            field=models.BooleanField(default=False, help_text='Phones on an older version see a full-screen "Update your app" page and can do nothing else until they install this one. Only tick it once this version is live in both stores.', verbose_name='everyone must update'),
        ),
    ]
