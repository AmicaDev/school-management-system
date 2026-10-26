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
    queryset = m.TeachingAssignment.objects.select_related("teacher", "stream__school_class", "subject", "created_by")
    serializer_class = s.TeachingAssignmentSerializer
    filterset_fields = ["teacher", "stream", "stream__school_class", "subject", "is_active"]
    search_fields = [
        "teacher__first_name", "teacher__last_name", "teacher__username",
        "subject__name", "subject__code", "stream__name", "stream__school_class__name"
    ]

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user)

    def get_queryset(self):
        qs = super().get_queryset()
        u = self.request.user
        if u.role == "TEACHER":
            return qs.filter(teacher=u, is_active=True)
        if u.role == "ADMIN":
            return qs
        return qs.none()

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        assignment = self.get_object()
        assignment.is_active = False
        assignment.save(update_fields=["is_active", "updated_at"])
        audit(request, "DEACTIVATE", "academic_assignment", f"Ended assignment: {assignment}")
        return Response(self.get_serializer(assignment).data)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        assignment = self.get_object()
        # Verify no duplicate active assignment exists for this teacher
        dupes = m.TeachingAssignment.objects.filter(
            teacher=assignment.teacher,
            stream=assignment.stream,
            subject=assignment.subject,
            paper_number=assignment.paper_number,
            is_active=True,
        ).exclude(pk=assignment.pk)
        if dupes.exists():
            return Response(
                {"detail": "This teacher is already actively assigned to this class and subject paper."},
                status=400,
            )
        assignment.is_active = True
        assignment.save(update_fields=["is_active", "updated_at"])
        audit(request, "ACTIVATE", "academic_assignment", f"Reactivated assignment: {assignment}")
        return Response(self.get_serializer(assignment).data)


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
