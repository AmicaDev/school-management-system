from django.conf import settings
from django.db import models

from apps.people.models import Student


class Event(models.Model):
    class Kind(models.TextChoices):
        EVENT = "EVENT", "School event"
        MEETING = "MEETING", "Meeting"
        EXAM = "EXAM", "Examination schedule"
        ACADEMIC = "ACADEMIC", "Academic date"
        HOLIDAY = "HOLIDAY", "Holiday"
        ANNOUNCEMENT = "ANNOUNCEMENT", "Announcement"

    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=15, choices=Kind.choices, default=Kind.EVENT)
    description = models.TextField(blank=True)
    start_date = models.DateField(db_index=True)
    end_date = models.DateField(null=True, blank=True)
    audience = models.CharField(max_length=10, default="ALL", choices=[("ALL", "Everyone"), ("TEACHER", "Teachers"), ("PARENT", "Parents")])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["start_date"]


class Notification(models.Model):
    class Kind(models.TextChoices):
        ACADEMIC = "ACADEMIC", "Academic"
        ATTENDANCE = "ATTENDANCE", "Attendance"
        RESULTS = "RESULTS", "Results"
        EVENT = "EVENT", "Event"
        ANNOUNCEMENT = "ANNOUNCEMENT", "Announcement"
        SYSTEM = "SYSTEM", "System"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=15, choices=Kind.choices)
    priority = models.CharField(max_length=6, default="NORMAL", choices=[("LOW", "Low"), ("NORMAL", "Normal"), ("HIGH", "High")])
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read"])]


class Enquiry(models.Model):
    parent = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enquiries")
    archived_by = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="archived_enquiries")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    subject = models.CharField(max_length=200)
    status = models.CharField(max_length=10, default="OPEN", choices=[("OPEN", "Open"), ("ANSWERED", "Answered"), ("CLOSED", "Closed")])
    client_txn_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at"]


class EnquiryMessage(models.Model):
    enquiry = models.ForeignKey(Enquiry, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    body = models.TextField(max_length=4000)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
