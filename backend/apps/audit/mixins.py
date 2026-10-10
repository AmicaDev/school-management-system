from django.db.models.deletion import ProtectedError
from rest_framework.exceptions import APIException, ValidationError

from .services import audit


class ProtectedRecordDelete(APIException):
    status_code = 409
    default_detail = "This record cannot be permanently deleted because it is still in use."
    default_code = "protected_record"


def permanently_delete(request, instance, module):
    if not instance.is_archived:
        raise ValidationError("Only archived records can be permanently deleted.")
    label = str(instance)
    try:
        instance.delete()
    except ProtectedError as exc:
        raise ProtectedRecordDelete() from exc
    audit(request, "PERMANENT_DELETE", module, label)


class AuditMixin:
    """Writes an audit entry for create / update / delete on a ModelViewSet."""
    audit_module = "system"

    def perform_create(self, serializer):
        obj = serializer.save()
        audit(self.request, "CREATE", self.audit_module, str(obj))

    def perform_update(self, serializer):
        obj = serializer.save()
        audit(self.request, "UPDATE", self.audit_module, str(obj))

    def perform_destroy(self, instance):
        label = str(instance)
        instance.delete()
        audit(self.request, "DELETE", self.audit_module, label)
