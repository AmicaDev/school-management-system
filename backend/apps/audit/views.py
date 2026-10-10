from rest_framework import viewsets

from apps.users.permissions import roles_required
from apps.users.models import User

from .models import AuditLog
from rest_framework import serializers


class AuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """ADMIN sees school activity; DEVELOPER sees everything."""
    permission_classes = [roles_required(User.Role.ADMIN, User.Role.DEVELOPER)]
    serializer_class = AuditSerializer
    filterset_fields = ["action", "module", "result", "role"]
    search_fields = ["actor_name", "object_repr", "action"]

    def get_queryset(self):
        qs = AuditLog.objects.all()
        if self.request.user.role == User.Role.ADMIN:
            qs = qs.exclude(module="developer").exclude(role=User.Role.DEVELOPER)
        return qs
