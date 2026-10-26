from datetime import date
from decimal import Decimal

from apps.academics.models import AcademicYear, SchoolClass, Stream, Term
from apps.comms.models import Notification
from apps.finance.models import (Expense, FeeCategory, FeePayment, FeeStructure,
                                PaymentAllocation, SectionType,
                                StudentFeeAdjustment)
from apps.finance.services import amount_to_words, calculate_student_fee_balance
from apps.people.models import Student
from apps.users.models import User

from .test_core import PW, Base, mk


class FinanceTests(Base):
    def setUp(self):
        super().setUp()
        self.bursar = mk("bursar1", "BURSAR", first_name="Betty", last_name="Bursar")

        # Create Fee categories
        self.cat_tuition = FeeCategory.objects.create(name="Tuition", code="TUI")
        self.cat_meals = FeeCategory.objects.create(name="Meals & Lunch", code="MEAL")
        self.cat_uniform = FeeCategory.objects.create(name="Uniform", code="UNI")

        # Create Fee structures for S1 (self.stream.school_class)
        self.fee_tui = FeeStructure.objects.create(
            academic_year=self.term.year,
            term=self.term,
            school_class=self.stream.school_class,
            section=SectionType.ALL,
            category=self.cat_tuition,
            amount=Decimal("500000.00"),
            created_by=self.admin
        )
        self.fee_meals = FeeStructure.objects.create(
            academic_year=self.term.year,
            term=self.term,
            school_class=self.stream.school_class,
            section=SectionType.ALL,
            category=self.cat_meals,
            amount=Decimal("150000.00"),
            created_by=self.admin
        )

    def test_amount_to_words(self):
        self.assertEqual(amount_to_words(150000), "ONE HUNDRED AND FIFTY THOUSAND SHILLINGS ONLY")
        self.assertEqual(amount_to_words(650000), "SIX HUNDRED AND FIFTY THOUSAND SHILLINGS ONLY")
        self.assertEqual(amount_to_words(0), "ZERO SHILLINGS ONLY")

    def test_fee_structure_and_duplicate_prevention(self):
        self.client.force_authenticate(user=self.admin)
        r_dupe = self.client.post("/api/v1/finance/structures/", {
            "academic_year": self.term.year.id,
            "term": self.term.id,
            "school_class": self.stream.school_class.id,
            "section": SectionType.ALL,
            "category": self.cat_tuition.id,
            "amount": "600000.00",
        }, format="json")
        self.assertEqual(r_dupe.status_code, 400)

    def test_initial_balance_calculation(self):
        summary = calculate_student_fee_balance(self.s1, self.term)
        self.assertEqual(summary["expected_fees"], Decimal("650000.00"))
        self.assertEqual(summary["total_paid"], Decimal("0.00"))
        self.assertEqual(summary["outstanding_balance"], Decimal("650000.00"))
        self.assertEqual(summary["status"], "UNPAID")

    def test_bursar_records_cash_payment_and_receipt(self):
        self.client.force_authenticate(user=self.bursar)
        payload = {
            "student": self.s1.id,
            "term": self.term.id,
            "amount": "400000.00",
            "payment_method": "CASH",
            "payer_name": "David One",
            "payer_type": "PARENT",
            "payer_phone": "+256701234567",
            "transaction_reference": "",
            "notes": "First installment paid in cash at bursar desk",
            "allocations": [
                {"category": self.cat_tuition.id, "amount": "300000.00"},
                {"category": self.cat_meals.id, "amount": "100000.00"},
            ]
        }
        r = self.client.post("/api/v1/finance/payments/record-payment/", payload, format="json")
        self.assertEqual(r.status_code, 201, r.content)

        payment_id = r.data["id"]
        receipt_no = r.data["receipt_no"]
        self.assertTrue(receipt_no.startswith("RCP-"))
        self.assertEqual(Decimal(str(r.data["amount"])), Decimal("400000.00"))
        self.assertEqual(Decimal(str(r.data["balance_before"])), Decimal("650000.00"))
        self.assertEqual(Decimal(str(r.data["balance_after"])), Decimal("250000.00"))
        self.assertEqual(r.data["received_by_name"], "Betty Bursar")
        self.assertIn("SHILLINGS ONLY", r.data["amount_in_words"])

        # Check allocations saved
        self.assertEqual(PaymentAllocation.objects.filter(payment_id=payment_id).count(), 2)

        # Check student balance updated
        summary = calculate_student_fee_balance(self.s1, self.term)
        self.assertEqual(summary["total_paid"], Decimal("400000.00"))
        self.assertEqual(summary["outstanding_balance"], Decimal("250000.00"))
        self.assertEqual(summary["status"], "PARTIAL")

        # Check parent received in-app notification
        notif = Notification.objects.filter(recipient=self.p1, kind="FINANCE").first()
        self.assertIsNotNone(notif)
        self.assertIn(receipt_no, notif.title)
        self.assertIn("UGX 400,000", notif.body)

        # Check receipt detail endpoint
        r_rec = self.client.get(f"/api/v1/finance/payments/{payment_id}/receipt/")
        self.assertEqual(r_rec.status_code, 200)
        self.assertEqual(r_rec.data["receipt_no"], receipt_no)
        self.assertEqual(r_rec.data["school_name"], "ST. JOSEPH'S SECONDARY SCHOOL")

        # Check public verification endpoint
        verif_code = r.data["verification_code"]
        self.client.force_authenticate(user=None)
        r_verif = self.client.get(f"/api/v1/finance/receipts/verify/?code={verif_code}")
        self.assertEqual(r_verif.status_code, 200)
        self.assertTrue(r_verif.data["valid"])
        self.assertEqual(r_verif.data["receipt_no"], receipt_no)

    def test_overpayment_and_waiver_adjustments(self):
        # Add a 100,000 waiver
        StudentFeeAdjustment.objects.create(
            student=self.s2,
            academic_year=self.term.year,
            term=self.term,
            kind="SCHOLARSHIP",
            amount=Decimal("100000.00"),
            reason="Academic excellence scholarship",
            approved_by=self.admin
        )
        summary = calculate_student_fee_balance(self.s2, self.term)
        # Expected: 650000 - 100000 = 550000
        self.assertEqual(summary["expected_fees"], Decimal("550000.00"))

        # Pay 600,000 (overpayment by 50,000)
        self.client.force_authenticate(user=self.bursar)
        r = self.client.post("/api/v1/finance/payments/record-payment/", {
            "student": self.s2.id,
            "term": self.term.id,
            "amount": "600000.00",
            "payment_method": "BANK",
            "payer_name": "Mary Two",
            "payer_type": "PARENT",
            "payer_phone": "+256709876543",
        }, format="json")
        self.assertEqual(r.status_code, 201)

        summary_after = calculate_student_fee_balance(self.s2, self.term)
        self.assertEqual(summary_after["outstanding_balance"], Decimal("-50000.00"))
        self.assertEqual(summary_after["status"], "OVERPAID")

    def test_payment_reversal(self):
        self.client.force_authenticate(user=self.bursar)
        r_pay = self.client.post("/api/v1/finance/payments/record-payment/", {
            "student": self.s1.id,
            "term": self.term.id,
            "amount": "100000.00",
            "payment_method": "CASH",
            "payer_name": "David One",
        }, format="json")
        pay_id = r_pay.data["id"]

        # Reverse payment
        r_rev = self.client.post(f"/api/v1/finance/payments/{pay_id}/reverse/", {
            "reason": "Customer deposited cash into wrong student account by mistake"
        }, format="json")
        self.assertEqual(r_rev.status_code, 200)

        payment = FeePayment.objects.get(pk=pay_id)
        self.assertTrue(payment.is_reversed)
        self.assertEqual(payment.reversed_by, self.bursar)

        # Balance goes back up
        summary = calculate_student_fee_balance(self.s1, self.term)
        self.assertEqual(summary["total_paid"], Decimal("0.00"))

    def test_financial_reports_and_cashbook_reconciliation(self):
        self.client.force_authenticate(user=self.bursar)
        # Cash payment: 300,000
        self.client.post("/api/v1/finance/payments/record-payment/", {
            "student": self.s1.id, "term": self.term.id, "amount": "300000.00",
            "payment_method": "CASH", "payer_name": "David",
        }, format="json")
        # Bank payment: 200,000
        self.client.post("/api/v1/finance/payments/record-payment/", {
            "student": self.s2.id, "term": self.term.id, "amount": "200000.00",
            "payment_method": "BANK", "payer_name": "Mary",
        }, format="json")

        # Cash expense: 50,000
        Expense.objects.create(
            title="Office Stationery", category="ADMINISTRATION", amount=Decimal("50000.00"),
            date=date.today(), payment_method="CASH", recipient="Mukwano Bookshop", approved_by=self.bursar
        )

        r_rep = self.client.get(f"/api/v1/finance/reports/?term={self.term.id}")
        self.assertEqual(r_rep.status_code, 200)
        self.assertEqual(Decimal(str(r_rep.data["total_collected"])), Decimal("500000.00"))
        self.assertEqual(Decimal(str(r_rep.data["cash_collected"])), Decimal("300000.00"))
        self.assertEqual(Decimal(str(r_rep.data["cash_spent"])), Decimal("50000.00"))
        self.assertEqual(Decimal(str(r_rep.data["cash_in_hand"])), Decimal("250000.00"))

    def test_permission_boundaries(self):
        # Teacher cannot record fee payments
        self.client.force_authenticate(user=self.t1)
        r = self.client.post("/api/v1/finance/payments/record-payment/", {
            "student": self.s1.id, "term": self.term.id, "amount": "100000.00",
            "payment_method": "CASH", "payer_name": "David",
        }, format="json")
        self.assertEqual(r.status_code, 403)

        # Parent cannot access financial reports
        self.client.force_authenticate(user=self.p1)
        r_rep = self.client.get("/api/v1/finance/reports/")
        self.assertEqual(r_rep.status_code, 403)

