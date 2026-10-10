from rest_framework import viewsets
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.audit.mixins import AuditMixin, permanently_delete
from apps.audit.services import audit
from apps.users.permissions import AdminWriteAuthenticatedRead, IsSchoolUser

from . import models as m
from . import serializers as s


class ConfigViewSet(AuditMixin, viewsets.ModelViewSet):
    """Reference data: every school user can read, only ADMIN can change. Protected FKs prevent careless deletion."""
    permission_classes = [AdminWriteAuthenticatedRead]
    audit_module = "configuration"
    pagination_class = None


class AcademicYearViewSet(ConfigViewSet):
    queryset = m.AcademicYear.objects.all()
    serializer_class = s.AcademicYearSerializer


class TermViewSet(ConfigViewSet):
    queryset = m.Term.objects.select_related("year")
    serializer_class = s.TermSerializer
    filterset_fields = ["year", "is_active"]


class ClassViewSet(ConfigViewSet):
    queryset = m.SchoolClass.objects.all()
    serializer_class = s.SchoolClassSerializer


class StreamViewSet(ConfigViewSet):
    queryset = m.Stream.objects.select_related("school_class", "class_teacher")
    serializer_class = s.StreamSerializer
    filterset_fields = ["school_class"]


class SubjectViewSet(ConfigViewSet):
    queryset = m.Subject.objects.all()
    serializer_class = s.SubjectSerializer
    filterset_fields = ["is_archived"]
    search_fields = ["name", "code"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list" and "is_archived" not in self.request.query_params:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_destroy(self, instance):  # archive instead of deleting
        instance.is_archived = True
        instance.save(update_fields=["is_archived"])
        audit(self.request, "ARCHIVE", "configuration", str(instance))

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        subject = self.get_object()
        subject.is_archived = False
        subject.save(update_fields=["is_archived"])
        audit(request, "RESTORE", "configuration", str(subject))
        return Response(self.get_serializer(subject).data)

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        permanently_delete(request, self.get_object(), "configuration")
        return Response(status=204)


class TeachingAssignmentViewSet(ConfigViewSet):
    queryset = m.TeachingAssignment.objects.select_related("teacher", "stream__school_class", "subject")
    serializer_class = s.TeachingAssignmentSerializer
    filterset_fields = ["teacher", "stream", "subject"]

    def get_queryset(self):
        qs = super().get_queryset()
        u = self.request.user
        return qs.filter(teacher=u) if u.role == "TEACHER" else qs if u.role == "ADMIN" else qs.none()


class ExamTypeViewSet(ConfigViewSet):
    queryset = m.ExamType.objects.all()
    serializer_class = s.ExamTypeSerializer


class GradeBandViewSet(ConfigViewSet):
    queryset = m.GradeBand.objects.all()
    serializer_class = s.GradeBandSerializer


@api_view(["GET", "PATCH"])
@permission_classes([IsSchoolUser])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def school_profile(request):
    profile = m.SchoolProfile.get()
    if request.method == "PATCH":
        if request.user.role != "ADMIN":
            return Response({"detail": "Only administrators can change the school profile."}, status=403)
        ser = s.SchoolProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        audit(request, "UPDATE", "configuration", "School profile")
        return Response(ser.data)
    return Response(s.SchoolProfileSerializer(profile, context={"request": request}).data)
