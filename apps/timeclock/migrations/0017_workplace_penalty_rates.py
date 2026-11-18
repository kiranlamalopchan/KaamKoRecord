from decimal import Decimal
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("timeclock", "0016_workplace_tax_scale")]
    operations = [
        migrations.AddField(model_name="workplace", name="saturday_multiplier", field=models.DecimalField(decimal_places=2, default=1, max_digits=4, validators=[MinValueValidator(1), MaxValueValidator(5)])),
        migrations.AddField(model_name="workplace", name="sunday_multiplier", field=models.DecimalField(decimal_places=2, default=1, max_digits=4, validators=[MinValueValidator(1), MaxValueValidator(5)])),
        migrations.AddField(model_name="workplace", name="public_holiday_multiplier", field=models.DecimalField(decimal_places=2, default=1, max_digits=4, validators=[MinValueValidator(1), MaxValueValidator(5)])),
        migrations.AddField(model_name="workplace", name="overtime_after_hours", field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True, validators=[MinValueValidator(Decimal("0.25")), MaxValueValidator(24)])),
        migrations.AddField(model_name="workplace", name="overtime_multiplier", field=models.DecimalField(decimal_places=2, default=Decimal("1.5"), max_digits=4, validators=[MinValueValidator(1), MaxValueValidator(5)])),
    ]
