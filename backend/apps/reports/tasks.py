import io
import traceback
import zipfile

from celery import shared_task
from django.core.files.base import ContentFile
from django.utils import timezone


def run_job(job_id):
    from apps.audit.services import record_error
    from apps.people.models import Student

    from .models import ReportJob
    from .pdf import build_report_card

    job = ReportJob.objects.select_related("stream__school_class", "term__year").get(pk=job_id)
    job.status, job.error = "RUNNING", ""
    job.save(update_fields=["status", "error"])
    try:
        buf = io.BytesIO()
        n = 0
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for s in Student.objects.filter(stream=job.stream, is_archived=False).select_related("stream__school_class").order_by("last_name"):
                z.writestr(f"{s.index_no}-{s.last_name}-{s.first_name}.pdf".replace("/", "-"), build_report_card(s, job.term).getvalue())
                n += 1
        job.file.save(f"report-cards-{job.id}.zip", ContentFile(buf.getvalue()), save=False)
        job.count, job.status = n, "DONE"
    except Exception as e:
        job.status, job.error = "FAILED", f"{type(e).__name__}: {e}"[:300]
        record_error(job.error, source="celery", module="reports.tasks", stack_trace=traceback.format_exc())
    job.finished_at = timezone.now()
    job.save()
    return job.status


@shared_task
def generate_class_report_cards(job_id):
    return run_job(job_id)


@shared_task
def purge_old_sync_transactions(days=60):
    """Housekeeping: idempotency records older than N days are no longer needed."""
    from datetime import timedelta

    from apps.attendance.models import SyncTransaction
    return SyncTransaction.objects.filter(created_at__lt=timezone.now() - timedelta(days=days)).delete()[0]
