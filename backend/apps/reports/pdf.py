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
from reportlab.platypus import HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from apps.academics.models import SchoolProfile, TeachingAssignment
from apps.attendance.models import AttendanceRecord
from apps.results.models import Assessment, ReportComment
from apps.results.services import _is_bot, _is_eot, _is_mid, term_summary


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


def build_report_card(student, term, is_mid_term=False):
    profile, summary = SchoolProfile.get(), term_summary(student, term)
    comment = ReportComment.objects.filter(student=student, term=term).first()

    class_name = student.stream.school_class.name if student.stream and student.stream.school_class else ""
    stream_name = student.stream.name if student.stream else ""
    is_a_level = bool(re.search(r"\b(?:s\.?[56]|senior\s*(?:5|6|five|six)|a[\s\-_]?level)\b", class_name, re.I))
    is_mt = bool(is_mid_term or getattr(term, "is_mid_term", False) or ("MID" in getattr(term, "name", "").upper()))
    # Mid-Term: pale yellow (#FFFACD)
    # End Of Term: vivid, bright neon green (or lime green) (#39FF14)
    # A-Level: vivid magenta/pink (#ff21da)
    if is_a_level:
        page_bg_color = colors.HexColor("#ff21da")
        border_color = colors.HexColor("#0070c0")
    else:
        page_bg_color = colors.HexColor("#FFFACD") if is_mt else colors.HexColor("#39FF14")
        border_color = colors.HexColor("#104a8e")

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
        leftMargin=11 * mm,
        rightMargin=11 * mm,
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
        fontSize=9,
        leading=11,
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
    logo_file_path = None
    if profile.logo:
        try:
            if hasattr(profile.logo, "path") and os.path.exists(profile.logo.path):
                logo_file_path = profile.logo.path
        except Exception:
            pass
    if not logo_file_path:
        kiyingi_logo_path = settings.MEDIA_ROOT / "school" / "kiyingi_logo.png"
        if os.path.exists(kiyingi_logo_path):
            logo_file_path = str(kiyingi_logo_path)

    logo_img = None
    if logo_file_path:
        try:
            logo_img = Image(str(logo_file_path), 25 * mm, 25 * mm)
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

    if not is_a_level:
        center_html = (
            f"<font size='10.5'><b>KIYINGI MEMORIAL SECONDARY SCHOOL</b></font><br/>"
            f"<font size='7.5'><b>3KM ALONG WABUSAANA-KYAMBOGO ROAD FROM KAKOOGE TOWNSHIP</b></font><br/>"
            f"<font size='7.5'><b>P.O.BOX KAMPALA UGANDA &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </b>"
            f"<font color='#0066cc'><u><b>TEL:0772511555/0701511555</b></u></font></font><br/>"
            f"<font size='8'><b>**Search for wisdom**</b></font><br/>"
            f"<font size='8.5'><b><u>END OF TERM {term.name.upper()} ASSESSMENT REPORT CARD {term.year.name}</u></b></font>"
        )
        center_p = Paragraph(center_html, school_sub_style)
        header_table = Table([[logo_img, center_p, photo_img]], colWidths=[26 * mm, 136 * mm, 26 * mm])
        header_table.setStyle(
            TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("ALIGN", (1, 0), (1, 0), "CENTER"),
                ("ALIGN", (2, 0), (2, 0), "CENTER"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
            ])
        )
        el.append(header_table)
        el.append(Spacer(1, 1.5 * mm))
    else:
        center_html = (
            f"<font size='10.5'><b>KIYINGI MEMORIAL SECONDARY SCHOOL</b></font><br/>"
            f"<font size='7.5'><b>3KM ALONG WABUSAANA-KYAMBOGO ROAD FROM KAKOOGE TOWNSHIP</b></font><br/>"
            f"<font size='7.5'><b>P.O.BOX KAMPALA UGANDA &nbsp;&nbsp;&nbsp;&nbsp; </b>"
            f"<font color='#0070c0'><u><b>TEL:0772511555/0701511555</b></u></font></font><br/>"
            f"<font size='8'><b>**Search for wisdom**</b></font>"
        )
        center_p = Paragraph(center_html, school_sub_style)
        header_table = Table([[logo_img, center_p]], colWidths=[26 * mm, 162 * mm])
        header_table.setStyle(
            TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("ALIGN", (1, 0), (1, 0), "CENTER"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
            ])
        )
        el.append(header_table)
        el.append(Spacer(1, 1 * mm))
        el.append(HRFlowable(width="100%", thickness=0.8, color=colors.black, spaceBefore=1, spaceAfter=2))

    # 2. Report Card Title (for A-Level only; for O-Level it is integrated in header)
    if is_a_level:
        term_title_str = "MID-TERM" if is_mt else f"END OF TERM {term.name.upper()}"
        title_text = f"<u>{term_title_str} A'LEVEL REPORT CARD {term.year.name}</u>"
        el.append(Paragraph(f"<b>{title_text}</b>", card_title_style))
        el.append(Spacer(1, 2 * mm))

    # 3. Student Bio / Particulars
    if is_a_level:
        info_data = [
            [Paragraph(f"<b>NAME:</b> &nbsp;{student.full_name.upper()}", cell_bold)],
            [Paragraph(f"<b>CLASS:</b> &nbsp;{class_name.upper()}", cell_bold)],
        ]
        info_table = Table(info_data, colWidths=[188 * mm])
    else:
        info_data = [
            [Paragraph(f"<b>NAME:</b> {student.full_name.upper()}", cell_bold)],
            [Paragraph(f"<b>CLASS:</b> {class_name.upper()}", cell_bold)],
        ]
        info_table = Table(info_data, colWidths=[188 * mm])

    info_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    el.append(info_table)
    el.append(Spacer(1, 1.5 * mm))

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
        # O-Level columns matching the reference format:
        # SUBJECT | 20% | C1 | AVG | IDENT | DESCRIPTOR | 80% | 100% | GRADE | REMARK | TEACHER'S INITIALS
        col_w = [
            44 * mm,
            12 * mm,
            11 * mm,
            12 * mm,
            11 * mm,
            26 * mm,
            12 * mm,
            14 * mm,
            13 * mm,
            19 * mm,
            14 * mm,
        ]
        headers = [
            Paragraph("<b>SUBJECT</b>", cell_bold),
            Paragraph("<b>20%</b>", cell_center_bold),
            Paragraph("<b>C1</b>", cell_center_bold),
            Paragraph("<b>AVG</b>", cell_center_bold),
            Paragraph("<b>IDENT</b>", cell_center_bold),
            Paragraph("<b>DESCRIPTOR</b>", cell_center_bold),
            Paragraph("<b>80%</b>", cell_center_bold),
            Paragraph("<b>100%</b>", cell_center_bold),
            Paragraph("<b>GRADE</b>", cell_center_bold),
            Paragraph("<b>REMARK</b>", cell_center_bold),
            Paragraph("<b>TEACHER'S<br/>INITIALS</b>", cell_center_bold),
        ]
        table_rows = [headers]

        total_marks = []
        ident_values = []

        for r in summary["subjects"]:
            sid = r["subject_id"]
            ass_items = by_subject_ass.get(sid, [])

            mid_ass = next((a for a in ass_items if _is_mid(a.exam_type)), None)
            bot_ass = next((a for a in ass_items if _is_bot(a.exam_type)), None)
            final_ass = next((a for a in ass_items if _is_eot(a.exam_type)), None)
            c1_ass = next((a for a in ass_items if getattr(a.exam_type, "code", "").upper() in ("C1", "COMPETENCY1", "COMPETENCY_1")), None)

            # 20% Column: Mid-Term marks out of 20 (BOT excluded; fallback if only legacy BOT exists)
            active_ca = mid_ass if mid_ass else (bot_ass if bot_ass else None)
            if active_ca:
                col_20_val = float(active_ca.score)
                col_20_str = f"{col_20_val:g}"
                c1_num = round((col_20_val / 20.0) * 3.0, 1)
            elif c1_ass:
                c1_num = round(float(c1_ass.score), 1)
                col_20_val = round((c1_num / 3.0) * 20.0, 1)
                col_20_str = f"{col_20_val:g}"
            elif r.get("mid_score") is not None:
                col_20_val = float(r["mid_score"])
                col_20_str = f"{col_20_val:g}"
                c1_num = round((col_20_val / 20.0) * 3.0, 1)
            else:
                col_20_val = None
                col_20_str = ""
                c1_num = None

            # AVG: Continuous assessment score (C1 from Mid-Term out of 20 scaled to 3.0)
            avg_num = c1_num

            # 80% Column: End of term examination (out of 80)
            if final_ass:
                col_80_val = float(final_ass.score)
                col_80_str = f"{col_80_val:g}"
            elif r.get("eot_score") is not None:
                col_80_val = float(r["eot_score"])
                col_80_str = f"{col_80_val:g}"
            else:
                col_80_val = None
                col_80_str = ""

            # 100% Final Results: Mid-Term (out of 20) + End of term (out of 80) = FINAL RESULTS out of 100
            # BOT is excluded from total
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
                ident = ""
                desc = ""

            grade, remark = _grade_and_remark(tot_num)
            initials = teacher_initials.get(sid, "")

            table_rows.append([
                Paragraph(r["subject"], cell_style),
                Paragraph(col_20_str, cell_center),
                Paragraph(f"{c1_num:g}" if c1_num is not None else "", cell_center),
                Paragraph(f"{avg_num:g}" if avg_num is not None else "", cell_center),
                Paragraph(str(ident), cell_center_bold),
                Paragraph(desc, cell_center),
                Paragraph(col_80_str, cell_center),
                Paragraph(tot_str, cell_center_bold),
                Paragraph(grade, cell_center_bold),
                Paragraph(remark, cell_center),
                Paragraph(initials, cell_center),
            ])

        # Overall / Total Average Row matching the reference image:
        # Col 1: AVERAGE, Col 4: overall average, other cells blank with grid borders
        overall_avg = round(sum(total_marks) / len(total_marks), 1) if total_marks else 0
        overall_grade, overall_remark = _grade_and_remark(overall_avg)

        # OVERALL IDENTIFIER = Sum of all subjects IDENT for a particular student.
        overall_ident = sum(ident_values) if ident_values else ""
        # OVERALL ACHIEVEMENT should not be computed, leave blank space
        overall_achieve = ""

        table_rows.append([
            Paragraph("<b>AVERAGE</b>", cell_bold),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph(f"<b>{overall_avg:g}</b>", cell_center_bold),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
        ])

        perf_table = Table(table_rows, colWidths=col_w, repeatRows=1)
        perf_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 1.5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1.5),
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
        sum_table = Table(summary_row, colWidths=[42 * mm, 21 * mm, 45 * mm, 26 * mm, 27 * mm, 27 * mm])
        sum_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ])
        )
        el.append(sum_table)
        el.append(Spacer(1, 2 * mm))

        # Grading Scales
        grade_scale_title = Paragraph("<b>GRADING SCALE</b>", card_title_style)
        el.append(grade_scale_title)
        el.append(Spacer(1, 1 * mm))

        scale1_data = [
            [
                Paragraph("80-100", cell_center),
                Paragraph("70-79", cell_center),
                Paragraph("60-69", cell_center),
                Paragraph("50-59", cell_center),
                Paragraph("0-49", cell_center),
            ],
            [
                Paragraph("<b>A</b>", cell_center_bold),
                Paragraph("<b>B</b>", cell_center_bold),
                Paragraph("<b>C</b>", cell_center_bold),
                Paragraph("<b>D</b>", cell_center_bold),
                Paragraph("<b>E</b>", cell_center_bold),
            ],
        ]
        scale1_table = Table(scale1_data, colWidths=[30 * mm, 30 * mm, 30 * mm, 30 * mm, 30 * mm], hAlign="CENTER")
        scale1_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
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
            [Paragraph("3", cell_center_bold), Paragraph("2.5 - 3.0", cell_center), Paragraph("OUTSTANDING", cell_center)],
            [Paragraph("2", cell_center_bold), Paragraph("1.5 - 2.4", cell_center), Paragraph("MODERATE", cell_center)],
            [Paragraph("1", cell_center_bold), Paragraph("1.0 - 1.4", cell_center), Paragraph("BASIC", cell_center)],
        ]
        scale2_table = Table(scale2_data, colWidths=[50 * mm, 69 * mm, 69 * mm])
        scale2_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ])
        )
        el.append(scale2_table)
        el.append(Spacer(1, 2 * mm))

        # Comments & Signatures matching the reference image layout
        head_cmnt = (comment.head_comment if comment else "") or ""
        cls_cmnt = (comment.teacher_comment if comment else "") or ""
        cmnt_style = ParagraphStyle("Cmnt", parent=st["Normal"], fontName="Helvetica", fontSize=7.5, leading=9.5)

        el.append(
            Paragraph(
                f"<b>HEAD TEACHER'S COMMENT:</b> {head_cmnt}"
                + (" ....................................................................................................................................... " if not head_cmnt else " ")
                + "<b>SIGN:</b> .....................................................",
                cmnt_style,
            )
        )
        el.append(Spacer(1, 2 * mm))
        el.append(
            Paragraph(
                f"<b>CLASS TEACHER'S COMMENT:</b> {cls_cmnt}"
                + (" ....................................................................................................................................... " if not cls_cmnt else " ")
                + "<b>SIGN:</b> .....................................................",
                cmnt_style,
            )
        )

    else:
        # A-Level Performance Table
        # Two-level header matching the reference image:
        # Row 0: SUBJECT (rowspan 2) | SCORES (colspan 3: PP1, PP2, PP3) | GRADE (rowspan 2) | COMMENT (rowspan 2) | INITIALS (rowspan 2)
        # Row 1:                      | PP1 | PP2 | PP3                  |                   |                     |
        col_w = [56 * mm, 16 * mm, 16 * mm, 16 * mm, 18 * mm, 44 * mm, 22 * mm]  # Total 188 mm
        header_r1 = [
            Paragraph("<b>SUBJECT</b>", cell_bold),
            Paragraph("<b>SCORES</b>", cell_center_bold),
            "",
            "",
            Paragraph("<b>GRADE</b>", cell_center_bold),
            Paragraph("<b>COMMENT</b>", cell_center_bold),
            Paragraph("<b>INITIALS</b>", cell_center_bold),
        ]
        header_r2 = [
            "",
            Paragraph("<b>PP1</b>", cell_center_bold),
            Paragraph("<b>PP2</b>", cell_center_bold),
            Paragraph("<b>PP3</b>", cell_center_bold),
            "",
            "",
            "",
        ]
        table_rows = [header_r1, header_r2]

        for r in summary["subjects"]:
            sid = r["subject_id"]
            ass_items = by_subject_ass.get(sid, [])

            p1 = next((a for a in ass_items if a.paper_number == 1), None)
            p2 = next((a for a in ass_items if a.paper_number == 2), None)
            p3 = next((a for a in ass_items if a.paper_number == 3), None)

            p1_str = f"{p1.score:g}" if p1 else ""
            p2_str = f"{p2.score:g}" if p2 else ""
            p3_str = f"{p3.score:g}" if p3 else ""

            # Check recorded paper marks
            rec_scores = [float(p.score) for p in (p1, p2, p3) if p is not None]
            if not rec_scores and r.get("papers"):
                rec_scores = [float(v) for v in r["papers"].values() if v is not None]

            # In A-level: (GRADE = PP1 + PP2 + PP3 / number of papers its marks recorded)
            # or total recorded / number of papers
            if rec_scores:
                avg_sc = round(sum(rec_scores) / len(rec_scores), 1)
            else:
                try:
                    avg_sc = float(r.get("total", 0) or 0)
                except (ValueError, TypeError):
                    avg_sc = 0.0

            # NOTE: Grading scale uses O level grading scale
            grd, comment_str = _grade_and_remark(avg_sc)
            initials = teacher_initials.get(sid, "")

            table_rows.append([
                Paragraph(r["subject"].upper(), cell_style),
                Paragraph(p1_str, cell_center),
                Paragraph(p2_str, cell_center),
                Paragraph(p3_str, cell_center),
                Paragraph(f"<b>{grd}</b>", cell_center_bold),
                Paragraph(comment_str, cell_center),
                Paragraph(initials, cell_center),
            ])

        perf_table = Table(table_rows, colWidths=col_w, repeatRows=2)
        perf_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("SPAN", (0, 0), (0, 1)),
                ("SPAN", (1, 0), (3, 0)),
                ("SPAN", (4, 0), (4, 1)),
                ("SPAN", (5, 0), (5, 1)),
                ("SPAN", (6, 0), (6, 1)),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ])
        )
        el.append(perf_table)
        el.append(Spacer(1, 2.5 * mm))

        # Subject Combination Box matching reference image
        comb_title = Paragraph("<b>SUBJECT COMBINATION</b>", card_title_style)
        el.append(comb_title)
        el.append(Spacer(1, 1.5 * mm))

        comb_subs = summary["subjects"][:5]
        comb_col_w = [43 * mm, 29 * mm, 29 * mm, 29 * mm, 29 * mm, 29 * mm]
        row1_cells = [Paragraph("", cell_center)]
        row2_cells = [Paragraph("<b>POINTS</b>", cell_bold)]

        for i in range(5):
            if i < len(comb_subs):
                sub = comb_subs[i]
                s_name = sub.get("code") or sub.get("subject", "")[:5].upper()
                row1_cells.append(Paragraph(f"<b>{s_name}</b>", cell_center_bold))

                rec = [float(v) for v in (sub.get("papers") or {}).values() if v is not None]
                if rec:
                    avg_s = round(sum(rec) / len(rec), 1)
                else:
                    try:
                        avg_s = float(sub.get("total", 0) or 0)
                    except (ValueError, TypeError):
                        avg_s = 0.0
                g, _ = _grade_and_remark(avg_s)
                pts_map = {"A": "6", "B": "5", "C": "4", "D": "3", "E": "2"}
                pts = pts_map.get(g, "")
                row2_cells.append(Paragraph(f"<b>{pts}</b>", cell_center_bold))
            else:
                row1_cells.append(Paragraph("", cell_center))
                row2_cells.append(Paragraph("", cell_center))

        comb_table = Table([row1_cells, row2_cells], colWidths=comb_col_w)
        comb_table.setStyle(
            TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ])
        )
        el.append(comb_table)
        el.append(Spacer(1, 3 * mm))

        # A-Level Remarks & Signatures matching reference image with dotted lines
        cls_rem = (comment.teacher_comment if comment else "") or ""
        head_rem = (comment.head_comment if comment else "") or ""
        rem_style = ParagraphStyle("ALRem", parent=st["Normal"], fontName="Helvetica", fontSize=8, leading=11)

        el.append(
            Paragraph(
                f"<b>CLASS TEACHER'S REMARKS:</b> &nbsp;{cls_rem}"
                + ("........................................................................................................................................................" if not cls_rem else ""),
                rem_style,
            )
        )
        el.append(Spacer(1, 3 * mm))
        el.append(
            Paragraph(
                "<b>SIGN:</b> .........................................................................................................................................................................",
                rem_style,
            )
        )
        el.append(Spacer(1, 3 * mm))
        el.append(
            Paragraph(
                f"<b>HEADTEACHER'S REMARKS:</b> &nbsp;{head_rem}"
                + ("........................................................................................................................................................" if not head_rem else ""),
                rem_style,
            )
        )
        el.append(Spacer(1, 3 * mm))
        el.append(
            Paragraph(
                "<b>SIGN:</b> .........................................................................................................................................................................",
                rem_style,
            )
        )

    def draw_page_decorations(canvas, _doc):
        canvas.saveState()
        # 1. Page background fill
        # Mid-Term: pale yellow (#FFFACD)
        # End Of Term: vivid, bright neon green (#39FF14)
        # A-Level: vivid magenta/pink (#ff21da)
        canvas.setFillColor(page_bg_color)
        canvas.rect(0, 0, 210 * mm, 297 * mm, fill=1, stroke=0)

        # 2. Outer double frame matching the reference design
        canvas.setStrokeColor(border_color)
        canvas.setLineWidth(2.2)
        canvas.rect(6 * mm, 6 * mm, 198 * mm, 285 * mm)
        canvas.setLineWidth(0.8)
        canvas.rect(7.8 * mm, 7.8 * mm, 194.4 * mm, 281.4 * mm)
        canvas.restoreState()

    doc.build(el, onFirstPage=draw_page_decorations, onLaterPages=draw_page_decorations)
    buf.seek(0)
    return buf
