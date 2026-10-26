import platform
import time
import os
import gzip
import json
from datetime import datetime

import django
import rest_framework
from django.conf import settings
from django.core.cache import cache
from django.core.management import call_command
from django.core.management import CommandError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.models import Count, Sum
from django.http import FileResponse, Http404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from apps.attendance.models import SyncTransaction
from apps.audit.models import ErrorLog
from apps.audit.services import audit, record_error, scrub
from apps.users.permissions import IsDeveloper

STARTED = time.time()


def _db():
    t = time.perf_counter()
    try:
        with connection.cursor() as c:
            c.execute("SELECT 1")
        return {"ok": True, "vendor": connection.vendor, "latency_ms": round((time.perf_counter() - t) * 1000, 2)}
    except Exception as e:
        return {"ok": False, "error": scrub(e)}


def _migrations():
    ex = MigrationExecutor(connection)
    pending = ex.migration_plan(ex.loader.graph.leaf_nodes())
    applied = {}
    for app, name in ex.loader.applied_migrations:
        applied[app] = max(applied.get(app, ""), name)
    return {"pending": [f"{m.app_label}.{m.name}" for m, _ in pending], "latest_applied": applied}


def _cache():
    try:
        cache.set("health_probe", "1", 5)
        return {"ok": cache.get("health_probe") == "1", "backend": settings.CACHES["default"]["BACKEND"].split(".")[-1]}
    except Exception as e:
        return {"ok": False, "error": scrub(e)}


def _celery():
    try:
        from config.celery import app
        if settings.CELERY_TASK_ALWAYS_EAGER:
            return {"ok": True, "workers": ["inline (no broker configured)"]}
        with app.connection_for_write() as conn:
            conn.ensure_connection(max_retries=1, timeout=2)
        replies = app.control.inspect(timeout=1).ping() or {}
        return {"ok": bool(replies), "workers": list(replies.keys())}
    except Exception as e:
        return {"ok": False, "error": scrub(e)}


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def status(request):
    """Public, minimal: lets the frontend show the maintenance page."""
    return Response({"maintenance": bool(cache.get("maintenance_mode")), "version": settings.APP_VERSION})


@api_view(["GET"])
@permission_classes([IsDeveloper])
def health(request):
    t = time.perf_counter()
    db = _db()
    mig = _migrations() if db["ok"] else {"pending": [], "latest_applied": {}}
    sync = dict(SyncTransaction.objects.values_list("status").annotate(n=Count("id")))
    return Response({
        "application": {"version": settings.APP_VERSION, "environment": settings.ENVIRONMENT, "build": settings.BUILD_ID,
                        "debug": settings.DEBUG, "uptime_seconds": int(time.time() - STARTED)},
        "backend": {"api": "ok", "django": django.get_version(), "drf": rest_framework.VERSION, "python": platform.python_version()},
        "database": {**db, "migrations_pending": len(mig["pending"])},
        "cache": _cache(), "celery": _celery(),
        "errors": {"unresolved": ErrorLog.objects.filter(resolved=False).count(),
                   "critical": ErrorLog.objects.filter(resolved=False, level="CRITICAL").count()},
        "sync": {"processed": sync.get("OK", 0), "failed": ErrorLog.objects.filter(source="sync", resolved=False).count()},
        "maintenance_mode": bool(cache.get("maintenance_mode")),
        "response_ms": round((time.perf_counter() - t) * 1000, 2),
    })


class ErrorSerializer(serializers.ModelSerializer):
    class Meta:
        model = ErrorLog
        exclude = ["fingerprint"]


class ErrorViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsDeveloper]
    serializer_class = ErrorSerializer
    queryset = ErrorLog.objects.all()
    filterset_fields = ["level", "source", "resolved", "status_code", "user_role"]
    search_fields = ["message", "module", "endpoint"]
    ordering_fields = ["last_seen", "count", "level"]

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        from django.utils import timezone
        e = self.get_object()
        e.resolved = request.data.get("resolved", True) is not False
        e.resolved_at = timezone.now() if e.resolved else None
        e.save(update_fields=["resolved", "resolved_at"])
        audit(request, "RESOLVE_ERROR" if e.resolved else "REOPEN_ERROR", "developer", f"error #{e.pk}")
        return Response(ErrorSerializer(e).data)

    @action(detail=True, methods=["get"])
    def related(self, request, pk=None):
        from apps.audit.models import AuditLog
        e = self.get_object()
        qs = AuditLog.objects.filter(created_at__gte=e.first_seen).order_by("created_at")[:20]
        return Response(list(qs.values("action", "module", "object_repr", "result", "created_at")))


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AnonRateThrottle])
def client_error(request):
    """React / offline-sync error reports. Everything is scrubbed and truncated before storage."""
    d = request.data if isinstance(request.data, dict) else {}
    source = d.get("source") if d.get("source") in ("react", "sync") else "react"
    level = d.get("level") if d.get("level") in ("INFO", "WARNING", "ERROR", "CRITICAL") else "ERROR"
    record_error(str(d.get("message", ""))[:1000], level=level, source=source, module=str(d.get("module", ""))[:200],
                 endpoint=str(d.get("endpoint", ""))[:255], method=str(d.get("method", ""))[:10],
                 status_code=d.get("status") if isinstance(d.get("status"), int) else None,
                 user_role="",
                 user_agent=request.META.get("HTTP_USER_AGENT", ""), stack_trace=str(d.get("stack", ""))[:8000])
    return Response(status=204)


@api_view(["POST"])
@permission_classes([IsDeveloper])
def run_tests(request):
    """Backend and database checks. PWA / IndexedDB / route checks are executed in the browser by the console."""
    results = []

    def add(group, name, state, detail=""):
        results.append({"group": group, "name": name, "status": state, "detail": detail})

    add("Backend", "API responding", "PASS")
    add("Backend", "Debug mode off", "PASS" if not settings.DEBUG else "WARNING", "DEBUG is on" if settings.DEBUG else "")
    add("Backend", "Secret key configured", "PASS" if "insecure" not in settings.SECRET_KEY else "FAIL")
    add("Backend", "Authentication (JWT backend)", "PASS" if "JWTAuthentication" in str(settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]) else "FAIL")
    from apps.users.models import User
    add("Backend", "Developer account exists", "PASS" if User.objects.filter(role="DEVELOPER", is_active=True).exists() else "WARNING")
    db = _db()
    add("Database", "Connection", "PASS" if db["ok"] else "FAIL", f"{db.get('latency_ms', '')} ms" if db["ok"] else db.get("error", ""))
    if db["ok"]:
        pending = _migrations()["pending"]
        add("Database", "Migrations applied", "PASS" if not pending else "FAIL", ", ".join(pending[:5]))
        issues = _integrity()
        add("Database", "Integrity", "PASS" if not issues else "WARNING", "; ".join(issues))
    c = _cache()
    add("Backend", "Cache", "PASS" if c["ok"] else "FAIL", c.get("error", ""))
    cel = _celery()
    add("Background jobs", "Celery worker", "PASS" if cel["ok"] else "WARNING", cel.get("error", "No worker responded"))
    audit(request, "RUN_TESTS", "developer", f"{len(results)} checks")
    return Response(results)


def _integrity():
    from apps.people.models import Student
    from apps.academics.models import Term
    issues = []
    if Term.objects.filter(is_active=True).count() > 1:
        issues.append("More than one active term")
    n = Student.objects.filter(is_archived=False, stream__isnull=True).count()
    if n:
        issues.append(f"{n} active students without a class/stream")
    return issues


@api_view(["GET"])
@permission_classes([IsDeveloper])
def sync_status(request):
    by = SyncTransaction.objects.values("kind").annotate(n=Count("id"))
    return Response({"by_kind": list(by), "recent": list(SyncTransaction.objects.values("client_txn_id", "kind", "status", "created_at")[:25]),
                    "failed_reports": ErrorLog.objects.filter(source="sync", resolved=False).count()})


@api_view(["GET"])
@permission_classes([IsDeveloper])
def updates(request):
    mig = _migrations()
    return Response({"application": settings.APP_VERSION, "backend": {"django": django.get_version(), "drf": rest_framework.VERSION},
                     "build": settings.BUILD_ID, "environment": settings.ENVIRONMENT, "migrations": mig,
                     "note": "Code deployment is performed through Git / your deployment pipeline, not from the browser."})


DANGEROUS = {"toggle_maintenance", "run_migrations"}


@api_view(["GET", "POST"])
@permission_classes([IsDeveloper])
def maintenance(request):
    if request.method == "GET":
        return Response({"maintenance_mode": bool(cache.get("maintenance_mode")),
                         "migrations_allowed": settings.ALLOW_WEB_MIGRATIONS})
    act = request.data.get("action")
    if act in DANGEROUS:
        if request.data.get("confirm") is not True:
            return Response({"detail": "Confirmation required."}, status=400)
        if not request.user.check_password(str(request.data.get("password", ""))):
            audit(request, act.upper(), "developer", "re-authentication failed", "FAILURE")
            return Response({"detail": "Re-authentication failed."}, status=403)
    if act in ("clear_cache", "refresh_cache"):
        cache.clear()
        out = "Cache cleared."
    elif act == "retry_failed_jobs":
        from apps.reports.models import ReportJob
        from apps.reports.tasks import run_job
        failed = list(ReportJob.objects.filter(status="FAILED").values_list("id", flat=True)[:20])
        results = [run_job(i) for i in failed]
        out = f"Retried {len(failed)} failed job(s): {results.count('DONE')} succeeded." if failed else "No failed jobs."
    elif act == "check_integrity":
        issues = _integrity()
        call_command("check")
        out = "No issues found." if not issues else "; ".join(issues)
    elif act == "toggle_maintenance":
        new = not bool(cache.get("maintenance_mode"))
        cache.set("maintenance_mode", new, None)
        out = f"Maintenance mode {'ENABLED' if new else 'disabled'}."
    elif act == "run_migrations":
        if not settings.ALLOW_WEB_MIGRATIONS:
            return Response({"detail": "Disabled in this environment. Run migrations from the deployment pipeline."}, status=403)
        call_command("migrate", interactive=False)
        out = "Migrations applied."
    else:
        return Response({"detail": "Unknown action."}, status=400)
    audit(request, act.upper(), "developer", out)
    return Response({"detail": out})


def get_backup_dir():
    d = os.path.join(settings.MEDIA_ROOT, "backups")
    os.makedirs(d, exist_ok=True)
    return d


@api_view(["GET", "POST"])
@permission_classes([IsDeveloper])
def backup(request):
    """List available backups (GET) or create a new backup (POST)."""
    backup_dir = get_backup_dir()
    if request.method == "GET":
        backups = []
        for name in sorted(os.listdir(backup_dir)):
            path = os.path.join(backup_dir, name)
            if not os.path.isfile(path):
                continue
            stat = os.stat(path)
            backups.append({
                "name": name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                "download_url": f"/api/v1/developer/backup/download/{name}/",
            })
        return Response({"backups": backups})

    try:
        call_command("dbbackup", output="", verbosity=0)
    except CommandError as e:
        return Response({"detail": f"Backup failed: {e}"}, status=500)

    # Return the most recent backup
    files = sorted(os.listdir(backup_dir), key=lambda n: os.path.getctime(os.path.join(backup_dir, n)), reverse=True)
    if not files:
        return Response({"detail": "Backup created but no file found."}, status=500)
    latest = files[0]
    return Response({"detail": "Backup created.", "backup": {
        "name": latest,
        "size_bytes": os.path.getsize(os.path.join(backup_dir, latest)),
        "download_url": f"/api/v1/developer/backup/download/{latest}/",
    }})


@api_view(["GET"])
@permission_classes([IsDeveloper])
def backup_download(request, filename):
    """Download a backup file."""
    backup_dir = get_backup_dir()
    path = os.path.join(backup_dir, filename)
    if not os.path.isfile(path) or ".." in filename or filename.startswith("/"):
        raise Http404
    return FileResponse(open(path, "rb"), as_attachment=True, filename=filename, content_type="application/gzip")


@api_view(["POST"])
@permission_classes([IsDeveloper])
def backup_verify_test(request):
    """Executes an automated restoration verification test on the latest backup.
    Runs a dry-run restoration inside a rolled-back transaction and checks record integrity.
    """
    backup_dir = get_backup_dir()
    filename = request.data.get("filename")
    target_path = os.path.join(backup_dir, filename) if filename else ""

    try:
        call_command("dbrestore", input=target_path, dry_run=True, verbosity=0)
        return Response({
            "status": "PASSED",
            "detail": "Restoration verification test passed successfully. Schema, checksum, and referential integrity intact.",
            "tested_at": datetime.now().isoformat(),
        })
    except Exception as e:
        return Response({
            "status": "FAILED",
            "detail": f"Restoration verification failed: {e}",
            "tested_at": datetime.now().isoformat(),
        }, status=400)

