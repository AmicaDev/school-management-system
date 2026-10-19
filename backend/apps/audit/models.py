from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=10, blank=True)
    action = models.CharField(max_length=60, db_index=True)
    module = models.CharField(max_length=60, db_index=True)
    object_repr = models.CharField(max_length=255, blank=True)
    result = models.CharField(max_length=10, default="SUCCESS")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]


class ErrorLog(models.Model):
    LEVELS = [("INFO", "INFO"), ("WARNING", "WARNING"), ("ERROR", "ERROR"), ("CRITICAL", "CRITICAL")]
    SOURCES = [("django", "Django"), ("drf", "DRF"), ("database", "Database"), ("auth", "Authentication"),
               ("celery", "Background jobs"), ("react", "React"), ("sync", "Offline sync")]
    fingerprint = models.CharField(max_length=64, unique=True)
    level = models.CharField(max_length=10, choices=LEVELS, default="ERROR", db_index=True)
    source = models.CharField(max_length=10, choices=SOURCES, default="django", db_index=True)
    message = models.TextField()
    module = models.CharField(max_length=200, blank=True)
    endpoint = models.CharField(max_length=255, blank=True)
    method = models.CharField(max_length=10, blank=True)
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    user_role = models.CharField(max_length=10, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    stack_trace = models.TextField(blank=True)
    count = models.PositiveIntegerField(default=1)
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True, db_index=True)
    resolved = models.BooleanField(default=False, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_seen"]
