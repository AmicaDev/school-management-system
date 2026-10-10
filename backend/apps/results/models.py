from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.academics.models import ExamType, Subject, Term
from apps.people.models import Student


class Assessment(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="assessments")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="+")
    paper_number = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1)])
    term = models.ForeignKey(Term, on_delete=models.PROTECT, related_name="+")
    exam_type = models.ForeignKey(ExamType, on_delete=models.PROTECT, related_name="+")
    title = models.CharField(max_length=80, blank=True, help_text="e.g. 'Assignment 2' (assignments may repeat)")
    score = models.DecimalField(max_digits=6, decimal_places=2, validators=[MinValueValidator(Decimal("0"))])
    max_score = models.DecimalField(max_digits=6, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    entered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["student", "term"]), models.Index(fields=["subject", "term"])]
        constraints = [
            models.UniqueConstraint(fields=["student", "subject", "term", "exam_type", "title", "paper_number"], name="uniq_assessment"),
            models.CheckConstraint(condition=models.Q(score__lte=models.F("max_score")), name="score_lte_max"),
        ]

    @property
    def percent(self):
        return (self.score / self.max_score * 100) if self.max_score else Decimal(0)


class ReportComment(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="comments")
    term = models.ForeignKey(Term, on_delete=models.PROTECT, related_name="+")
    teacher_comment = models.TextField(blank=True)
    head_comment = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "term"], name="uniq_comment")]
