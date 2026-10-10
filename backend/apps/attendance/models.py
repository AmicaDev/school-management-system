from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.academics.models import Stream, Subject, Term
from apps.people.models import Student


class SyncTransaction(models.Model):
    """Idempotency ledger: each offline operation carries a unique client_txn_id."""
    client_txn_id = models.CharField(max_length=64, unique=True)
    kind = models.CharField(max_length=30)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=10, default="OK")
    detail = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        LATE = "LATE", "Late"
        EXCUSED = "EXCUSED", "Excused"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="attendance")
    stream = models.ForeignKey(Stream, on_delete=models.PROTECT, related_name="+")
    term = models.ForeignKey(Term, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    subject = models.ForeignKey(Subject, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    date = models.DateField(db_index=True)
    status = models.CharField(max_length=8, choices=Status.choices)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        indexes = [models.Index(fields=["stream", "date"]), models.Index(fields=["student", "date"])]
        constraints = [
            # exactly one state per student/date/session; the second constraint covers the NULL-subject (daily) case
            models.UniqueConstraint(fields=["student", "date", "subject"], name="uniq_att_session"),
            models.UniqueConstraint(fields=["student", "date"], condition=Q(subject__isnull=True), name="uniq_att_daily"),
        ]
