from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditMixin
from apps.people.access import visible_students
from apps.users.permissions import AdminWriteAuthenticatedRead

from .models import TimetableEntry


class TimetableSerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True)
    stream_label = serializers.CharField(source="stream.__str__", read_only=True)
    day_name = serializers.CharField(source="get_day_display", read_only=True)

    class Meta:
        model = TimetableEntry
        fields = "__all__"


class TimetableViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [AdminWriteAuthenticatedRead]
    serializer_class = TimetableSerializer
    audit_module = "timetable"
    pagination_class = None
    filterset_fields = ["stream", "teacher", "day"]

    def get_queryset(self):
        qs = TimetableEntry.objects.select_related("stream__school_class", "subject", "teacher")
        u = self.request.user
        if u.role == "ADMIN":
            return qs
        if u.role == "TEACHER":
            return qs.filter(teacher=u)
        streams = visible_students(u).values("stream_id")  # parents: only their children's streams
        return qs.filter(stream_id__in=streams)

    @action(detail=False, methods=["get"])
    def today(self, request):
        from django.utils import timezone
        day = timezone.localdate().isoweekday()
        return Response(self.get_serializer(self.get_queryset().filter(day=day), many=True).data)
