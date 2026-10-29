"""Central object-level access rules. Every student-related endpoint goes through these helpers."""
from apps.academics.models import TeachingAssignment

from .models import Student


def visible_students(user):
    qs = Student.objects.select_related("stream__school_class")
    role = user.role
    if role in ("ADMIN", "BURSAR"):
        return qs
    if role == "PARENT":
        return qs.filter(parents=user, is_archived=False)
    if role == "TEACHER":
        streams = set(TeachingAssignment.objects.filter(teacher=user, is_active=True).values_list("stream_id", flat=True))
        streams |= set(user.class_streams.values_list("id", flat=True))
        return qs.filter(stream_id__in=streams, is_archived=False)
    return qs.none()


def teacher_can_teach(user, stream_id, subject_id=None, paper_number=None):
    if user.role == "ADMIN":
        return True
    if user.role != "TEACHER":
        return False
    if subject_id is None:
        return (user.class_streams.filter(id=stream_id).exists()
                or TeachingAssignment.objects.filter(teacher=user, stream_id=stream_id, is_active=True).exists())
    assignments = TeachingAssignment.objects.filter(teacher=user, stream_id=stream_id, subject_id=subject_id, is_active=True)
    if paper_number is not None:
        assignments = assignments.filter(paper_number=paper_number)
    return assignments.exists()
