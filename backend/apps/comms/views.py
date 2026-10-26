from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditMixin
from apps.audit.services import audit
from apps.users.models import User
from apps.users.permissions import AdminWriteAuthenticatedRead, IsAdmin, IsSchoolUser, roles_required

from .models import Enquiry, EnquiryMessage, Event, Notification
from .services import notify, notify_many


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = "__all__"


class EventViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [AdminWriteAuthenticatedRead]
    serializer_class = EventSerializer
    audit_module = "events"
    filterset_fields = ["kind", "audience", "start_date"]
    search_fields = ["title", "description"]

    def get_queryset(self):
        u = self.request.user
        qs = Event.objects.all()
        if u.role == "ADMIN":
            return qs
        return qs.filter(Q(audience="ALL") | Q(audience=u.role))

    def perform_create(self, serializer):
        ev = serializer.save()
        audit(self.request, "CREATE", "events", str(ev.title))
        roles = {"ALL": ["TEACHER", "PARENT"], "TEACHER": ["TEACHER"], "PARENT": ["PARENT"]}[ev.audience]
        kind = "ANNOUNCEMENT" if ev.kind == "ANNOUNCEMENT" else "EVENT"
        notify_many(User.objects.filter(role__in=roles, is_active=True), kind, ev.title, ev.description[:300])


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "kind", "priority", "title", "body", "is_read", "created_at"]
        read_only_fields = fields


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsSchoolUser]
    serializer_class = NotificationSerializer
    filterset_fields = ["kind", "is_read", "priority"]
    search_fields = ["title", "body"]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        self.get_queryset().filter(pk=pk).update(is_read=True)
        return Response({"ok": True})

    @action(detail=False, methods=["post"])
    def read_all(self, request):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({"ok": True})

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        return Response({"count": self.get_queryset().filter(is_read=False).count()})

    @action(detail=True, methods=["post", "delete"])
    def dismiss(self, request, pk=None):
        self.get_queryset().filter(pk=pk).delete()
        return Response({"ok": True})


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.full_name", read_only=True)
    sender_role = serializers.CharField(source="sender.role", read_only=True)

    class Meta:
        model = EnquiryMessage
        fields = ["id", "sender", "sender_name", "sender_role", "body", "read_at", "created_at"]
        read_only_fields = ["id", "sender", "read_at", "created_at"]


class EnquirySerializer(serializers.ModelSerializer):
    parent_name = serializers.CharField(source="parent.full_name", read_only=True)
    parent_phone = serializers.CharField(source="parent.phone", read_only=True)
    parent_address = serializers.CharField(source="parent.address", read_only=True)
    parent_photo = serializers.ImageField(source="parent.photo", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True, default=None)
    student_index_no = serializers.CharField(source="student.index_no", read_only=True, default=None)
    body = serializers.CharField(write_only=True, max_length=4000)
    messages = MessageSerializer(many=True, read_only=True)
    unread = serializers.SerializerMethodField()
    client_txn_id = serializers.CharField(max_length=64, required=False, allow_null=True, allow_blank=True)

    class Meta:
        model = Enquiry
        fields = ["id", "parent_name", "parent_phone", "parent_address", "parent_photo", "student", "student_name",
                  "student_index_no", "subject", "status", "client_txn_id", "body", "messages", "unread",
                  "created_at", "updated_at"]
        read_only_fields = ["status", "created_at", "updated_at"]

    def get_unread(self, obj):
        me = self.context["request"].user
        return sum(1 for m in obj.messages.all() if m.read_at is None and m.sender_id != me.id)


class EnquiryViewSet(viewsets.ModelViewSet):
    permission_classes = [roles_required(User.Role.ADMIN, User.Role.PARENT, User.Role.TEACHER)]
    serializer_class = EnquirySerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["status"]
    search_fields = ["subject", "parent__first_name", "parent__last_name", "messages__body"]

    def _visible_queryset(self):
        user = self.request.user
        qs = Enquiry.objects.select_related("parent", "student", "student__stream__class_teacher").prefetch_related(
            "messages__sender", "archived_by"
        )
        if user.role == "PARENT":
            qs = qs.filter(parent=user)
        elif user.role == "TEACHER":
            qs = qs.filter(student__stream__class_teacher=user)
        return qs.distinct()

    def get_queryset(self):
        qs = self._visible_queryset()
        if self.request.query_params.get("archived") == "true":
            return qs.filter(archived_by=self.request.user).distinct()
        return qs.exclude(archived_by=self.request.user).distinct()

    @action(detail=True, methods=["get", "post"])
    def typing(self, request, pk=None):
        enq = self.get_object()
        key = f"enquiry:{enq.pk}:typing:{request.user.pk}"
        if request.method == "POST":
            if request.data.get("typing") is True:
                cache.set(key, True, timeout=5)
            else:
                cache.delete(key)
            return Response({"typing": request.data.get("typing") is True})

        participant_ids = {enq.parent_id}
        if request.user.role == User.Role.PARENT:
            participant_ids.update(User.objects.filter(role=User.Role.ADMIN, is_active=True).values_list("id", flat=True))
            class_teacher_id = enq.student.stream.class_teacher_id if enq.student_id and enq.student.stream_id else None
            if class_teacher_id:
                participant_ids.add(class_teacher_id)
        participants = User.objects.filter(pk__in=participant_ids, is_active=True).exclude(pk=request.user.pk)
        return Response([
            {"id": user.pk, "full_name": user.full_name, "role": user.role}
            for user in participants if cache.get(f"enquiry:{enq.pk}:typing:{user.pk}")
        ])

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        if request.user.role != "PARENT":
            return Response({"detail": "Only parents can open enquiries."}, status=403)
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        txn = ser.validated_data.get("client_txn_id") or None
        ser.validated_data["client_txn_id"] = txn
        if txn and Enquiry.objects.filter(client_txn_id=txn).exists():
            return Response({"detail": "Already processed.", "duplicate": True})
        student = ser.validated_data.get("student")
        if student and not student.parents.filter(pk=request.user.pk).exists():
            return Response({"detail": "That student is not linked to your account."}, status=403)
        body = ser.validated_data.pop("body")
        enq = ser.save(parent=request.user)
        EnquiryMessage.objects.create(enquiry=enq, sender=request.user, body=body)
        child_context = f" — {student.full_name} ({student.index_no})" if student else ""
        notify_many(User.objects.filter(role="ADMIN", is_active=True), "SYSTEM", "New parent enquiry",
                    f"{request.user.full_name}{child_context}: {enq.subject}")
        if student and student.stream and student.stream.class_teacher_id:
            notify(student.stream.class_teacher, "SYSTEM", "New parent enquiry",
                   f"{request.user.full_name} · {student.full_name}: {enq.subject}")
        return Response(self.get_serializer(enq).data, status=201)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def reply(self, request, pk=None):
        enq = self.get_object()
        body = str(request.data.get("body", "")).strip()
        if not body or len(body) > 4000:
            return Response({"body": ["Message is required (max 4000 characters)."]}, status=400)
        EnquiryMessage.objects.create(enquiry=enq, sender=request.user, body=body)
        if request.user.role in ("ADMIN", "TEACHER"):
            enq.status = "ANSWERED"
            notify(enq.parent, "ANNOUNCEMENT", "School replied to your enquiry", enq.subject)
        else:
            enq.status = "OPEN"
            notify_many(User.objects.filter(role="ADMIN", is_active=True), "SYSTEM", "Parent follow-up", enq.subject)
            if enq.student and enq.student.stream and enq.student.stream.class_teacher_id:
                notify(enq.student.stream.class_teacher, "SYSTEM", "Parent follow-up",
                       f"{enq.parent.full_name} · {enq.student.full_name}: {enq.subject}")
        enq.save()
        audit(request, "REPLY", "enquiries", enq.subject)
        return Response(self.get_serializer(self.get_queryset().get(pk=enq.pk)).data)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        enq = self.get_object()
        enq.archived_by.add(request.user)
        audit(request, "ARCHIVE", "enquiries", enq.subject)
        return Response({"ok": True, "archived": True})

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        enq = self._visible_queryset().filter(pk=pk, archived_by=request.user).first()
        if not enq:
            return Response({"detail": "Not found."}, status=404)
        enq.archived_by.remove(request.user)
        audit(request, "RESTORE", "enquiries", enq.subject)
        return Response({"ok": True, "archived": False})

    @action(detail=True, methods=["post"])
    def delete_messages(self, request, pk=None):
        enq = self._visible_queryset().filter(pk=pk).first()
        if not enq:
            return Response({"detail": "Not found."}, status=404)
        message_ids = request.data.get("message_ids", [])
        if not isinstance(message_ids, list) or not message_ids:
            return Response({"message_ids": ["Select at least one message."]}, status=400)
        messages = enq.messages.filter(pk__in=message_ids)
        if messages.count() != len(set(message_ids)):
            return Response({"detail": "One or more selected messages were not found."}, status=404)
        if request.user.role != "ADMIN" and messages.exclude(sender=request.user).exists():
            return Response({"detail": "You can only delete messages you sent."}, status=403)
        deleted = messages.count()
        messages.delete()
        audit(request, "DELETE_MESSAGES", "enquiries", f"{enq.subject} ({deleted})")
        return Response({"deleted": deleted})

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        enq = self._visible_queryset().filter(pk=pk).first()
        if not enq:
            return Response({"detail": "Not found."}, status=404)
        enq.messages.exclude(sender=request.user).filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"ok": True})

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def close(self, request, pk=None):
        enq = self.get_object()
        enq.status = "CLOSED"
        enq.save(update_fields=["status", "updated_at"])
        return Response({"ok": True})
