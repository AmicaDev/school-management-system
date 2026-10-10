import hashlib
import re

from django.db.models import F
from django.utils import timezone

from .models import AuditLog, ErrorLog

SENSITIVE_KEYS = re.compile(r"(pass(word)?|token|secret|authorization|cookie|api[_-]?key|refresh|access)", re.I)
JWT_RE = re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*")
KV_RE = re.compile(r"(?i)(password|passwd|secret|token|authorization)\s*[=:]\s*\S+")
URL_PW_RE = re.compile(r"(\w+://[^:/\s]+):[^@\s]+@")


def scrub(text):
    """Remove passwords, JWTs and secrets from any text before it is stored."""
    text = str(text or "")
    text = JWT_RE.sub("[REDACTED_JWT]", text)
    text = URL_PW_RE.sub(r"\1:[REDACTED]@", text)
    return KV_RE.sub(lambda m: m.group(1) + "=[REDACTED]", text)


def client_ip(request):
    if request is None:
        return None
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")) or None


def audit(request, action, module, obj="", result="SUCCESS", actor=None):
    try:
        user = actor or (getattr(request, "user", None) if request is not None else None)
        if user is not None and not getattr(user, "is_authenticated", False):
            user = None
        AuditLog.objects.create(
            actor=user, actor_name=(user.username if user else "")[:150], role=(user.role if user else ""),
            action=action, module=module, object_repr=scrub(obj)[:255], result=result, ip_address=client_ip(request))
    except Exception:  # auditing must never break the request
        pass


def record_error(message, *, level="ERROR", source="django", module="", endpoint="", method="", status_code=None,
                 user_role="", user_agent="", stack_trace=""):
    try:
        message, stack_trace = scrub(message)[:2000], scrub(stack_trace)[:12000]
        fp = hashlib.sha256(f"{source}|{module}|{endpoint}|{status_code}|{message[:200]}".encode()).hexdigest()
        obj, created = ErrorLog.objects.get_or_create(fingerprint=fp, defaults=dict(
            level=level, source=source, message=message, module=module[:200], endpoint=endpoint[:255], method=method[:10],
            status_code=status_code, user_role=user_role, user_agent=scrub(user_agent)[:255], stack_trace=stack_trace))
        if not created:
            ErrorLog.objects.filter(pk=obj.pk).update(count=F("count") + 1, last_seen=timezone.now(), resolved=False,
                                                       resolved_at=None)
        return obj
    except Exception:
        return None
