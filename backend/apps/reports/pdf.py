import io
import os
import re
from decimal import Decimal

from django.conf import settings
from django.db.models import Count
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.academics.models import SchoolProfile, TeachingAssignment
from apps.attendance.models import AttendanceRecord
from apps.results.models import Assessment, ReportComment
from apps.results.services import term_summary


def _grade_and_remark(score):
    try:
        val = float(score)
    except (ValueError, TypeError):
        return "-", ""
    if val >= 80:
        return "A", "EXCELLENT"
    if val >= 70:
        return "B", "VERY GOOD"
    if val >= 60:
        return "C", "GOOD"
    if val >= 50:
        return "D", "FAIR"
    return "E", "POOR"


def _a_level_points(grade):
    pts = {"A": 6, "B": 5, "C": 4, "D": 3, "E": 2, "O": 1, "1": 1, "F": 0}
    return pts.get(str(grade).strip().upper(), 0)


def build_report_card(student, term):
    profile, summary = SchoolProfile.get(), term_summary(student, term)
    comment = ReportComment.objects.filter(student=student, term=term).first()

    class_name = student.stream.school_class.name if student.stream and student.stream.school_class else ""
    stream_name = student.stream.name if student.stream else ""
    is_a_level = bool(re.search(r"\b(?:s\.?[56]|senior\s*(?:5|6|five|six)|a[\s\-_]?level)\b", class_name, re.I))

    # Look up teacher initials per subject
    teacher_initials = {}
    if student.stream_id:
        for a in TeachingAssignment.objects.filter(stream_id=student.stream_id).select_related("teacher"):
            if a.teacher:
                fn = a.teacher.first_name.strip()
                ln = a.teacher.last_name.strip()
                if fn and ln:
                    initials = f"{fn[0]} {ln[0]}".upper()
                elif fn or ln:
                    initials = (fn or ln)[:2].upper()
                else:
                    initials = a.teacher.username[:3].upper()
                teacher_initials[(a.subject_id, a.paper_number)] = initials
                teacher_initials[a.subject_id] = initials

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"Report Card - {student.index_no}",
    )
    st = getSampleStyleSheet()

    school_title_style = ParagraphStyle(
        "SchoolTitle",
        parent=st["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=13,
        alignment=1,  # Center
    )
    school_sub_style = ParagraphStyle(
        "SchoolSub",
        parent=st["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        alignment=1,
    )
    motto_style = ParagraphStyle(
        "SchoolMotto",
        parent=st["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=8,
        leading=10,
        alignment=1,
    )
    card_title_style = ParagraphStyle(
        "CardTitle",
        parent=st["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=12,
        alignment=1,
    )
    cell_style = ParagraphStyle("Cell", parent=st["Normal"], fontName="Helvetica", fontSize=7, leading=8.5)
    cell_bold = ParagraphStyle("CellBold", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=7, leading=8.5)
    cell_center = ParagraphStyle(
        "CellCenter", parent=st["Normal"], fontName="Helvetica", fontSize=7, leading=8.5, alignment=1
    )
    cell_center_bold = ParagraphStyle(
        "CellCenterBold", parent=st["Normal"], fontName="Helvetica-Bold", fontSize=7, leading=8.5, alignment=1
    )

    el = []

    # 1. School Header: Logo (Left), School Details (Center), Student Photo (Right)
    logo_img = None
    if profile.logo:
        try:
            if hasattr(profile.logo, "path") and os.path.exists(profile.logo.path):
                logo_img = Image(profile.logo.path, 25 * mm, 25 * mm)
        except Exception:
            pass
    if not logo_img:
        kiyingi_logo_path = settings.MEDIA_ROOT / "school" / "kiyingi_logo.png"
        if os.path.exists(kiyingi_logo_path):
            try:
                logo_img = Image(str(kiyingi_logo_path), 25 * mm, 25 * mm)
            except Exception:
                pass
    if not logo_img:
        logo_img = Paragraph("", cell_style)

    # Student Photo
    photo_img = None
    if student.photo:
        try:
            if hasattr(student.photo, "path") and os.path.exists(student.photo.path):
                photo_img = Image(student.photo.path, 24 * mm, 28 * mm)
        except Exception:
            pass
    if not photo_img:
        photo_box = [["PHOTO"]]
        photo_table = Table(photo_box, colWidths=[24 * mm], rowHeights=[28 * mm])
        photo_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#999999")),
            ])
        )
        photo_img = photo_table

    center_html = (
        f"<b>KIYINGI MEMORIAL SECONDARY SCHOOL</b><br/>"
        f"3KM ALONG WABUSAANA-KYAMBOGO ROAD FROM KAKOOGE TOWNSHIP<br/>"
        f"P.O.BOX KAMPALA UGANDA &nbsp;&nbsp;&nbsp;&nbsp; TEL: 0772511555 / 0701511555<br/>"
        f"<i>''Search for wisdom''</i>"
    )
    center_p = Paragraph(center_html, school_sub_style)

    header_table = Table([[logo_img, center_p, photo_img]], colWidths=[28 * mm, 130 * mm, 28 * mm])
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (0, 0), "CENTER"),
            ("ALIGN", (1, 0), (1, 0), "CENTER"),
            ("ALIGN", (2, 0), (2, 0), "CENTER"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
        ])
    )
    el.append(header_table)
    el.append(Spacer(1, 2 * mm))

    # 2. Report Card Title
    if is_a_level:
        title_text = f"<u>END OF TERM {term.name.upper()} A'LEVEL REPORT CARD {term.year.name}</u>"
    else:
        title_text = f"<u>END OF TERM ASSESSMENT REPORT CARD {term.year.name}</u>"
    el.append(Paragraph(f"<b>{title_text}</b>", card_title_style))
    el.append(Spacer(1, 2.5 * mm))

    # 3. Student Bio / Particulars
    if is_a_level:
        info_data = [
            [
                Paragraph(f"<b>NAME:</b> {student.full_name.upper()}", cell_style),
                Paragraph(f"<b>COMBINATION:</b> {getattr(student, 'combination', '') or '—'}", cell_style),
            ],
            [
                Paragraph(f"<b>CLASS:</b> {class_name.upper()}", cell_style),
                Paragraph(f"<b>POINTS:</b> {summary.get('points', '—')}", cell_style),
            ],
        ]
        info_table = Table(info_data, colWidths=[105 * mm, 81 * mm])
    else:
        info_data = [
            [
                Paragraph(f"<b>NAME:</b> {student.full_name.upper()}", cell_style),
                Paragraph(f"<b>CLASS:</b> {class_name.upper()}", cell_style),
                Paragraph(f"<b>STREAM:</b> {stream_name.upper() or '—'}", cell_style),
                Paragraph(f"<b>ID:</b> {student.index_no}", cell_style),
            ]
        ]
        info_table = Table(info_data, colWidths=[70 * mm, 40 * mm, 38 * mm, 38 * mm])

    info_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LEFTPADDING", (0, 0), (-1, -1), 1),
            ("RIGHTPADDING", (0, 0), (-1, -1), 1),
        ])
    )
    el.append(info_table)
    el.append(Spacer(1, 2 * mm))

    # 4. Performance Records Title
    records_heading = Paragraph("<b>PERFORMANCE RECORDS</b>", card_title_style)
    el.append(records_heading)
    el.append(Spacer(1, 1.5 * mm))

    # 5. Performance Table
    all_assessments = list(
        Assessment.objects.filter(student=student, term=term).select_related("exam_type", "subject")
    )
    by_subject_ass = {}
    for a in all_assessments:
        by_subject_ass.setdefault(a.subject_id, []).append(a)

    if not is_a_level:
        # O-Level columns: SUBJECT | 20% | C2 | AVG | IDENT | DESCRIPTOR | C1 | 80% | 100% | GRADE | REMARK | TEACHERS INITIALS
        # Col widths totaling 186mm
        col_w = [
            42 * mm,
            11 * mm,
            11 * mm,
            12 * mm,
            11 * mm,
            24 * mm,
            11 * mm,
            11 * mm,
            12 * mm,
            12 * mm,
            18 * mm,
            11 * mm,
        ]
        headers = [
            Paragraph("<b>SUBJECT</b>", cell_bold),
            Paragraph("<b>20%</b>", cell_center_bold),
            Paragraph("<b>C2</b>", cell_center_bold),
            Paragraph("<b>AVG</b>", cell_center_bold),
            Paragraph("<b>IDENT</b>", cell_center_bold),
            Paragraph("<b>DESCRIPTOR</b>", cell_center_bold),
            Paragraph("<b>C1</b>", cell_center_bold),
            Paragraph("<b>80%</b>", cell_center_bold),
            Paragraph("<b>100%</b>", cell_center_bold),
            Paragraph("<b>GRADE</b>", cell_center_bold),
            Paragraph("<b>REMARK</b>", cell_center_bold),
            Paragraph("<b>TR INIT</b>", cell_center_bold),
        ]
        table_rows = [headers]

        total_marks = []
        ident_values = []

        for r in summary["subjects"]:
            sid = r["subject_id"]
            ass_items = by_subject_ass.get(sid, [])

            bot_ass = next((a for a in ass_items if a.exam_type.code.upper() in ("BOT", "BEGINNING_OF_TERM", "B_O_T")), None)
            mid_ass = next((a for a in ass_items if a.exam_type.code.upper() in ("MID", "MIDTERM", "MID_TERM", "M_T")), None)
            final_ass = next((a for a in ass_items if a.exam_type.code.upper() in ("FINAL", "EOT", "END", "END_OF_TERM", "E_O_T")), None)
            c1_ass = next((a for a in ass_items if a.exam_type.code.upper() in ("C1", "COMPETENCY1", "COMPETENCY_1")), None)

            # 20% Column: BOT marks out of 20
            if bot_ass:
                col_20_val = float(bot_ass.score)
                col_20_str = f"{col_20_val:g}"
                c1_num = round((col_20_val / 20.0) * 3.0, 1)
            elif c1_ass:
                c1_num = round(float(c1_ass.score), 1)
                col_20_val = round((c1_num / 3.0) * 20.0, 1)
                col_20_str = f"{col_20_val:g}"
            else:
                col_20_val = None
                col_20_str = "-"
                c1_num = None

            # Mid-Term marks out of 20 converted to C2: ((mid_ass.score / 20) * 3)
            # Printed in report card but NOT calculated in the final term results
            if mid_ass:
                c2_num = round((float(mid_ass.score) / 20.0) * 3.0, 1)
            else:
                c2_num = c1_num

            # AVG: Continuous assessment average between C1 and C2
            if c1_num is not None and c2_num is not None:
                avg_num = round((c1_num + c2_num) / 2.0, 1)
            elif c1_num is not None:
                avg_num = c1_num
            elif c2_num is not None:
                avg_num = c2_num
            else:
                avg_num = None

            # 80% Column: End of term examination (out of 80)
            if final_ass:
                col_80_val = float(final_ass.score)
                col_80_str = f"{col_80_val:g}"
            else:
                col_80_val = None
                col_80_str = "-"

            # 100% Final Results: BOT (out of 20) + End of term (out of 80) = FINAL RESULTS out of 100
            # Mid-Term is NOT included in this total
            if col_20_val is not None and col_80_val is not None:
                tot_num = round(col_20_val + col_80_val, 1)
            elif col_80_val is not None:
                tot_num = round(col_80_val, 1)
            elif col_20_val is not None:
                tot_num = round(col_20_val, 1)
            else:
                tot_num = float(r["total"])
            total_marks.append(tot_num)
            tot_str = f"{tot_num:.1f}" if tot_num % 1 != 0 else f"{int(tot_num)}"

            # Identifier (IDENT) & Descriptor Rule:
            # IDENT is the value of AVG (or C1) rounded to nearest Integer... written as 1, 2 or 3 as calculated.
            # If IDENT is 0-1, DESCRIPTOR = BASIC; IDENT is 2, DESCRIPTOR = MODERATE; IDENT is 3, DESCRIPTOR = OUTSTANDING.
            active_ident_val = avg_num if avg_num is not None else c1_num
            if active_ident_val is not None:
                ident_int = int(round(active_ident_val))
                if ident_int <= 1:
                    ident = 1
                    desc = "BASIC"
                elif ident_int == 2:
                    ident = 2
                    desc = "MODERATE"
                else:
                    ident = 3
                    desc = "OUTSTANDING"
                ident_values.append(ident)
            else:
                ident = "-"
                desc = "-"

            grade, remark = _grade_and_remark(tot_num)
            initials = teacher_initials.get(sid, "")

            table_rows.append([
                Paragraph(r["subject"], cell_style),
                Paragraph(col_20_str, cell_center),
                Paragraph(f"{c2_num:g}" if c2_num is not None else "-", cell_center),
                Paragraph(f"{avg_num:g}" if avg_num is not None else "-", cell_center),
                Paragraph(str(ident), cell_center_bold),
                Paragraph(desc, cell_center),
                Paragraph(f"{c1_num:g}" if c1_num is not None else "-", cell_center),
                Paragraph(col_80_str, cell_center),
                Paragraph(tot_str, cell_center_bold),
                Paragraph(grade, cell_center_bold),
                Paragraph(remark, cell_center),
                Paragraph(initials, cell_center),
            ])

        # Overall / Total Average Row
        overall_avg = round(sum(total_marks) / len(total_marks), 1) if total_marks else 0
        overall_grade, overall_remark = _grade_and_remark(overall_avg)

        # OVERALL IDENTIFIER = Sum of all subjects IDENT for a particular student.
        overall_ident = sum(ident_values) if ident_values else "-"
        # OVERALL ACHIEVEMENT should not be computed, leave blank space
        overall_achieve = ""

        # Total Average row spans columns
        table_rows.append([
            Paragraph("<b>TOTAL AVERAGE</b>", cell_bold),
            Paragraph(f"<b>{overall_avg:g}</b>", cell_center_bold),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph(f"<b>{overall_avg:g}</b>", cell_center_bold),
            Paragraph(f"<b>{overall_grade}</b>", cell_center_bold),
            Paragraph(f"<b>{overall_remark}</b>", cell_center_bold),
            Paragraph("", cell_style),
        ])

        perf_table = Table(table_rows, colWidths=col_w, repeatRows=1)
        perf_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f4f8")),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ])
        )
        el.append(perf_table)
        el.append(Spacer(1, 1.5 * mm))

        # Overall summary row: OVERALL ACHIEVEMENT is left as blank space
        summary_row = [
            [
                Paragraph("<b>OVERALL IDENTIFIER</b>", cell_bold),
                Paragraph(str(overall_ident), cell_center_bold),
                Paragraph("<b>OVERALL ACHIEVEMENT</b>", cell_bold),
                Paragraph(overall_achieve, cell_center_bold),
                Paragraph("<b>GRADE</b>", cell_bold),
                Paragraph(overall_grade, cell_center_bold),
            ]
        ]
        sum_table = Table(summary_row, colWidths=[40 * mm, 20 * mm, 45 * mm, 35 * mm, 22 * mm, 24 * mm])
        sum_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0f4f8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ])
        )
        el.append(sum_table)
        el.append(Spacer(1, 2.5 * mm))

        # Grading Scales (Side by Side or Stacked)
        grade_scale_title = Paragraph("<b>GRADING SCALE</b>", card_title_style)
        el.append(grade_scale_title)
        el.append(Spacer(1, 1 * mm))

        # Table 1: Grade Scale
        # 80-100 | 70-79 | 60-69 | 50-59 | 0-49
        # A      | B     | C     | D     | E
        # Table 2: Identifier Scale
        # IDENTIFIER | SCORE RANGE | DESCRIPTION
        scale1_data = [
            [
                Paragraph("<b>80-100</b>", cell_center),
                Paragraph("<b>70-79</b>", cell_center),
                Paragraph("<b>60-69</b>", cell_center),
                Paragraph("<b>50-59</b>", cell_center),
                Paragraph("<b>0-49</b>", cell_center),
            ],
            [
                Paragraph("<b>A</b>", cell_center_bold),
                Paragraph("<b>B</b>", cell_center_bold),
                Paragraph("<b>C</b>", cell_center_bold),
                Paragraph("<b>D</b>", cell_center_bold),
                Paragraph("<b>E</b>", cell_center_bold),
            ],
        ]
        scale1_table = Table(scale1_data, colWidths=[37 * mm, 37 * mm, 37 * mm, 37 * mm, 38 * mm])
        scale1_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f4f8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ])
        )
        el.append(scale1_table)
        el.append(Spacer(1, 1.5 * mm))

        scale2_data = [
            [
                Paragraph("<b>IDENTIFIER</b>", cell_center_bold),
                Paragraph("<b>SCORE RANGE</b>", cell_center_bold),
                Paragraph("<b>DESCRIPTION</b>", cell_center_bold),
            ],
            [Paragraph("3", cell_center), Paragraph("2.5 - 3.0", cell_center), Paragraph("OUTSTANDING", cell_center)],
            [Paragraph("2", cell_center), Paragraph("1.5 - 2.4", cell_center), Paragraph("MODERATE", cell_center)],
            [Paragraph("1", cell_center), Paragraph("1.0 - 1.4", cell_center), Paragraph("BASIC", cell_center)],
        ]
        scale2_table = Table(scale2_data, colWidths=[50 * mm, 68 * mm, 68 * mm])
        scale2_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f4f8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ])
        )
        el.append(scale2_table)
        el.append(Spacer(1, 2.5 * mm))

        # Comments
        head_cmnt = (comment.head_comment if comment else "") or ""
        cls_cmnt = (comment.teacher_comment if comment else "") or ""

        el.append(
            Paragraph(
                f"<b>HEAD TEACHER'S COMMENT:</b> {head_cmnt}"
                + (
                    "<br/>.........................................................................................................................................................................................."
                    if not head_cmnt
                    else ""
                ),
                cell_style,
            )
        )
        el.append(Spacer(1, 2 * mm))
        el.append(
            Paragraph(
                f"<b>CLASS TEACHER'S COMMENT:</b> {cls_cmnt}"
                + (
                    "<br/>.........................................................................................................................................................................................."
                    if not cls_cmnt
                    else ""
                ),
                cell_style,
            )
        )

    else:
        # A-Level Performance Table
        # Columns: SUBJECT | PP1 | PP2 | PP3 | GRADE | COMMENT | INITIALS
        col_w = [56 * mm, 18 * mm, 18 * mm, 18 * mm, 18 * mm, 38 * mm, 20 * mm]
        headers = [
            Paragraph("<b>SUBJECT</b>", cell_bold),
            Paragraph("<b>PP1</b>", cell_center_bold),
            Paragraph("<b>PP2</b>", cell_center_bold),
            Paragraph("<b>PP3</b>", cell_center_bold),
            Paragraph("<b>GRADE</b>", cell_center_bold),
            Paragraph("<b>COMMENT</b>", cell_center_bold),
            Paragraph("<b>INITIALS</b>", cell_center_bold),
        ]
        table_rows = [headers]
        total_pts = 0

        for r in summary["subjects"]:
            sid = r["subject_id"]
            ass_items = by_subject_ass.get(sid, [])

            p1 = next((a for a in ass_items if a.paper_number == 1), None)
            p2 = next((a for a in ass_items if a.paper_number == 2), None)
            p3 = next((a for a in ass_items if a.paper_number == 3), None)

            p1_str = f"{p1.score:g}" if p1 else ""
            p2_str = f"{p2.score:g}" if p2 else ""
            p3_str = f"{p3.score:g}" if p3 else ""

            # If subsidiary (e.g. GP, Sub-Maths, ICT)
            s_name_upper = r["subject"].upper()
            is_sub = any(k in s_name_upper for k in ("G.P", "GENERAL PAPER", "SUBSIDIARY", "SUB MATH", "I.C.T", "ICT"))

            tot_num = float(r["total"])
            if is_sub:
                grd = "1" if tot_num >= 50 else ("Pass" if tot_num >= 40 else "F")
            else:
                grd, _ = _grade_and_remark(tot_num)

            _, comment_str = _grade_and_remark(tot_num)
            initials = teacher_initials.get(sid, "")
            total_pts += _a_level_points(grd)

            table_rows.append([
                Paragraph(r["subject"], cell_style),
                Paragraph(p1_str, cell_center),
                Paragraph(p2_str, cell_center),
                Paragraph(p3_str, cell_center),
                Paragraph(grd, cell_center_bold),
                Paragraph(comment_str, cell_center),
                Paragraph(initials, cell_center),
            ])

        perf_table = Table(table_rows, colWidths=col_w, repeatRows=1)
        perf_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f4f8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ])
        )
        el.append(perf_table)
        el.append(Spacer(1, 3 * mm))

        # A-Level Grading Scale & Points
        grade_scale_title = Paragraph("<b>GRADING SCALE & POINTS</b>", card_title_style)
        el.append(grade_scale_title)
        el.append(Spacer(1, 1 * mm))

        scale_a_data = [
            [
                Paragraph("<b>80-100</b>", cell_center),
                Paragraph("<b>70-79</b>", cell_center),
                Paragraph("<b>60-69</b>", cell_center),
                Paragraph("<b>50-59</b>", cell_center),
                Paragraph("<b>40-49</b>", cell_center),
                Paragraph("<b>35-39</b>", cell_center),
                Paragraph("<b>0-34</b>", cell_center),
            ],
            [
                Paragraph("<b>A</b>", cell_center_bold),
                Paragraph("<b>B</b>", cell_center_bold),
                Paragraph("<b>C</b>", cell_center_bold),
                Paragraph("<b>D</b>", cell_center_bold),
                Paragraph("<b>E</b>", cell_center_bold),
                Paragraph("<b>O</b>", cell_center_bold),
                Paragraph("<b>F</b>", cell_center_bold),
            ],
            [
                Paragraph("6 Pts", cell_center),
                Paragraph("5 Pts", cell_center),
                Paragraph("4 Pts", cell_center),
                Paragraph("3 Pts", cell_center),
                Paragraph("2 Pts", cell_center),
                Paragraph("1 Pt", cell_center),
                Paragraph("0 Pts", cell_center),
            ],
            [
                Paragraph("EXCELLENT", cell_center),
                Paragraph("VERY GOOD", cell_center),
                Paragraph("GOOD", cell_center),
                Paragraph("FAIR", cell_center),
                Paragraph("PASS", cell_center),
                Paragraph("SUB PASS", cell_center),
                Paragraph("FAIL", cell_center),
            ],
        ]
        scale_a_table = Table(scale_a_data, colWidths=[27 * mm, 27 * mm, 27 * mm, 27 * mm, 27 * mm, 27 * mm, 26 * mm])
        scale_a_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f4f8")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ])
        )
        el.append(scale_a_table)
        el.append(Spacer(1, 1 * mm))
        sub_note = Paragraph(
            "<font size='7.5'><i>Subsidiary Subjects (General Paper / Sub-Maths / ICT): Score &ge; 50 = Credit (1 Pt) | 40 - 49 = Pass | 0 - 39 = F (Fail)</i></font>",
            cell_style,
        )
        el.append(sub_note)
        el.append(Spacer(1, 2.5 * mm))

        # A-Level Signatures & Remarks
        cls_rem = (comment.teacher_comment if comment else "") or ""
        head_rem = (comment.head_comment if comment else "") or ""

        el.append(
            Paragraph(
                f"<b>CLASS TEACHER'S REMARKS:</b> {cls_rem}"
                + (
                    "<br/>.........................................................................................................................................................................................."
                    if not cls_rem
                    else ""
                ),
                cell_style,
            )
        )
        el.append(
            Paragraph(
                "<b>SIGN:</b> .....................................................................................................................................................................................................",
                cell_style,
            )
        )
        el.append(Spacer(1, 2.5 * mm))
        el.append(
            Paragraph(
                f"<b>HEADTEACHER'S REMARKS:</b> {head_rem}"
                + (
                    "<br/>.........................................................................................................................................................................................."
                    if not head_rem
                    else ""
                ),
                cell_style,
            )
        )
        el.append(
            Paragraph(
                "<b>SIGN:</b> .....................................................................................................................................................................................................",
                cell_style,
            )
        )

    doc.build(el)
    buf.seek(0)
    return buf
