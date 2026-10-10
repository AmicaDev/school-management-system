import io

from django.db.models import Count
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.academics.models import GradeBand, SchoolProfile
from apps.attendance.models import AttendanceRecord
from apps.results.models import ReportComment
from apps.results.services import term_summary


def build_report_card(student, term):
    profile, summary = SchoolProfile.get(), term_summary(student, term)
    comment = ReportComment.objects.filter(student=student, term=term).first()
    att = dict(AttendanceRecord.objects.filter(student=student, term=term).values_list("status")
               .annotate(n=Count("id")))
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
                            title=f"Report card {student.index_no}")
    st = getSampleStyleSheet()
    el = []
    head = [Paragraph(f"<b>{profile.name}</b><br/>{profile.address}<br/>{profile.phone} {profile.email}", st["Normal"])]
    if profile.logo:
        try:
            head.insert(0, Image(profile.logo.path, 22 * mm, 22 * mm))
        except Exception:
            pass
    ht = Table([head], colWidths=[26 * mm, 150 * mm] if len(head) == 2 else [176 * mm])
    el += [ht, Spacer(1, 4 * mm), Paragraph(f"<b>REPORT CARD - {term}</b>", st["Title"])]
    info = [["Student", student.full_name, "Student ID", student.index_no],
            ["Class", student.stream.school_class.name if student.stream else "-", "Stream", student.stream.name if student.stream else "-"],
            ["Academic year", term.year.name, "Term", term.name]]
    t = Table(info, colWidths=[30 * mm, 58 * mm, 30 * mm, 58 * mm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    el += [t, Spacer(1, 4 * mm)]
    codes = [e["code"] for e in summary["exam_types"]]
    rows = [["Subject"] + [e["name"] for e in summary["exam_types"]] + ["Total", "Grade", "Remark"]]
    for r in summary["subjects"]:
        rows.append([r["subject"]] + [str(r["components"].get(c, "-")) for c in codes] + [str(r["total"]), r["grade"], r["remark"]])
    sub = Table(rows, repeatRows=1)
    sub.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f4e8c")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                             ("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
    pos = summary["position"]
    el += [sub, Spacer(1, 3 * mm),
           Paragraph(f"<b>Average:</b> {summary['average']} &nbsp; <b>Grade:</b> {summary['grade']} &nbsp; "
                     f"<b>Position:</b> {pos['rank']} of {pos['out_of']}" if pos else
                     f"<b>Average:</b> {summary['average']} &nbsp; <b>Grade:</b> {summary['grade']}", st["Normal"]),
           Paragraph("<b>Attendance:</b> " + ", ".join(f"{k.title()} {v}" for k, v in att.items()) if att else "<b>Attendance:</b> no records", st["Normal"]),
           Spacer(1, 3 * mm),
           Paragraph(f"<b>Class teacher's comment:</b> {(comment.teacher_comment if comment else '') or '-'}", st["Normal"]),
           Paragraph(f"<b>Head teacher's comment{' (' + profile.head_teacher + ')' if profile.head_teacher else ''}:</b> "
                     f"{(comment.head_comment if comment else '') or '-'}", st["Normal"]), Spacer(1, 5 * mm),
           Paragraph("<b>GRADING TABLE</b>", st["Normal"])]
    bands = list(GradeBand.objects.order_by("-minimum"))
    if bands:
        g = Table([[f"{b.grade}" for b in bands], [f"{b.minimum:g}-{b.maximum:g}" for b in bands]])  # horizontal layout
        g.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef7")), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
        el.append(g)
    doc.build(el)
    buf.seek(0)
    return buf
