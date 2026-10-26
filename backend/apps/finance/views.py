from decimal import Decimal
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.academics.models import AcademicYear, SchoolClass, Term
from apps.audit.mixins import AuditMixin
from apps.audit.services import audit
from apps.people.models import Student
from apps.users.permissions import IsAdmin, IsFinanceUser

from .models import (Expense, FeeCategory, FeePayment, FeeStructure,
                    PaymentAllocation, StudentFeeAdjustment)
from .serializers import (ExpenseSerializer, FeeCategorySerializer,
                          FeePaymentSerializer, FeeStructureSerializer,
                          RecordPaymentSerializer,
                          StudentFeeAdjustmentSerializer)
from .services import (amount_to_words, calculate_student_fee_balance,
                       record_payment_transaction)


class FeeCategoryViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [IsFinanceUser]
    queryset = FeeCategory.objects.all()
    serializer_class = FeeCategorySerializer
    audit_module = "finance"
    search_fields = ["name", "code"]
    filterset_fields = ["is_active"]


class FeeStructureViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [IsFinanceUser]
    queryset = FeeStructure.objects.select_related("academic_year", "term", "school_class", "category", "created_by").all()
    serializer_class = FeeStructureSerializer
    audit_module = "finance"
    filterset_fields = ["academic_year", "term", "school_class", "section", "category"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class StudentFeeAdjustmentViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [IsFinanceUser]
    queryset = StudentFeeAdjustment.objects.select_related("student", "academic_year", "term", "category").all()
    serializer_class = StudentFeeAdjustmentSerializer
    audit_module = "finance"
    filterset_fields = ["student", "academic_year", "term", "kind", "category"]

    def perform_create(self, serializer):
        serializer.save(approved_by=self.request.user)


class FeePaymentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsFinanceUser]
    queryset = FeePayment.objects.select_related(
        "student__stream__school_class", "academic_year", "term", "received_by"
    ).prefetch_related("allocations__category").all()
    serializer_class = FeePaymentSerializer
    filterset_fields = ["student", "academic_year", "term", "payment_method", "is_reversed", "received_by"]
    search_fields = ["receipt_no", "student__first_name", "student__last_name", "student__index_no", "payer_name", "payer_phone"]

    @action(detail=False, methods=["post"], url_path="record-payment")
    def record_payment(self, request):
        ser = RecordPaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        payment = record_payment_transaction(
            user=request.user,
            student_id=d["student"],
            term_id=d["term"],
            amount=d["amount"],
            payment_method=d["payment_method"],
            payer_name=d["payer_name"],
            payer_type=d["payer_type"],
            payer_phone=d.get("payer_phone", ""),
            reference=d.get("transaction_reference", ""),
            notes=d.get("notes", ""),
            allocations=d.get("allocations", [])
        )

        return Response(FeePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        payment = self.get_object()
        if payment.is_reversed:
            return Response({"detail": "This payment has already been reversed."}, status=400)

        reason = request.data.get("reason", "").strip()
        if not reason:
            return Response({"detail": "A reason for reversal is required."}, status=400)

        payment.is_reversed = True
        payment.reversal_reason = reason
        payment.reversed_by = request.user
        payment.reversed_at = timezone.now()
        payment.save(update_fields=["is_reversed", "reversal_reason", "reversed_by", "reversed_at"])

        audit(request, "REVERSE_PAYMENT", "finance", f"Receipt {payment.receipt_no} reversed: {reason}")
        return Response({"detail": f"Receipt {payment.receipt_no} reversed successfully."})

    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        payment = self.get_object()
        data = FeePaymentSerializer(payment).data
        data["amount_words"] = amount_to_words(payment.amount)
        data["school_name"] = "ST. JOSEPH'S SECONDARY SCHOOL"
        data["school_contact"] = "P.O. Box 102, Kampala · Tel: +256 700 000 000"
        return Response(data)


class ExpenseViewSet(AuditMixin, viewsets.ModelViewSet):
    permission_classes = [IsFinanceUser]
    queryset = Expense.objects.select_related("approved_by").all()
    serializer_class = ExpenseSerializer
    audit_module = "finance"
    filterset_fields = ["category", "payment_method", "date"]
    search_fields = ["title", "recipient", "receipt_voucher"]

    def perform_create(self, serializer):
        serializer.save(approved_by=self.request.user)


@api_view(["GET"])
@permission_classes([IsFinanceUser])
def student_fee_accounts(request):
    """Lists students with calculated fee expected, paid, and outstanding amounts."""
    term_id = request.query_params.get("term")
    class_id = request.query_params.get("school_class")
    status_filter = request.query_params.get("status")
    search = request.query_params.get("search", "").strip().lower()

    term = Term.objects.filter(pk=term_id).first() if term_id else Term.objects.filter(is_active=True).first()
    students_qs = Student.objects.filter(is_archived=False).select_related("stream__school_class").order_by("last_name", "first_name")

    if class_id:
        students_qs = students_qs.filter(stream__school_class_id=class_id)
    if search:
        from django.db.models import Q
        students_qs = students_qs.filter(
            Q(first_name__icontains=search) | Q(last_name__icontains=search) | Q(index_no__icontains=search)
        )

    results = []
    for s in students_qs[:200]:  # Cap for speed
        summary = calculate_student_fee_balance(s, term)
        if status_filter and summary["status"] != status_filter:
            continue
        results.append(summary)

    return Response({
        "term": {"id": term.id, "name": term.name, "year": term.year.name} if term else None,
        "count": len(results),
        "results": results,
    })


@api_view(["GET"])
@permission_classes([IsFinanceUser])
def student_fee_statement(request, student_id):
    """Full statement of charges, adjustments, and receipts for a student."""
    student = Student.objects.select_related("stream__school_class").filter(pk=student_id).first()
    if not student:
        return Response({"detail": "Student not found."}, status=404)

    term_id = request.query_params.get("term")
    term = Term.objects.filter(pk=term_id).first() if term_id else Term.objects.filter(is_active=True).first()
    summary = calculate_student_fee_balance(student, term)

    # Add parent contact details for authorized staff
    parents = list(student.parents.values("id", "first_name", "last_name", "phone", "email"))
    summary["parents"] = parents

    return Response(summary)


@api_view(["GET"])
@permission_classes([IsFinanceUser])
def financial_reports(request):
    """Generates financial collection, expense, balance, and cashbook summaries."""
    term_id = request.query_params.get("term")
    term = Term.objects.filter(pk=term_id).first() if term_id else Term.objects.filter(is_active=True).first()
    today = timezone.now().date()

    payments_qs = FeePayment.objects.filter(is_reversed=False)
    expenses_qs = Expense.objects.all()

    if term:
        payments_qs = payments_qs.filter(term=term)

    # 1. Total collections
    total_collected = payments_qs.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    total_expenses = expenses_qs.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")

    # 2. Daily collections today
    today_payments = FeePayment.objects.filter(created_at__date=today, is_reversed=False)
    today_collected = today_payments.aggregate(s=Sum("amount"))["s"] or Decimal("0.00")

    # 3. By payment method
    by_method = list(payments_qs.values("payment_method").annotate(total=Sum("amount"), count=Count("id")).order_by("-total"))

    # 4. By bursar
    by_bursar = list(payments_qs.values("received_by__username", "received_by__first_name", "received_by__last_name")
                     .annotate(total=Sum("amount"), count=Count("id")).order_by("-total"))

    # 5. By category (allocations)
    by_category = list(PaymentAllocation.objects.filter(payment__is_reversed=False)
                        .values("category__name", "category__code")
                        .annotate(total=Sum("amount"))
                        .order_by("-total"))

    # 6. Cashbook reconciliation (Cash in hand = Cash collected - Cash expenses)
    cash_collected = payments_qs.filter(payment_method="CASH").aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    cash_spent = expenses_qs.filter(payment_method="CASH").aggregate(s=Sum("amount"))["s"] or Decimal("0.00")
    cash_in_hand = cash_collected - cash_spent

    return Response({
        "term": {"id": term.id, "name": term.name, "year": term.year.name} if term else None,
        "total_collected": total_collected,
        "total_expenses": total_expenses,
        "today_collected": today_collected,
        "cash_collected": cash_collected,
        "cash_spent": cash_spent,
        "cash_in_hand": cash_in_hand,
        "by_payment_method": by_method,
        "by_bursar": by_bursar,
        "by_category": by_category,
    })


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def verify_receipt(request):
    """Public verification endpoint for receipt authenticity verification."""
    code = request.query_params.get("code", "").strip()
    if not code:
        return Response({"detail": "Verification code is required."}, status=400)

    payment = FeePayment.objects.select_related("student", "academic_year", "term").filter(verification_code=code).first()
    if not payment:
        return Response({"valid": False, "detail": "Invalid or unrecognized receipt verification code."}, status=404)

    return Response({
        "valid": True,
        "receipt_no": payment.receipt_no,
        "student_name": payment.student.full_name,
        "index_no": payment.student.index_no,
        "amount": payment.amount,
        "term": f"{payment.term.name} ({payment.academic_year.name})",
        "date": payment.created_at,
        "is_reversed": payment.is_reversed,
    })


@api_view(["POST"])
@permission_classes([IsFinanceUser])
def send_fee_reminder(request, student_id):
    """Sends a high priority in-app notification to parents of a student with fee balance."""
    student = Student.objects.select_related("stream__school_class").filter(pk=student_id).first()
    if not student:
        return Response({"detail": "Student not found."}, status=404)

    term_id = request.data.get("term") or request.query_params.get("term")
    term = Term.objects.filter(pk=term_id).first() if term_id else Term.objects.filter(is_active=True).first()
    summary = calculate_student_fee_balance(student, term)
    balance = summary["outstanding_balance"]

    parents = list(student.parents.all())
    if not parents:
        return Response({"detail": "No registered parent accounts found for this student."}, status=400)

    term_name = term.name if term else "the current term"
    body = (
        f"Dear Parent/Guardian, this is a reminder that {student.full_name} ({student.index_no}) "
        f"has an outstanding fee balance of UGX {balance:,.0f} for {term_name}. "
        f"Please visit the bursar's office or make payment to keep your child's account clear. Thank you."
    )
    for p in parents:
        notify(p, "FINANCE", f"Fee Reminder: {student.full_name}", body, priority="HIGH")

    return Response({
        "ok": True,
        "detail": f"Fee reminder sent successfully to {len(parents)} parent(s).",
        "parent_count": len(parents),
        "balance": balance
    })


