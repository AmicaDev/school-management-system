"""Retention safeguards and eligibility checkers for permanent record deletion."""

def check_student_eligible_for_permanent_deletion(student):
    """
    Determines whether a Student can be safely deleted permanently.
    Returns (eligible: bool, reason: str).
    Permanent deletion is forbidden if:
      - The student is referenced by assessments / examination marks.
      - The student is referenced by attendance records.
      - The student is referenced by report comments.
      - The student has financial invoices or payments (when finance module is present).
    """
    if not student.is_archived:
        return False, "Record must be archived before it can be permanently deleted."
    if student.assessments.exists():
        return False, f"Linked to {student.assessments.count()} academic assessment mark(s). Cannot delete to protect historical academic records."
    if student.attendance.exists():
        return False, f"Linked to {student.attendance.count()} attendance record(s). Cannot delete to preserve school attendance records."
    if student.comments.exists():
        return False, "Linked to report comments. Archive the record instead."
    if hasattr(student, "invoices") and student.invoices.exists():
        return False, "Linked to financial invoices."
    if hasattr(student, "fee_payments") and student.fee_payments.exists():
        return False, "Linked to payment receipts and financial history."
    return True, ""


def check_teacher_eligible_for_permanent_deletion(teacher_profile):
    """
    Determines whether a TeacherProfile / User can be safely deleted permanently.
    Returns (eligible: bool, reason: str).
    Permanent deletion is forbidden if:
      - The teacher account belongs to an Administrator.
      - The teacher has teaching assignments (active or historical).
      - The teacher is assigned as a class teacher to any stream.
      - The teacher has recorded marks or attendance records.
      - The teacher is in the timetable.
    """
    user = teacher_profile.user
    if user and user.role == "ADMIN":
        return False, "Administrator accounts cannot be permanently deleted."
    if user:
        if user.assignments.exists():
            return False, f"Linked to {user.assignments.count()} teaching assignment(s). Cannot delete to preserve academic assignment history."
        if user.class_streams.exists():
            return False, "Teacher is assigned as class teacher to a stream."
        from apps.results.models import Assessment
        if Assessment.objects.filter(entered_by=user).exists():
            return False, "Teacher entered academic assessment marks that must be retained."
        from apps.attendance.models import AttendanceRecord
        if AttendanceRecord.objects.filter(recorded_by=user).exists():
            return False, "Teacher recorded attendance sessions that must be retained."
        if hasattr(user, "timetable") and user.timetable.exists():
            return False, "Teacher is scheduled in timetable lessons."
    return True, ""

