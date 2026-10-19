from rest_framework import viewsets, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone

from apps.users.permissions import roles_required
from apps.users.models import User

from .models import AuditLog


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
        if self.request.query_params.get("trash") == "1":
            qs = qs.filter(is_archived=True)
        else:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_destroy(self, instance):
        # Soft-delete: move to recycle bin instead of hard delete.
        if not instance.is_archived:
            instance.is_archived = True
            instance.archived_at = timezone.now()
            instance.save()
        else:
            instance.delete()

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        obj = self.get_object()
        if not obj.is_archived:
            return Response({"detail": "Not archived."})
        obj.is_archived = False
        obj.archived_at = None
        obj.save()
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post", "delete"])
    def permanent_delete(self, request, pk=None):
        obj = self.get_object()
        obj.delete()
        return Response({"detail": "Permanently deleted."}, status=status.HTTP_204_NO_CONTENT)