from django.db import transaction
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
from .safeguards import (check_student_eligible_for_permanent_deletion,
                        check_teacher_eligible_for_permanent_deletion)
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
        if self.request.user.role == R.ADMIN and self.action == "list":
            arch_param = self.request.query_params.get("is_archived")
            if arch_param in ("true", "True", "1"):
                qs = qs.filter(is_archived=True)
            elif arch_param in ("false", "False", "0") or "is_archived" not in self.request.query_params:
                qs = qs.filter(is_archived=False)
        return qs

    def perform_destroy(self, instance):  # records are archived, never destroyed
        instance.is_archived = True
        instance.save(update_fields=["is_archived", "updated_at"])
        audit(self.request, "ARCHIVE", "students", str(instance))

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        s = self.get_object()
        eligible, err = check_student_eligible_for_permanent_deletion(s)
        if not eligible:
            return Response({"detail": f"Cannot permanently delete {s.full_name}: {err}"}, status=400)
        label = str(s)
        s.delete()
        audit(request, "PERMANENT_DELETE", "students", label)
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        s = self.get_object()
        s.is_archived = False
        s.save(update_fields=["is_archived", "updated_at"])
        audit(request, "RESTORE", "students", str(s))
        return Response(StudentSerializer(s).data)

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def bulk_archive(self, request):
        ids = request.data.get("ids", [])
        reason = request.data.get("reason", "").strip()
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No student IDs provided."}, status=400)

        students = Student.objects.filter(id__in=ids)
        found_ids = set(students.values_list("id", flat=True))
        missing_ids = [i for i in ids if i not in found_ids]

        with transaction.atomic():
            updated = students.filter(is_archived=False).update(is_archived=True)
            audit(request, "BULK_ARCHIVE", "students", f"{updated} student(s) archived: {reason or 'No reason provided'}")

        return Response({
            "archived_count": updated,
            "processed_ids": list(found_ids),
            "skipped_ids": missing_ids,
            "message": f"Successfully archived {updated} student(s)."
        })

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def bulk_restore(self, request):
        ids = request.data.get("ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No student IDs provided."}, status=400)

        students = Student.objects.filter(id__in=ids)
        found_ids = set(students.values_list("id", flat=True))
        missing_ids = [i for i in ids if i not in found_ids]

        with transaction.atomic():
            restored = students.filter(is_archived=True).update(is_archived=False)
            audit(request, "BULK_RESTORE", "students", f"{restored} student(s) restored")

        return Response({
            "restored_count": restored,
            "processed_ids": list(found_ids),
            "skipped_ids": missing_ids,
            "message": f"Successfully restored {restored} student(s)."
        })

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin], url_path="bulk-permanent-delete")
    def bulk_permanent_delete(self, request):
        ids = request.data.get("ids", [])
        confirm = request.data.get("confirmation_phrase", "").strip()
        reason = request.data.get("reason", "").strip()
        if confirm != "DELETE PERMANENTLY":
            return Response({"detail": "You must type 'DELETE PERMANENTLY' to confirm high-risk permanent deletion."}, status=400)
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No student IDs provided."}, status=400)

        students = Student.objects.filter(id__in=ids)
        deleted = []
        blocked = []

        with transaction.atomic():
            for s in students:
                eligible, err = check_student_eligible_for_permanent_deletion(s)
                if not eligible:
                    blocked.append({"id": s.id, "name": s.full_name, "reason": err})
                else:
                    label = f"{s.full_name} ({s.index_no})"
                    s.delete()
                    deleted.append(s.id)
                    audit(request, "PERMANENT_DELETE", "students", f"{label} deleted: {reason or 'Bulk permanent delete'}")

        return Response({
            "deleted_count": len(deleted),
            "blocked_count": len(blocked),
            "deleted_ids": deleted,
            "blocked": blocked,
            "message": f"Permanently deleted {len(deleted)} student(s). {len(blocked)} student(s) protected from deletion due to historical records."
        })

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

    @action(detail=False, methods=["post"])
    def bulk_archive(self, request):
        ids = request.data.get("ids", [])
        reason = request.data.get("reason", "").strip()
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No parent IDs provided."}, status=400)
        parents = User.objects.filter(id__in=ids, role=R.PARENT)
        updated = parents.filter(is_archived=False).update(is_archived=True, is_active=False)
        audit(request, "BULK_ARCHIVE", "parents", f"{updated} parent(s) archived: {reason or 'No reason provided'}")
        return Response({"archived_count": updated, "message": f"Successfully archived {updated} parent(s)."})

    @action(detail=False, methods=["post"])
    def bulk_restore(self, request):
        ids = request.data.get("ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No parent IDs provided."}, status=400)
        parents = User.objects.filter(id__in=ids, role=R.PARENT)
        restored = parents.filter(is_archived=True).update(is_archived=False, is_active=True)
        audit(request, "BULK_RESTORE", "parents", f"{restored} parent(s) restored")
        return Response({"restored_count": restored, "message": f"Successfully restored {restored} parent(s)."})

    @action(detail=False, methods=["post"], url_path="bulk-permanent-delete")
    def bulk_permanent_delete(self, request):
        ids = request.data.get("ids", [])
        confirm = request.data.get("confirmation_phrase", "").strip()
        reason = request.data.get("reason", "").strip()
        if confirm != "DELETE PERMANENTLY":
            return Response({"detail": "You must type 'DELETE PERMANENTLY' to confirm high-risk permanent deletion."}, status=400)
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No parent IDs provided."}, status=400)
        parents = User.objects.filter(id__in=ids, role=R.PARENT)
        deleted = []
        blocked = []
        with transaction.atomic():
            for p in parents:
                if not p.is_archived:
                    blocked.append({"id": p.id, "name": p.full_name, "reason": "Parent must be archived before permanent deletion."})
                else:
                    label = str(p)
                    try:
                        p.delete()
                        deleted.append(p.id)
                        audit(request, "PERMANENT_DELETE", "parents", f"{label} deleted: {reason or 'Bulk permanent delete'}")
                    except ProtectedError:
                        blocked.append({"id": p.id, "name": p.full_name, "reason": "Parent record is in use."})
        return Response({
            "deleted_count": len(deleted),
            "blocked_count": len(blocked),
            "deleted_ids": deleted,
            "blocked": blocked,
            "message": f"Permanently deleted {len(deleted)} parent(s)."
        })


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
        if self.action == "list":
            arch_param = self.request.query_params.get("is_archived")
            if arch_param in ("true", "True", "1"):
                qs = qs.filter(is_archived=True)
            elif arch_param in ("false", "False", "0") or "is_archived" not in self.request.query_params:
                qs = qs.filter(is_archived=False)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.query_params.get("permanent") == "true":
            user = instance.user
            if user and user.role == R.ADMIN:
                return Response({"detail": "Administrator accounts cannot be permanently deleted."}, status=400)
            eligible, err = check_teacher_eligible_for_permanent_deletion(instance)
            if not eligible:
                return Response({"detail": f"Cannot permanently delete {instance}: {err}"}, status=400)
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
        eligible, err = check_teacher_eligible_for_permanent_deletion(instance)
        if not eligible:
            return Response({"detail": f"Cannot permanently delete {instance}: {err}"}, status=400)
        label = str(instance)
        user = instance.user
        if user:
            user.delete()
        else:
            instance.delete()
        audit(request, "PERMANENT_DELETE", "teachers", label)
        return Response(status=204)

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def bulk_archive(self, request):
        ids = request.data.get("ids", [])
        reason = request.data.get("reason", "").strip()
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No teacher IDs provided."}, status=400)

        profiles = TeacherProfile.objects.filter(id__in=ids).select_related("user")
        found_ids = set(profiles.values_list("id", flat=True))
        missing_ids = [i for i in ids if i not in found_ids]

        with transaction.atomic():
            user_ids = [p.user_id for p in profiles if p.user_id]
            User.objects.filter(id__in=user_ids).update(is_active=False)
            updated = profiles.filter(is_archived=False).update(is_archived=True)
            audit(request, "BULK_ARCHIVE", "teachers", f"{updated} teacher(s) archived: {reason or 'No reason provided'}")

        return Response({
            "archived_count": updated,
            "processed_ids": list(found_ids),
            "skipped_ids": missing_ids,
            "message": f"Successfully archived {updated} teacher(s)."
        })

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def bulk_restore(self, request):
        ids = request.data.get("ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No teacher IDs provided."}, status=400)

        profiles = TeacherProfile.objects.filter(id__in=ids).select_related("user")
        found_ids = set(profiles.values_list("id", flat=True))
        missing_ids = [i for i in ids if i not in found_ids]

        with transaction.atomic():
            user_ids = [p.user_id for p in profiles if p.user_id]
            User.objects.filter(id__in=user_ids).update(is_active=True)
            restored = profiles.filter(is_archived=True).update(is_archived=False)
            audit(request, "BULK_RESTORE", "teachers", f"{restored} teacher(s) restored")

        return Response({
            "restored_count": restored,
            "processed_ids": list(found_ids),
            "skipped_ids": missing_ids,
            "message": f"Successfully restored {restored} teacher(s)."
        })

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin], url_path="bulk-permanent-delete")
    def bulk_permanent_delete(self, request):
        ids = request.data.get("ids", [])
        confirm = request.data.get("confirmation_phrase", "").strip()
        reason = request.data.get("reason", "").strip()
        if confirm != "DELETE PERMANENTLY":
            return Response({"detail": "You must type 'DELETE PERMANENTLY' to confirm high-risk permanent deletion."}, status=400)
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No teacher IDs provided."}, status=400)

        profiles = TeacherProfile.objects.filter(id__in=ids).select_related("user")
        deleted = []
        blocked = []

        with transaction.atomic():
            for p in profiles:
                eligible, err = check_teacher_eligible_for_permanent_deletion(p)
                if not eligible:
                    blocked.append({"id": p.id, "name": p.user.full_name if p.user else str(p), "reason": err})
                else:
                    label = str(p)
                    user = p.user
                    if user:
                        user.delete()
                    else:
                        p.delete()
                    deleted.append(p.id)
                    audit(request, "PERMANENT_DELETE", "teachers", f"{label} deleted: {reason or 'Bulk permanent delete'}")

        return Response({
            "deleted_count": len(deleted),
            "blocked_count": len(blocked),
            "deleted_ids": deleted,
            "blocked": blocked,
            "message": f"Permanently deleted {len(deleted)} teacher(s). {len(blocked)} teacher(s) protected from deletion due to historical records."
        })

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

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def bulk_archive(self, request):
        ids = request.data.get("ids", [])
        reason = request.data.get("reason", "").strip()
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No staff IDs provided."}, status=400)
        members = StaffMember.objects.filter(id__in=ids)
        updated = members.filter(status="ACTIVE").update(status="INACTIVE")
        audit(request, "BULK_ARCHIVE", "staff", f"{updated} staff deactivated: {reason or 'No reason provided'}")
        return Response({"archived_count": updated, "message": f"Successfully deactivated {updated} staff member(s)."})

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def bulk_restore(self, request):
        ids = request.data.get("ids", [])
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No staff IDs provided."}, status=400)
        members = StaffMember.objects.filter(id__in=ids)
        restored = members.filter(status="INACTIVE").update(status="ACTIVE")
        audit(request, "BULK_RESTORE", "staff", f"{restored} staff restored")
        return Response({"restored_count": restored, "message": f"Successfully activated {restored} staff member(s)."})

    @action(detail=False, methods=["post"], permission_classes=[IsAdmin], url_path="bulk-permanent-delete")
    def bulk_permanent_delete(self, request):
        ids = request.data.get("ids", [])
        confirm = request.data.get("confirmation_phrase", "").strip()
        reason = request.data.get("reason", "").strip()
        if confirm != "DELETE PERMANENTLY":
            return Response({"detail": "You must type 'DELETE PERMANENTLY' to confirm high-risk permanent deletion."}, status=400)
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "No staff IDs provided."}, status=400)

        members = StaffMember.objects.filter(id__in=ids)
        deleted = []
        blocked = []
        with transaction.atomic():
            for m in members:
                if m.status != "INACTIVE":
                    blocked.append({"id": m.id, "name": m.name, "reason": "Staff member must be deactivated before permanent deletion."})
                else:
                    label = str(m)
                    try:
                        m.delete()
                        deleted.append(m.id)
                        audit(request, "PERMANENT_DELETE", "staff", f"{label} deleted: {reason or 'Bulk permanent delete'}")
                    except ProtectedError:
                        blocked.append({"id": m.id, "name": m.name, "reason": "Protected record in use."})
        return Response({
            "deleted_count": len(deleted),
            "blocked_count": len(blocked),
            "deleted_ids": deleted,
            "blocked": blocked,
            "message": f"Permanently deleted {len(deleted)} staff member(s)."
        })
