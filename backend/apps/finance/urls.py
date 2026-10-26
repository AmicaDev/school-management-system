from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("categories", views.FeeCategoryViewSet, basename="fee-category")
router.register("structures", views.FeeStructureViewSet, basename="fee-structure")
router.register("adjustments", views.StudentFeeAdjustmentViewSet, basename="fee-adjustment")
router.register("payments", views.FeePaymentViewSet, basename="fee-payment")
router.register("expenses", views.ExpenseViewSet, basename="expense")

urlpatterns = [
    path("", include(router.urls)),
    path("accounts/", views.student_fee_accounts, name="finance-student-accounts"),
    path("accounts/<int:student_id>/statement/", views.student_fee_statement, name="finance-student-statement"),
    path("accounts/<int:student_id>/reminder/", views.send_fee_reminder, name="finance-student-reminder"),
    path("reports/", views.financial_reports, name="finance-reports"),
    path("receipts/verify/", views.verify_receipt, name="finance-verify-receipt"),
]

