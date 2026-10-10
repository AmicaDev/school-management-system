from django.core.cache import cache
from django.db.models import Avg, Count, F
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.attendance.models import AttendanceRecord
from apps.audit.models import AuditLog
from apps.people.models import StaffMember, Student, TeacherProfile
from apps.results.models import Assessment
from apps.results.services import PCT
from apps.users.permissions import IsAdmin


def _gender(qs):
    d = dict(qs.values_list("gender").annotate(n=Count("id")))
    return {"total": sum(d.values()), "male": d.get("M", 0), "female": d.get("F", 0)}


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_overview(request):
    term, year = request.query_params.get("term"), request.query_params.get("year")
    key = f"overview:{year}:{term}"
    data = cache.get(key)
    if data is None:
        att = AttendanceRecord.objects.all()
        ass = Assessment.objects.all()
        if term:
            att, ass = att.filter(term_id=term), ass.filter(term_id=term)
        elif year:
            att, ass = att.filter(term__year_id=year), ass.filter(term__year_id=year)
        data = {
            "students": _gender(Student.objects.filter(is_archived=False)),
            "teachers": _gender(TeacherProfile.objects.filter(is_archived=False)),
            "staff": _gender(StaffMember.objects.filter(status="ACTIVE")),
            "attendance_trend": _att_trend(att),
            "term_performance": [{"term": r["term__name"], "year": r["term__year__name"], "average": round(float(r["a"] or 0), 2)}
                                 for r in ass.values("term__name", "term__year__name", "term__start_date")
                                 .annotate(a=Avg(PCT)).order_by("term__start_date")],
            "class_performance": [{"class": r["student__stream__school_class__name"], "average": round(float(r["a"] or 0), 2)}
                                  for r in ass.values("student__stream__school_class__name")
                                  .annotate(a=Avg(PCT)).order_by("student__stream__school_class__name")],
            "recent_activity": list(AuditLog.objects.exclude(module="developer").exclude(module="auth")
                                    .values("action", "module", "object_repr", "actor_name", "created_at")[:15]),
        }
        cache.set(key, data, 60)  # short cache: dashboards do not hit the DB on every refresh
    return Response(data)


def _att_trend(qs):
    from django.db.models import Q
    rows = qs.values("date").annotate(n=Count("id"), p=Count("id", filter=Q(status="PRESENT"))).order_by("-date")[:30]
    return [{"date": str(r["date"]), "present": r["p"], "total": r["n"]} for r in reversed(list(rows))]
