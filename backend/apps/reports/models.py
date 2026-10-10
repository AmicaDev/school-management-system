from django.conf import settings
from django.db import models

from apps.academics.models import Stream, Term


class ReportJob(models.Model):
    """A background request to build report cards for a whole class as one ZIP."""
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        DONE = "DONE", "Done"
        FAILED = "FAILED", "Failed"

    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    stream = models.ForeignKey(Stream, on_delete=models.CASCADE, related_name="+")
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name="+")
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING, db_index=True)
    file = models.FileField(upload_to="report_jobs/", blank=True)
    count = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
