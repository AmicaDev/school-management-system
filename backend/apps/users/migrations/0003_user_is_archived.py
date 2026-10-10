from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_user_address_user_photo"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="is_archived",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
