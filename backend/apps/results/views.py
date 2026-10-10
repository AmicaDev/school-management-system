from decimal import Decimal

from django.db import IntegrityError, transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.academics.models import Term
from apps.attendance.models import SyncTransaction
from apps.audit.services import audit
from apps.comms.services import notify
from apps.people.access import teacher_can_teach, visible_students
from apps.people.models import Student
from apps.users.permissions import IsAdminOrTeacher, IsSchoolUser

from .models import Assessment, ReportComment
from .services import _subject_rows, grade_for, term_summary, trend


class AssessmentSerializer(serializers.ModelSerializer):
    percent = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)

    class Meta:
        model = Assessment
        fields = ["id", "student", "subject", "paper_number", "term", "exam_type", "title", "score", "max_score", "percent"]


class EntrySerializer(serializers.Serializer):
    student = serializers.IntegerField()
    score = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=Decimal("0"))


class BulkMarks(serializers.Serializer):
    client_txn_id = serializers.CharField(max_length=64)
    stream = serializers.IntegerField()
    subject = serializers.IntegerField()
    paper_number = serializers.IntegerField(min_value=1, default=1)
    term = serializers.IntegerField()
    exam_type = serializers.IntegerField()
    title = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    max_score = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=Decimal("0.01"))
    entries = EntrySerializer(many=True)


class AssessmentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsSchoolUser]
    serializer_class = AssessmentSerializer
    filterset_fields = ["student", "subject", "paper_number", "term", "exam_type", "exam_type__code", "student__stream"]

    def get_queryset(self):
        return Assessment.objects.filter(student__in=visible_students(self.request.user).values("id"))

    @action(detail=False, methods=["post"], permission_classes=[IsAdminOrTeacher])
    def bulk(self, request):
        ser = BulkMarks(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        if SyncTransaction.objects.filter(client_txn_id=d["client_txn_id"]).exists():
            return Response({"detail": "Already processed.", "duplicate": True})
        if not teacher_can_teach(request.user, d["stream"], d["subject"], d["paper_number"]):
            return Response({"detail": "You are not assigned to this subject paper and class."}, status=403)
        errors = {}
        roster = set(Student.objects.filter(stream_id=d["stream"], is_archived=False).values_list("id", flat=True))
        seen = set()
        for e in d["entries"]:
            if e["student"] not in roster or e["student"] in seen:
                errors[e["student"]] = "Not in this class or duplicated."
            elif e["score"] > d["max_score"]:
                errors[e["student"]] = f"Score cannot exceed {d['max_score']}."
            seen.add(e["student"])
        if errors:
            return Response({"detail": "Some marks are invalid.", "errors": errors}, status=400)
        term = Term.objects.filter(pk=d["term"]).first()
        from apps.academics.models import ExamType, Subject
        subject = Subject.objects.filter(pk=d["subject"]).first()
        if not term or not ExamType.objects.filter(pk=d["exam_type"], is_active=True).exists() or not subject:
            return Response({"detail": "Unknown term, subject or examination type."}, status=400)
        if d["paper_number"] > subject.number_of_papers:
            return Response({"paper_number": ["This subject does not have that paper number."]}, status=400)
        try:
            with transaction.atomic():
                for e in d["entries"]:
                    Assessment.objects.update_or_create(
                        student_id=e["student"], subject_id=d["subject"], paper_number=d["paper_number"],
                        term=term, exam_type_id=d["exam_type"],
                        title=d["title"], defaults={"score": e["score"], "max_score": d["max_score"],
                                                    "entered_by": request.user})
                SyncTransaction.objects.create(client_txn_id=d["client_txn_id"], kind="marks", user=request.user)
        except IntegrityError:  # same client_txn_id arrived twice at once
            return Response({"detail": "Already processed.", "duplicate": True})
        audit(request, "MARKS_SUBMIT", "results",
              f"stream {d['stream']} subject {d['subject']} paper {d['paper_number']} ({len(d['entries'])})")
        for s in Student.objects.filter(id__in=[e["student"] for e in d["entries"]]).prefetch_related("parents"):
            for p in s.parents.all():
                notify(p, "RESULTS", "New results published", f"New marks recorded for {s.full_name}.")
        return Response({"saved": len(d["entries"])})

    @action(detail=False, methods=["get"])
    def sheet(self, request):
        from apps.academics.models import Subject

        q = request.query_params
        try:
            stream, subject, term, et = int(q["stream"]), int(q["subject"]), int(q["term"]), int(q["exam_type"])
            paper_number = int(q.get("paper_number", 1))
        except (KeyError, ValueError):
            return Response({"detail": "stream, subject, term and exam_type are required; paper_number must be a positive integer."}, status=400)
        if paper_number < 1:
            return Response({"detail": "paper_number must be a positive integer."}, status=400)
        if not Subject.objects.filter(pk=subject, number_of_papers__gte=paper_number).exists():
            return Response({"detail": "This subject does not have that paper number."}, status=400)
        if not teacher_can_teach(request.user, stream, subject, paper_number):
            return Response({"detail": "You are not assigned to this subject paper and class."}, status=403)
        title = q.get("title", "")
        saved = {a.student_id: a for a in Assessment.objects.filter(
            student__stream_id=stream, subject_id=subject, paper_number=paper_number,
            term_id=term, exam_type_id=et, title=title)}
        roster = Student.objects.filter(stream_id=stream, is_archived=False).order_by("last_name", "first_name")
        return Response([{"student": s.id, "name": s.full_name, "index_no": s.index_no,
                          "score": saved[s.id].score if s.id in saved else None,
                          "max_score": saved[s.id].max_score if s.id in saved else None} for s in roster])


@api_view(["GET"])
@permission_classes([IsSchoolUser])
def student_summary(request, student_id, term_id):
    student = visible_students(request.user).filter(pk=student_id).first()
    if not student:
        return Response({"detail": "Not found."}, status=404)
    return Response(term_summary(student, Term.objects.get(pk=term_id)))


@api_view(["GET"])
@permission_classes([IsSchoolUser])
def student_trend(request, student_id):
    student = visible_students(request.user).filter(pk=student_id).first()
    if not student:
        return Response({"detail": "Not found."}, status=404)
    return Response(trend(student))


@api_view(["GET", "PUT"])
@permission_classes([IsSchoolUser])
def comment(request, student_id, term_id):
    student = visible_students(request.user).filter(pk=student_id).first()
    if not student:
        return Response({"detail": "Not found."}, status=404)
    obj, _ = ReportComment.objects.get_or_create(student=student, term_id=term_id)
    if request.method == "PUT":
        u = request.user
        if u.role == "ADMIN":
            obj.head_comment = request.data.get("head_comment", obj.head_comment)
            obj.teacher_comment = request.data.get("teacher_comment", obj.teacher_comment)
        elif u.role == "TEACHER" and student.stream and student.stream.class_teacher_id == u.id:
            obj.teacher_comment = request.data.get("teacher_comment", obj.teacher_comment)  # class teachers only
        else:
            return Response({"detail": "Only the class teacher or an administrator can comment."}, status=403)
        obj.save()
        audit(request, "COMMENT", "results", str(student))
    return Response({"teacher_comment": obj.teacher_comment, "head_comment": obj.head_comment})


@api_view(["GET"])
@permission_classes([IsAdminOrTeacher])
def grid(request):
    """Spreadsheet data: raw marks per exam type plus server-calculated total / grade / remark."""
    from apps.academics.models import ExamType, GradeBand, Subject
    q = request.query_params
    try:
        stream, subject, term = int(q["stream"]), int(q["subject"]), int(q["term"])
    except (KeyError, ValueError):
        return Response({"detail": "stream, subject and term are required."}, status=400)
    try:
        paper_number = int(q.get("paper_number", "1"))
    except ValueError:
        return Response({"detail": "paper_number must be a positive integer."}, status=400)
    if paper_number < 1:
        return Response({"detail": "paper_number must be a positive integer."}, status=400)
    if not teacher_can_teach(request.user, stream, subject, paper_number):
        return Response({"detail": "You are not assigned to this subject paper and class."}, status=403)
    if not Subject.objects.filter(pk=subject, number_of_papers__gte=paper_number).exists():
        return Response({"detail": "This subject does not have that paper number."}, status=400)
    bands, ets = list(GradeBand.objects.all()), list(ExamType.objects.filter(is_active=True))
    by_student = {}
    for a in Assessment.objects.filter(student__stream_id=stream, subject_id=subject, paper_number=paper_number,
                                       term_id=term).select_related("subject"):
        by_student.setdefault(a.student_id, []).append(a)
    rows = []
    for s in Student.objects.filter(stream_id=stream, is_archived=False).order_by("last_name", "first_name"):
        items = by_student.get(s.id, [])
        sub = _subject_rows(items, bands, ets)
        cells = {}
        for a in items:
            cells.setdefault(a.exam_type.code, {"score": a.score, "max": a.max_score})
        rows.append({"student": s.id, "name": s.full_name, "index_no": s.index_no, "cells": cells,
                     "total": sub[0]["total"] if sub else None, "grade": sub[0]["grade"] if sub else "",
                     "remark": sub[0]["remark"] if sub else ""})
    return Response({"paper_number": paper_number,
                     "exam_types": [{"id": e.id, "code": e.code, "name": e.name, "default_max": e.default_max} for e in ets],
                     "rows": rows})


@api_view(["GET"])
@permission_classes([IsAdminOrTeacher])
def class_summary(request):
    q = request.query_params
    try:
        stream, term = int(q["stream"]), Term.objects.get(pk=int(q["term"]))
    except (KeyError, ValueError, Term.DoesNotExist):
        return Response({"detail": "stream and term are required."}, status=400)
    if not teacher_can_teach(request.user, stream):
        return Response({"detail": "You are not assigned to this class."}, status=403)
    out = []
    for s in Student.objects.filter(stream_id=stream, is_archived=False).select_related("stream").order_by("last_name"):
        r = term_summary(s, term)
        out.append({"id": s.id, "index_no": s.index_no, "name": s.full_name, "subjects": len(r["subjects"]),
                    "average": r["average"], "grade": r["grade"], "position": r["position"]["rank"] if r["position"] else None})
    return Response(out)
