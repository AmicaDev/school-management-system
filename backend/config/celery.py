import os

from celery import Celery
from celery.signals import task_failure

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
app = Celery("school")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@task_failure.connect
def record_task_failure(sender=None, task_id=None, exception=None, traceback=None, **kwargs):
    from apps.audit.services import record_error
    record_error(f"{type(exception).__name__}: {exception}", source="celery", level="ERROR",
                module=getattr(sender, "name", "task"), stack_trace=str(traceback or ""))
