from rest_framework import serializers

from .models import (Expense, FeeCategory, FeePayment, FeeStructure,
                    PaymentAllocation, StudentFeeAdjustment)
from .services import amount_to_words


class FeeCategorySerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")

    class Meta:
        model = FeeCategory
        fields = [
            "id", "name", "code", "description", "is_active", "is_approved",
            "created_by", "created_by_name", "approved_by", "approved_by_name",
            "approved_at", "created_at"
        ]
        read_only_fields = ["is_approved", "created_by", "approved_by", "approved_at", "created_at"]


class FeeStructureSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_code = serializers.CharField(source="category.code", read_only=True)
    class_name = serializers.CharField(source="school_class.name", read_only=True)
    term_name = serializers.CharField(source="term.name", read_only=True, default="Annual")
    year_name = serializers.CharField(source="academic_year.name", read_only=True)

    class Meta:
        model = FeeStructure
        fields = [
            "id", "academic_year", "year_name", "term", "term_name", "school_class",
            "class_name", "section", "category", "category_name", "category_code",
            "amount", "description", "created_by", "created_at", "updated_at"
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]
        extra_kwargs = {
            "academic_year": {"required": False}
        }

    def validate(self, attrs):
        from apps.academics.models import AcademicYear
        term = attrs.get("term")
        if not attrs.get("academic_year"):
            if term and getattr(term, "year", None):
                attrs["academic_year"] = term.year
            else:
                active_y = AcademicYear.objects.filter(is_active=True).first() or AcademicYear.objects.first()
                if active_y:
                    attrs["academic_year"] = active_y
                else:
                    raise serializers.ValidationError({"academic_year": "Academic year is required."})
        return attrs


class StudentFeeAdjustmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    student_index = serializers.CharField(source="student.index_no", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True, default="")
    term_name = serializers.CharField(source="term.name", read_only=True)

    class Meta:
        model = StudentFeeAdjustment
        fields = [
            "id", "student", "student_name", "student_index", "academic_year", "term",
            "term_name", "category", "category_name", "kind", "amount", "reason",
            "approved_by", "created_at"
        ]
        read_only_fields = ["approved_by", "created_at"]


class PaymentAllocationSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = PaymentAllocation
        fields = ["id", "category", "category_name", "amount"]


class FeePaymentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    index_no = serializers.CharField(source="student.index_no", read_only=True)
    class_name = serializers.SerializerMethodField()
    term_name = serializers.CharField(source="term.name", read_only=True)
    year_name = serializers.CharField(source="academic_year.name", read_only=True)
    received_by_name = serializers.CharField(source="received_by.full_name", read_only=True, default="")
    allocations = PaymentAllocationSerializer(many=True, read_only=True)
    amount_in_words = serializers.SerializerMethodField()

    class Meta:
        model = FeePayment
        fields = [
            "id", "receipt_no", "student", "student_name", "index_no", "class_name",
            "academic_year", "year_name", "term", "term_name", "amount", "amount_in_words",
            "payment_method", "transaction_reference", "payer_name", "payer_type", "payer_phone",
            "received_by", "received_by_name", "balance_before", "balance_after",
            "verification_code", "notes", "is_reversed", "reversal_reason",
            "allocations", "created_at"
        ]
        read_only_fields = [
            "receipt_no", "received_by", "balance_before", "balance_after",
            "verification_code", "is_reversed", "reversal_reason", "created_at"
        ]

    def get_class_name(self, obj):
        if obj.student and obj.student.stream and obj.student.stream.school_class:
            return obj.student.stream.school_class.name
        return ""

    def get_amount_in_words(self, obj):
        return amount_to_words(obj.amount)


class RecordPaymentSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    term = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=1)
    payment_method = serializers.ChoiceField(
        choices=["CASH", "BANK", "MOBILE_MONEY", "MTN_MOBILE_MONEY", "AIRTEL_MONEY", "OTHER"],
        default="CASH"
    )
    transaction_reference = serializers.CharField(max_length=100, allow_blank=True, required=False, default="")
    payer_name = serializers.CharField(max_length=150)
    payer_type = serializers.ChoiceField(choices=["PARENT", "GUARDIAN", "STUDENT", "SPONSOR", "OTHER"], default="PARENT")
    payer_phone = serializers.CharField(max_length=40, allow_blank=True, required=False, default="")
    notes = serializers.CharField(allow_blank=True, required=False, default="")
    allocations = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class ExpenseSerializer(serializers.ModelSerializer):
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")

    class Meta:
        model = Expense
        fields = [
            "id", "title", "category", "amount", "date", "payment_method",
            "recipient", "receipt_voucher", "notes", "approved_by", "approved_by_name", "created_at"
        ]
        read_only_fields = ["approved_by", "created_at"]

