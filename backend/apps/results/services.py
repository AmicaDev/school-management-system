"""Server-side result calculations (never trusted to the browser).

Per subject: each exam type's percentage is the mean of that type's assessments (score/max*100). The subject mark is the
weighted mean over the exam types that have data, using ExamType.weight. Grade/remark come from the configurable GradeBand
table. The overall average is the mean of subject marks; class position ranks students in the same stream by that average.
"""
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Avg, F, FloatField
from django.db.models.functions import Cast

from apps.academics.models import ExamType, GradeBand
from apps.people.models import Student

from .models import Assessment

Q2 = Decimal("0.01")
PCT = Cast(F("score") * 100 / F("max_score"), FloatField())  # percentage of max, as float


def grade_for(mark, bands=None):
    bands = bands if bands is not None else list(GradeBand.objects.all())
    try:
        m = Decimal(str(mark)).quantize(Q2, ROUND_HALF_UP)
    except Exception:
        return "-", ""
    if bands:
        for b in bands:
            if b.minimum <= m <= b.maximum:
                return b.grade, b.remark
        # marks between bands (e.g. 89.5 with integer bands): fall back to highest band whose minimum is reached
        for b in sorted(bands, key=lambda x: -x.minimum):
            if m >= b.minimum:
                return b.grade, b.remark
    # Fallback to standard official grading scale:
    # 80-100: A (EXCELLENT), 70-79: B (VERY GOOD), 60-69: C (GOOD), 50-59: D (FAIR), 0-49: E (POOR)
    val = float(m)
    if val >= 80:
        return "A", "EXCELLENT"
    if val >= 70:
        return "B", "VERY GOOD"
    if val >= 60:
        return "C", "GOOD"
    if val >= 50:
        return "D", "FAIR"
    return "E", "POOR"


def _subject_rows(assessments, bands, exam_types, teacher_initials=None):
    by_subject = defaultdict(lambda: defaultdict(list))
    names = {}
    for a in assessments:
        by_subject[a.subject_id][a.exam_type_id].append(a)
        names[a.subject_id] = (a.subject.name, a.subject.code)
    rows = []
    for sid, per_type in by_subject.items():
        parts, raw_parts, wsum, wtot = {}, {}, Decimal(0), Decimal(0)
        bot_score = None
        eot_score = None
        mid_score = None
        for et in exam_types:
            ass_list = per_type.get(et.id)
            if ass_list:
                pct = sum(a.percent for a in ass_list) / len(ass_list)
                raw_sc = sum(a.score for a in ass_list) / len(ass_list)
                code_upper = et.code.upper()
                if code_upper in ("FINAL", "EOT", "END", "END_OF_TERM", "E_O_T"):
                    # Final Term Exams (80) should not be converted to percentage;
                    # marks obtained at final is taken as obtained (e.g. 20 is 20, not 25%).
                    eot_score = raw_sc
                    parts[et.code] = raw_sc.quantize(Q2, ROUND_HALF_UP)
                elif code_upper in ("BOT", "BEGINNING_OF_TERM", "B_O_T"):
                    bot_score = raw_sc
                    parts[et.code] = raw_sc.quantize(Q2, ROUND_HALF_UP)
                elif code_upper in ("MID", "MIDTERM", "MID_TERM", "M_T"):
                    mid_score = raw_sc
                    parts[et.code] = raw_sc.quantize(Q2, ROUND_HALF_UP)
                else:
                    parts[et.code] = pct.quantize(Q2, ROUND_HALF_UP)
                raw_parts[et.code] = raw_sc.quantize(Q2, ROUND_HALF_UP)
                wsum += pct * et.weight
                wtot += et.weight

        # Calculation rule:
        # BOT is completely EXCLUDED from final score calculations.
        # Mid-Term replaces BOT: Teachers enter only Mid-Term (out of 20 marks),
        # then the system calculates C1, AVG, IDENT, DESCRIPTOR, GRADE, EOT as before with BOT.
        # final_score = Mid_value (out of 20) + eot_value (out of 80) = 100.
        ca_score = mid_score if mid_score is not None else None
        if ca_score is None and bot_score is not None:
            # Safe fallback if only legacy BOT score exists
            ca_score = bot_score

        if ca_score is not None or eot_score is not None:
            tot = Decimal(0)
            if ca_score is not None:
                tot += Decimal(str(round(float(ca_score), 2)))
            if eot_score is not None:
                tot += Decimal(str(round(float(eot_score), 2)))
            total = tot.quantize(Q2, ROUND_HALF_UP)
        else:
            total = (wsum / wtot) if wtot else Decimal(0)
            total = total.quantize(Q2, ROUND_HALF_UP)

        grade, remark = grade_for(total, bands)
        c1 = round((float(ca_score) / 20.0) * 3.0, 1) if ca_score is not None else None
        c2 = c1
        avg = c1
        ident = None
        descriptor = ""
        if avg is not None:
            r_avg = round(float(avg))
            if r_avg <= 1:
                ident = 1
                descriptor = "BASIC"
            elif r_avg == 2:
                ident = 2
                descriptor = "MODERATE"
            else:
                ident = 3
                descriptor = "OUTSTANDING"

        initials = (teacher_initials or {}).get(sid, "")
        rows.append({
            "subject_id": sid,
            "subject": names[sid][0],
            "code": names[sid][1],
            "components": parts,
            "raw_components": raw_parts,
            "mid_score": float(ca_score) if ca_score is not None else None,
            "eot_score": float(eot_score) if eot_score is not None else None,
            "c1": c1,
            "c2": c2,
            "avg": avg,
            "ident": ident,
            "descriptor": descriptor,
            "total": total,
            "grade": grade,
            "remark": remark,
            "teacher_initials": initials,
        })
    return sorted(rows, key=lambda r: r["subject"])


def term_summary(student, term):
    bands = list(GradeBand.objects.all())
    ets = list(ExamType.objects.filter(is_active=True))
    qs = Assessment.objects.filter(student=student, term=term).select_related("subject")
    teacher_initials = {}
    if getattr(student, "stream_id", None):
        from apps.academics.models import TeachingAssignment
        for ta in TeachingAssignment.objects.filter(stream_id=student.stream_id).select_related("teacher"):
            fn = ta.teacher.first_name[:1] if ta.teacher.first_name else ""
            ln = ta.teacher.last_name[:1] if ta.teacher.last_name else ""
            inits = (fn + ln).upper() or ta.teacher.username[:2].upper()
            teacher_initials[ta.subject_id] = inits
    rows = _subject_rows(qs, bands, ets, teacher_initials=teacher_initials)
    average = (sum(r["total"] for r in rows) / len(rows)).quantize(Q2, ROUND_HALF_UP) if rows else Decimal(0)
    grade, remark = grade_for(average, bands)
    return {"subjects": rows, "total": sum((r["total"] for r in rows), Decimal(0)), "average": average, "grade": grade,
            "remark": remark, "exam_types": [{"code": e.code, "name": e.name} for e in ets],
            "position": class_position(student, term, average)}


def class_position(student, term, average=None):
    if not student.stream_id:
        return None
    peers = Student.objects.filter(stream_id=student.stream_id, is_archived=False).values_list("id", flat=True)
    # approximate ranking using raw percentage averages per student (single query) to keep this endpoint cheap
    avgs = (Assessment.objects.filter(term=term, student_id__in=peers)
            .values("student_id").annotate(a=Avg(PCT)))
    scores = {r["student_id"]: float(r["a"]) for r in avgs}
    if student.id not in scores:
        return None
    mine = scores[student.id]
    return {"rank": 1 + sum(1 for v in scores.values() if v > mine), "out_of": len(scores)}


def trend(student):
    """Average per term, oldest first, with improvement / decline / stable indicator."""
    rows = (Assessment.objects.filter(student=student).values("term_id", "term__name", "term__year__name",
                                                              "term__start_date")
            .annotate(avg=Avg(PCT)).order_by("term__start_date"))
    out, prev = [], None
    for r in rows:
        avg = round(float(r["avg"]), 2)
        direction = "stable" if prev is None or abs(avg - prev) < 2 else ("improved" if avg > prev else "declined")
        out.append({"term_id": r["term_id"], "label": f"{r['term__year__name']} {r['term__name']}", "average": avg,
                    "direction": direction, "change": None if prev is None else round(avg - prev, 2)})
        prev = avg
    return out
