import traceback

from django.db import DatabaseError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

from .services import record_error


def exception_handler(exc, context):
    response = drf_handler(exc, context)
    request = context.get("request")
    view = context.get("view")
    role = getattr(getattr(request, "user", None), "role", "") if request else ""
    common = dict(module=view.__class__.__name__ if view else "", endpoint=request.path if request else "",
                  method=request.method if request else "", user_role=role,
                  user_agent=request.META.get("HTTP_USER_AGENT", "") if request else "")
    if response is None:  # unhandled exception -> safe 500
        source = "database" if isinstance(exc, DatabaseError) else "django"
        record_error(f"{exc.__class__.__name__}: {exc}", level="CRITICAL" if source == "database" else "ERROR",
                     source=source, status_code=500, stack_trace="".join(traceback.format_exception(exc)), **common)
        return Response({"detail": "A server error occurred. The incident has been logged."}, status=500)
    if response.status_code == 401 and request and request.path.endswith("/login/"):
        record_error("Authentication failure", level="WARNING", source="auth", status_code=401, **common)
    elif response.status_code >= 500:
        record_error(str(exc), source="drf", status_code=response.status_code,
                     stack_trace="".join(traceback.format_exception(exc)), **common)
    return response
