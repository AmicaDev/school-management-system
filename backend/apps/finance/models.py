from decimal import Decimal
from django.conf import settings
from django.db import models

from apps.academics.models import AcademicYear, SchoolClass, Term
from apps.people.models import Student


class FeeCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=30, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_approved = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Fee categories"

    def __str__(self):
        return f"{self.name} ({self.code})"


class SectionType(models.TextChoices):
    ALL = "ALL", "All students"
    DAY = "DAY", "Day students"
    BOARDING = "BOARDING", "Boarding students"


class FeeStructure(models.Model):
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.CASCADE, related_name="fee_structures")
    term = models.ForeignKey(Term, on_delete=models.CASCADE, null=True, blank=True, related_name="fee_structures")
    school_class = models.ForeignKey(SchoolClass, on_delete=models.CASCADE, related_name="fee_structures")
    section = models.CharField(max_length=10, choices=SectionType.choices, default=SectionType.ALL)
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, related_name="fee_structures")
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    description = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["school_class__order", "category__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["academic_year", "term", "school_class", "section", "category"],
                name="uniq_class_term_fee_structure"
            )
        ]

    def __str__(self):
        term_str = self.term.name if self.term else "Annual"
        return f"{self.school_class.name} - {term_str} - {self.category.name}: {self.amount}"


class StudentFeeAdjustment(models.Model):
    class Kind(models.TextChoices):
        WAIVER = "WAIVER", "Waiver"
        SCHOLARSHIP = "SCHOLARSHIP", "Scholarship"
        DISCOUNT = "DISCOUNT", "Discount"
        SURCHARGE = "SURCHARGE", "Surcharge"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="fee_adjustments")
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.CASCADE, related_name="fee_adjustments")
    term = models.ForeignKey(Term, on_delete=models.CASCADE, related_name="fee_adjustments")
    category = models.ForeignKey(FeeCategory, on_delete=models.SET_NULL, null=True, blank=True)
    kind = models.CharField(max_length=15, choices=Kind.choices, default=Kind.WAIVER)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    reason = models.CharField(max_length=255)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.student.full_name} - {self.kind}: {self.amount}"


class PaymentMethod(models.TextChoices):
    CASH = "CASH", "Cash"
    BANK = "BANK", "Bank Deposit / Transfer"
    MOBILE_MONEY = "MOBILE_MONEY", "Mobile Money"
    MTN_MOBILE_MONEY = "MTN_MOBILE_MONEY", "MTN Mobile Money"
    AIRTEL_MONEY = "AIRTEL_MONEY", "Airtel Money"
    OTHER = "OTHER", "Other"


class PayerType(models.TextChoices):
    PARENT = "PARENT", "Parent"
    GUARDIAN = "GUARDIAN", "Guardian"
    STUDENT = "STUDENT", "Student"
    SPONSOR = "SPONSOR", "Sponsor"
    OTHER = "OTHER", "Other"


class FeePayment(models.Model):
    receipt_no = models.CharField(max_length=40, unique=True, db_index=True)
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="fee_payments")
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="fee_payments")
    term = models.ForeignKey(Term, on_delete=models.PROTECT, related_name="fee_payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    transaction_reference = models.CharField(max_length=100, blank=True)
    payer_name = models.CharField(max_length=150)
    payer_type = models.CharField(max_length=15, choices=PayerType.choices, default=PayerType.PARENT)
    payer_phone = models.CharField(max_length=40, blank=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="received_payments")
    balance_before = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    balance_after = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    verification_code = models.CharField(max_length=64, unique=True, db_index=True)
    notes = models.TextField(blank=True)
    is_reversed = models.BooleanField(default=False, db_index=True)
    reversal_reason = models.TextField(blank=True)
    reversed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reversed_payments")
    reversed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.receipt_no} - {self.student.full_name}: UGX {self.amount}"


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(FeePayment, on_delete=models.CASCADE, related_name="allocations")
    category = models.ForeignKey(FeeCategory, on_delete=models.PROTECT, related_name="payment_allocations")
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    def __str__(self):
        return f"{self.payment.receipt_no} -> {self.category.name}: UGX {self.amount}"


class Expense(models.Model):
    class Category(models.TextChoices):
        SALARIES = "SALARIES", "Staff Salaries & Allowances"
        MAINTENANCE = "MAINTENANCE", "Repairs & Maintenance"
        UTILITIES = "UTILITIES", "Utilities (Water, Power, Internet)"
        FOOD_SUPPLIES = "FOOD_SUPPLIES", "Food & Kitchen Supplies"
        ADMINISTRATION = "ADMINISTRATION", "Administrative Expenses"
        EQUIPMENT = "EQUIPMENT", "Equipment & Furniture"
        ACADEMIC = "ACADEMIC", "Academic & Exams Materials"
        TRANSPORT = "TRANSPORT", "Vehicle Fuel & Transport"
        OTHER = "OTHER", "Other Expenses"

    title = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField(db_index=True)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    recipient = models.CharField(max_length=150)
    receipt_voucher = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.title} - UGX {self.amount} ({self.date})"

