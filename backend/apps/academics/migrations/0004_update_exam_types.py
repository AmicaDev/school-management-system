from decimal import Decimal
from django.db import migrations


def update_exam_types(apps, schema_editor):
    ExamType = apps.get_model("academics", "ExamType")
    alias = schema_editor.connection.alias
    types_config = [
        ("BOT", "Beginning of Term", Decimal("20"), Decimal("20"), 1),
        ("MID", "Mid-Term", Decimal("0"), Decimal("20"), 2),
        ("FINAL", "End of Term", Decimal("80"), Decimal("80"), 3),
        ("ASSIGNMENT", "Assignment", Decimal("0"), Decimal("10"), 0),
    ]
    for code, name, weight, default_max, order in types_config:
        ExamType.objects.using(alias).filter(code=code).update(
            name=name,
            weight=weight,
            default_max=default_max,
            order=order,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('academics', '0003_remove_teachingassignment_uniq_assignment_and_more'),
    ]

    operations = [
        migrations.RunPython(update_exam_types, migrations.RunPython.noop),
    ]

