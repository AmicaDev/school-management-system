from django.http import FileResponse, Http404
from rest_framework import status as http
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.academics.models import Stream, Term
from apps.audit.services import audit
from apps.people.access import teacher_can_teach, visible_students
from apps.users.permissions import IsAdminOrTeacher, IsSchoolUser

from .models import ReportJob
from .pdf import build_report_card
from .tasks import generate_class_report_cards, run_job


def _job_json(j):
    return {"id": j.id, "stream": str(j.stream), "term": str(j.term), "status": j.status, "count": j.count, "error": j.error,
            "created_at": j.created_at, "finished_at": j.finished_at, "ready": j.status == "DONE" and bool(j.file)}


@api_view(["GET"])
@permission_classes([IsSchoolUser])
def report_card(request, student_id, term_id):
    student = visible_students(request.user).filter(pk=student_id).first()  # same object-level rule as every other endpoint
    if not student:
        raise Http404
    term = Term.objects.select_related("year").filter(pk=term_id).first()
    if not term:
        return Response({"detail": "Term not found."}, status=404)
    buf = build_report_card(student, term)
    audit(request, "REPORT_GENERATE", "reports", f"{student.index_no} {term}")
    return FileResponse(buf, as_attachment=True, filename=f"report-card-{student.index_no}-{term_id}.pdf", content_type="application/pdf")


@api_view(["GET", "POST"])
@permission_classes([IsAdminOrTeacher])
def class_jobs(request):
    """POST {stream, term}: queue a background job that builds one ZIP of report cards. GET: recent jobs."""
    if request.method == "GET":
        qs = ReportJob.objects.select_related("stream__school_class", "term__year")
        if request.user.role != "ADMIN":
            qs = qs.filter(requested_by=request.user)
        return Response([_job_json(j) for j in qs[:15]])
    try:
        stream = Stream.objects.select_related("school_class").get(pk=int(request.data.get("stream")))
        term = Term.objects.select_related("year").get(pk=int(request.data.get("term")))
    except (TypeError, ValueError, Stream.DoesNotExist, Term.DoesNotExist):
        return Response({"detail": "Choose a valid class and term."}, status=400)
    if not teacher_can_teach(request.user, stream.id):
        return Response({"detail": "You are not assigned to this class."}, status=403)
    job = ReportJob.objects.create(requested_by=request.user, stream=stream, term=term)
    audit(request, "REPORT_BATCH", "reports", f"{stream} {term}")
    try:
        generate_class_report_cards.apply_async(args=[job.id], retry=False)
    except Exception:  # broker unreachable: still deliver, inline
        run_job(job.id)
    job.refresh_from_db()
    return Response(_job_json(job), status=http.HTTP_202_ACCEPTED)


@api_view(["GET"])
@permission_classes([IsAdminOrTeacher])
def job_download(request, job_id):
    job = ReportJob.objects.filter(pk=job_id).first()
    if not job or (request.user.role != "ADMIN" and job.requested_by_id != request.user.id):
        raise Http404
    if job.status != "DONE" or not job.file:
        return Response({"detail": "The report cards are not ready yet."}, status=409)
    return FileResponse(job.file.open("rb"), as_attachment=True, filename=f"report-cards-{job.id}.zip", content_type="application/zip")
