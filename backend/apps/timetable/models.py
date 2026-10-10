from django.conf import settings
from django.db import models

from apps.academics.models import Stream, Subject


class TimetableEntry(models.Model):
    DAYS = [(1, "Monday"), (2, "Tuesday"), (3, "Wednesday"), (4, "Thursday"), (5, "Friday"), (6, "Saturday")]
    stream = models.ForeignKey(Stream, on_delete=models.CASCADE, related_name="timetable")
    day = models.PositiveSmallIntegerField(choices=DAYS)
    period = models.PositiveSmallIntegerField()
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="+")
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="timetable",
                                limit_choices_to={"role": "TEACHER"})
    room = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["day", "period"]
        constraints = [
            models.UniqueConstraint(fields=["stream", "day", "period"], name="uniq_slot_per_stream"),
            models.UniqueConstraint(fields=["teacher", "day", "period"], name="uniq_teacher_slot"),
        ]
