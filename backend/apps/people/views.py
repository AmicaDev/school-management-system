from django.db.models import Count
from django.db.models.deletion import ProtectedError
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditMixin, ProtectedRecordDelete, permanently_delete
from apps.audit.services import audit
from apps.users.models import User
from apps.users.permissions import IsAdmin, roles_required

from .access import visible_students
from .importers import handle_import
from .models import StaffMember, Student, TeacherProfile
from .serializers import (ParentSerializer, ParentStudentSerializer, StaffSerializer, StudentSerializer,
                          TeacherSerializer)

R = User.Role


class StudentViewSet(AuditMixin, viewsets.ModelViewSet):
    audit_module = "students"
    filterset_fields = {"gender": ["exact"], "stream": ["exact"], "stream__school_class": ["exact"],
                        "is_archived": ["exact"], "created_at": ["gte", "lte"], "updated_at": ["gte", "lte"]}
    search_fields = ["first_name", "last_name", "index_no"]
    ordering_fields = ["created_at", "updated_at", "last_name", "gender"]

    def get_permissions(self):
        if self.action in ("list", "retrieve", "profile"):
            return [roles_required(R.ADMIN, R.TEACHER, R.PARENT)()]
        return [IsAdmin()]

    def get_serializer_class(self):
        return ParentStudentSerializer if self.request.user.role == R.PARENT else StudentSerializer

    def get_queryset(self):
        qs = visible_students(self.request.user).prefetch_related("parents")
        if self.request.user.role == R.ADMIN and self.action == "list" and "is_archived" not in self.request.query_params:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_destroy(self, instance):  # records are archived, never destroyed
        instance.is_archived = True
        instance.save(update_fields=["is_archived", "updated_at"])
        audit(self.request, "ARCHIVE", "students", str(instance))

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        permanently_delete(request, self.get_object(), "students")
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        s = self.get_object()
        s.is_archived = False
        s.save(update_fields=["is_archived", "updated_at"])
        audit(request, "RESTORE", "students", str(s))
        return Response(StudentSerializer(s).data)

    @action(detail=True, methods=["get"])
    def profile(self, request, pk=None):
        from apps.attendance.models import AttendanceRecord
        s = self.get_object()
        att = dict(AttendanceRecord.objects.filter(student=s).values_list("status").annotate(n=Count("id")))
        return Response({"student": self.get_serializer(s).data, "attendance_totals": att})

    @action(detail=False, methods=["post"], url_path="import", permission_classes=[IsAdmin])
    def import_file(self, request):
        return handle_import(request, "students")


class ParentViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    serializer_class = ParentSerializer
    audit_module = "parents"
    filterset_fields = ["is_active", "is_archived"]
    search_fields = ["first_name", "last_name", "username", "phone", "children__index_no"]

    def get_queryset(self):
        qs = User.objects.filter(role=R.PARENT).prefetch_related("children").distinct()
        if self.action == "list" and "is_archived" not in self.request.query_params:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.is_archived = True
        instance.save(update_fields=["is_active", "is_archived"])
        audit(self.request, "ARCHIVE", "parents", instance.username)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        parent = self.get_object()
        parent.is_archived = False
        parent.is_active = True
        parent.save(update_fields=["is_archived", "is_active"])
        audit(request, "RESTORE", "parents", parent.username)
        return Response(ParentSerializer(parent).data)

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        permanently_delete(request, self.get_object(), "parents")
        return Response(status=204)

    @action(detail=False, methods=["post"], url_path="import")
    def import_file(self, request):
        return handle_import(request, "parents")


class TeacherViewSet(AuditMixin, viewsets.ModelViewSet):
    serializer_class = TeacherSerializer
    audit_module = "teachers"
    filterset_fields = ["gender", "is_archived"]
    search_fields = ["user__first_name", "user__last_name", "user__username"]

    def get_permissions(self):
        return [roles_required(R.ADMIN, R.TEACHER)()] if self.action in ("list", "retrieve") else [IsAdmin()]

    def get_queryset(self):
        qs = TeacherProfile.objects.select_related("user").prefetch_related("user__assignments__subject",
                                                                            "user__assignments__stream__school_class",
                                                                            "user__class_streams")
        if self.request.user.role != R.ADMIN:
            return qs.filter(user=self.request.user)
        if self.action == "list" and "is_archived" not in self.request.query_params:
            qs = qs.filter(is_archived=False)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.query_params.get("permanent") == "true":
            user = instance.user
            if user and user.role == R.ADMIN:
                return Response({"detail": "Administrator accounts cannot be permanently deleted."}, status=400)
            label = str(instance)
            if user:
                user.delete()
            else:
                instance.delete()
            audit(request, "PERMANENT_DELETE", "teachers", label)
            return Response(status=204)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.is_archived = True
        instance.user.is_active = False
        instance.user.save(update_fields=["is_active"])
        instance.save(update_fields=["is_archived"])
        audit(self.request, "ARCHIVE", "teachers", str(instance))

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        teacher = self.get_object()
        teacher.is_archived = False
        teacher.user.is_active = True
        teacher.user.save(update_fields=["is_active"])
        teacher.save(update_fields=["is_archived"])
        audit(request, "RESTORE", "teachers", str(teacher))
        return Response(self.get_serializer(teacher).data)

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        instance = self.get_object()
        user = instance.user
        if user and user.role == R.ADMIN:
            return Response({"detail": "Administrator accounts cannot be permanently deleted."}, status=400)
        label = str(instance)
        try:
            if user:
                user.delete()
            else:
                instance.delete()
        except ProtectedError as exc:
            raise ProtectedRecordDelete() from exc
        audit(request, "PERMANENT_DELETE", "teachers", label)
        return Response(status=204)

    @action(detail=False, methods=["post"], url_path="import", permission_classes=[IsAdmin])
    def import_file(self, request):
        return handle_import(request, "teachers")


class StaffViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    queryset = StaffMember.objects.all()
    serializer_class = StaffSerializer
    audit_module = "staff"
    filterset_fields = ["gender", "category", "status", "department"]
    search_fields = ["name", "position", "department"]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.query_params.get("permanent") == "true":
            label = str(instance)
            instance.delete()
            audit(request, "PERMANENT_DELETE", "staff", label)
            return Response(status=204)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        instance.status = "INACTIVE"
        instance.save(update_fields=["status"])
        audit(self.request, "DEACTIVATE", "staff", str(instance))

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        instance = self.get_object()
        label = str(instance)
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ProtectedRecordDelete() from exc
        audit(request, "PERMANENT_DELETE", "staff", label)
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        instance = self.get_object()
        instance.status = "ACTIVE"
        instance.save(update_fields=["status"])
        audit(request, "RESTORE", "staff", str(instance))
        return Response(self.get_serializer(instance).data)
