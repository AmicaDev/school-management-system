from django.db import IntegrityError, transaction
from django.db.models import Count
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.academics.models import Term
from apps.audit.services import audit
from apps.people.access import teacher_can_teach, visible_students
from apps.people.models import Student
from apps.users.permissions import IsSchoolUser

from .models import AttendanceRecord, SyncTransaction


class AttendanceSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    gender = serializers.CharField(source="student.gender", read_only=True, default="")
    class_name = serializers.CharField(source="stream.school_class.name", read_only=True, default="")
    stream_name = serializers.CharField(source="stream.name", read_only=True, default="")
    subject_name = serializers.CharField(source="subject.name", read_only=True, default="")
    term_name = serializers.CharField(source="term.name", read_only=True, default="")
    academic_year = serializers.CharField(source="term.year.name", read_only=True, default="")

    class Meta:
        model = AttendanceRecord
        fields = [
            "id", "student", "student_name", "gender", "class_name", "stream_name", "stream",
            "subject", "subject_name", "date", "status", "term", "term_name", "academic_year"
        ]


class BulkRecord(serializers.Serializer):
    student = serializers.IntegerField()
    status = serializers.ChoiceField(choices=AttendanceRecord.Status.choices)


class BulkAttendance(serializers.Serializer):
    client_txn_id = serializers.CharField(max_length=64)
    stream = serializers.IntegerField()
    date = serializers.DateField()
    subject = serializers.IntegerField(required=False, allow_null=True)
    records = BulkRecord(many=True)


class AttendanceViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsSchoolUser]
    serializer_class = AttendanceSerializer
    filterset_fields = {
        "stream": ["exact"],
        "stream__school_class": ["exact"],
        "student": ["exact"],
        "student__gender": ["exact"],
        "date": ["exact", "gte", "lte"],
        "status": ["exact"],
        "subject": ["exact"],
        "term": ["exact"],
        "term__year": ["exact"],
    }
    search_fields = ["student__first_name", "student__last_name", "student__index_no"]

    def get_queryset(self):
        ids = visible_students(self.request.user).values("id")
        return AttendanceRecord.objects.filter(student__in=ids).select_related(
            "student", "stream__school_class", "subject", "term__year"
        )

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Idempotent batch save used by online and offline-synced submissions."""
        if request.user.role not in ("ADMIN", "TEACHER"):
            return Response({"detail": "Not allowed."}, status=403)
        ser = BulkAttendance(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if SyncTransaction.objects.filter(client_txn_id=d["client_txn_id"]).exists():
            return Response({"detail": "Already processed.", "duplicate": True})
        if not teacher_can_teach(request.user, d["stream"], d.get("subject")):
            return Response({"detail": "You are not assigned to this class."}, status=403)
        allowed = set(Student.objects.filter(stream_id=d["stream"], is_archived=False).values_list("id", flat=True))
        seen = set()
        for r in d["records"]:
            if r["student"] not in allowed:
                return Response({"detail": f"Student {r['student']} is not in this stream."}, status=400)
            if r["student"] in seen:
                return Response({"detail": "Duplicate student in submission."}, status=400)
            seen.add(r["student"])
        term = Term.objects.filter(is_active=True).first()
        try:
            with transaction.atomic():
                for r in d["records"]:
                    AttendanceRecord.objects.update_or_create(
                        student_id=r["student"], date=d["date"], subject_id=d.get("subject"),
                        defaults={"status": r["status"], "stream_id": d["stream"], "term": term, "recorded_by": request.user})
                SyncTransaction.objects.create(client_txn_id=d["client_txn_id"], kind="attendance", user=request.user)
        except IntegrityError:
            return Response({"detail": "Already processed.", "duplicate": True})
        audit(request, "ATTENDANCE_SUBMIT", "attendance", f"stream {d['stream']} {d['date']} ({len(d['records'])})")
        return Response({"saved": len(d["records"])})

    @action(detail=False, methods=["get"])
    def sheet(self, request):
        """Roster for a stream/date merged with any saved states."""
        stream, date = request.query_params.get("stream"), request.query_params.get("date")
        subject = request.query_params.get("subject") or None
        if not stream or not date:
            return Response({"detail": "stream and date are required."}, status=400)
        if not str(stream).isdigit() or (subject and not str(subject).isdigit()):
            return Response({"detail": "Invalid stream or subject."}, status=400)
        if not teacher_can_teach(request.user, int(stream)):
            return Response({"detail": "You are not assigned to this class."}, status=403)
        saved = dict(AttendanceRecord.objects.filter(stream_id=stream, date=date, subject_id=subject)
                     .values_list("student_id", "status"))
        roster = Student.objects.filter(stream_id=stream, is_archived=False).order_by("last_name", "first_name")
        return Response([{"student": s.id, "name": s.full_name, "index_no": s.index_no, "status": saved.get(s.id)}
                         for s in roster])

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.filter_queryset(self.get_queryset())
        return Response(dict(qs.values_list("status").annotate(n=Count("id"))))
