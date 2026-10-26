"""Financial ledger calculations, receipt generation, and number-to-words helpers."""
import secrets
from decimal import Decimal
from django.db import transaction
from django.utils import timezone

from apps.academics.models import Term
from apps.audit.services import audit
from apps.comms.services import notify
from apps.people.models import Student

from .models import FeeCategory, FeePayment, FeeStructure, PaymentAllocation, StudentFeeAdjustment


ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
        "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"]
TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"]


def _num_words_below_1000(n):
    words = []
    if n >= 100:
        words.append(ONES[n // 100] + " HUNDRED")
        n %= 100
        if n > 0:
            words.append("AND")
    if n >= 20:
        words.append(TENS[n // 10])
        n %= 10
    if n > 0:
        words.append(ONES[n])
    return " ".join(words)


def amount_to_words(amount):
    """Converts a numeric amount into words (e.g. 150000 -> ONE HUNDRED FIFTY THOUSAND SHILLINGS ONLY)."""
    try:
        amt = int(Decimal(str(amount)))
    except Exception:
        return ""
    if amt == 0:
        return "ZERO SHILLINGS ONLY"
    if amt < 0:
        return "NEGATIVE " + amount_to_words(abs(amt))

    scales = [(1000000000, "BILLION"), (1000000, "MILLION"), (1000, "THOUSAND")]
    parts = []

    for scale, name in scales:
        if amt >= scale:
            chunk = amt // scale
            parts.append(_num_words_below_1000(chunk) + " " + name)
            amt %= scale

    if amt > 0:
        parts.append(_num_words_below_1000(amt))

    return " ".join(parts).strip() + " SHILLINGS ONLY"


def generate_receipt_number():
    year_str = timezone.now().strftime("%Y")
    prefix = f"RCP-{year_str}-"
    last = FeePayment.objects.filter(receipt_no__startswith=prefix).order_by("-receipt_no").first()
    if last:
        try:
            seq = int(last.receipt_no.split("-")[-1]) + 1
        except Exception:
            seq = FeePayment.objects.filter(receipt_no__startswith=prefix).count() + 1
    else:
        seq = 1
    return f"{prefix}{seq:05d}"


def calculate_student_fee_balance(student, term=None):
    """
    Computes a student's financial summary:
      - expected_fees
      - adjustments (waivers, scholarships, surcharges)
      - total_paid
      - balance
      - breakdown per category
    """
    if not term:
        term = Term.objects.filter(is_active=True).first()
    if not term:
        return {
            "student_id": student.id,
            "student_name": student.full_name,
            "index_no": student.index_no,
            "class_name": student.stream.school_class.name if student.stream and student.stream.school_class else "",
            "expected_fees": Decimal("0.00"),
            "adjustments": Decimal("0.00"),
            "total_paid": Decimal("0.00"),
            "outstanding_balance": Decimal("0.00"),
            "status": "CLEAR",
            "categories": [],
            "payments": []
        }

    school_class = student.stream.school_class if student.stream else None
    structures_qs = FeeStructure.objects.filter(academic_year=term.year, term=term)
    if school_class:
        structures_qs = structures_qs.filter(school_class=school_class)
    else:
        structures_qs = structures_qs.none()

    category_expected = {}
    for st in structures_qs:
        category_expected[st.category_id] = {
            "category_id": st.category.id,
            "category_name": st.category.name,
            "code": st.category.code,
            "expected": st.amount,
            "paid": Decimal("0.00"),
        }

    # Adjustments
    adjustments_qs = StudentFeeAdjustment.objects.filter(student=student, academic_year=term.year, term=term)
    total_waivers = Decimal("0.00")
    total_surcharges = Decimal("0.00")

    for adj in adjustments_qs:
        if adj.kind in ("WAIVER", "SCHOLARSHIP", "DISCOUNT"):
            total_waivers += adj.amount
            if adj.category_id and adj.category_id in category_expected:
                category_expected[adj.category_id]["expected"] = max(Decimal("0.00"), category_expected[adj.category_id]["expected"] - adj.amount)
        elif adj.kind == "SURCHARGE":
            total_surcharges += adj.amount
            if adj.category_id and adj.category_id in category_expected:
                category_expected[adj.category_id]["expected"] += adj.amount

    # Payments & Allocations
    payments_qs = FeePayment.objects.filter(
        student=student, academic_year=term.year, term=term, is_reversed=False
    ).prefetch_related("allocations__category").order_by("created_at")

    total_paid = Decimal("0.00")
    payment_records = []
    for p in payments_qs:
        total_paid += p.amount
        payment_records.append({
            "id": p.id,
            "receipt_no": p.receipt_no,
            "date": p.created_at,
            "amount": p.amount,
            "payment_method": p.payment_method,
            "payer_name": p.payer_name,
            "payer_phone": p.payer_phone,
            "received_by_name": p.received_by.full_name if p.received_by else "",
            "balance_after": p.balance_after,
        })
        for alloc in p.allocations.all():
            if alloc.category_id in category_expected:
                category_expected[alloc.category_id]["paid"] += alloc.amount

    raw_expected = sum((c["expected"] for c in category_expected.values()), Decimal("0.00"))
    net_expected = raw_expected + total_surcharges - total_waivers
    if net_expected < Decimal("0.00"):
        net_expected = Decimal("0.00")

    balance = net_expected - total_paid

    status = "CLEAR"
    if balance > Decimal("0.00"):
        status = "PARTIAL" if total_paid > Decimal("0.00") else "UNPAID"
    elif balance < Decimal("0.00"):
        status = "OVERPAID"

    return {
        "student_id": student.id,
        "student_name": student.full_name,
        "index_no": student.index_no,
        "class_name": school_class.name if school_class else "",
        "stream_name": student.stream.name if student.stream else "",
        "term_id": term.id,
        "term_name": term.name,
        "year_name": term.year.name,
        "expected_fees": net_expected,
        "adjustments": total_surcharges - total_waivers,
        "total_paid": total_paid,
        "outstanding_balance": balance,
        "status": status,
        "categories": list(category_expected.values()),
        "payments": payment_records,
    }


def record_payment_transaction(user, student_id, term_id, amount, payment_method, payer_name,
                               payer_type="PARENT", payer_phone="", reference="", notes="", allocations=None):
    """
    Atomic creation of FeePayment, balance calculation before/after,
    allocations, audit logging, and parent notification.
    """
    student = Student.objects.select_related("stream__school_class").get(pk=student_id)
    term = Term.objects.select_related("year").get(pk=term_id)
    amount_dec = Decimal(str(amount))

    with transaction.atomic():
        # Current balance before payment
        current = calculate_student_fee_balance(student, term)
        bal_before = current["outstanding_balance"]
        bal_after = bal_before - amount_dec

        receipt_no = generate_receipt_number()
        verif_code = secrets.token_hex(16)

        payment = FeePayment.objects.create(
            receipt_no=receipt_no,
            student=student,
            academic_year=term.year,
            term=term,
            amount=amount_dec,
            payment_method=payment_method,
            transaction_reference=reference,
            payer_name=payer_name,
            payer_type=payer_type,
            payer_phone=payer_phone,
            received_by=user,
            balance_before=bal_before,
            balance_after=bal_after,
            verification_code=verif_code,
            notes=notes
        )

        # Handle allocations
        if allocations and isinstance(allocations, list):
            for a in allocations:
                cat_id = a.get("category")
                amt = Decimal(str(a.get("amount", "0")))
                if cat_id and amt > Decimal("0.00"):
                    PaymentAllocation.objects.create(payment=payment, category_id=cat_id, amount=amt)
        else:
            # Auto-allocate to unpaid categories or first active category
            remaining = amount_dec
            for cat_info in current["categories"]:
                cat_due = cat_info["expected"] - cat_info["paid"]
                if cat_due > Decimal("0.00") and remaining > Decimal("0.00"):
                    alloc_amt = min(remaining, cat_due)
                    PaymentAllocation.objects.create(payment=payment, category_id=cat_info["category_id"], amount=alloc_amt)
                    remaining -= alloc_amt
            if remaining > Decimal("0.00"):
                first_cat = FeeCategory.objects.filter(is_active=True).first()
                if first_cat:
                    PaymentAllocation.objects.create(payment=payment, category=first_cat, amount=remaining)

        # Audit
        audit(
            type("Req", (), {"user": user, "META": {}})(),
            "FEE_PAYMENT",
            "finance",
            f"Receipt {receipt_no}: UGX {amount_dec:,} for {student.full_name} ({student.index_no})"
        )

        # Notify parents
        msg_body = (
            f"Payment of UGX {amount_dec:,} received for {student.full_name}. "
            f"Receipt: {receipt_no}. Balance: UGX {bal_after:,}."
        )
        for parent in student.parents.all():
            notify(parent, "FINANCE", f"Fee Payment: {receipt_no}", msg_body)

    return payment

