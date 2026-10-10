from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, MinValueValidator
from django.db import models, transaction


def validate_image_size(f):
    if f.size > settings.MAX_IMAGE_BYTES:
        raise ValidationError("Image must be 2 MB or smaller.")


IMAGE_VALIDATORS = [FileExtensionValidator(["jpg", "jpeg", "png", "webp"]), validate_image_size]


class SchoolProfile(models.Model):
    name = models.CharField(max_length=200, default="Our School")
    logo = models.ImageField(upload_to="school/", blank=True, validators=IMAGE_VALIDATORS)
    badge = models.ImageField(upload_to="school/", blank=True, validators=IMAGE_VALIDATORS)
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    website = models.URLField(blank=True)
    motto = models.CharField(max_length=200, blank=True)
    head_teacher = models.CharField(max_length=150, blank=True)

    @classmethod
    def get(cls):
        return cls.objects.first() or cls.objects.create()

    def __str__(self):
        return self.name


class AcademicYear(models.Model):
    name = models.CharField(max_length=20, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)

    class Meta:
        ordering = ["-start_date"]

    def clean(self):
        if self.end_date and self.start_date and self.end_date <= self.start_date:
            raise ValidationError("End date must be after start date.")

    def save(self, *a, **kw):
        with transaction.atomic():
            if self.is_active:
                AcademicYear.objects.exclude(pk=self.pk).update(is_active=False)
            super().save(*a, **kw)

    def __str__(self):
        return self.name


class Term(models.Model):
    year = models.ForeignKey(AcademicYear, on_delete=models.PROTECT, related_name="terms")
    name = models.CharField(max_length=30)
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)

    class Meta:
        ordering = ["-year__start_date", "start_date"]
        constraints = [models.UniqueConstraint(fields=["year", "name"], name="uniq_term_per_year")]

    def save(self, *a, **kw):
        with transaction.atomic():
            if self.is_active:
                Term.objects.exclude(pk=self.pk).update(is_active=False)
            super().save(*a, **kw)

    def __str__(self):
        return f"{self.year} {self.name}"


class SchoolClass(models.Model):
    name = models.CharField(max_length=50, unique=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "name"]
        verbose_name_plural = "classes"

    def __str__(self):
        return self.name


class Stream(models.Model):
    school_class = models.ForeignKey(SchoolClass, on_delete=models.PROTECT, related_name="streams")
    name = models.CharField(max_length=30)
    class_teacher = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                      related_name="class_streams", limit_choices_to={"role": "TEACHER"})

    class Meta:
        ordering = ["school_class__order", "name"]
        constraints = [models.UniqueConstraint(fields=["school_class", "name"], name="uniq_stream_per_class")]

    def __str__(self):
        return f"{self.school_class.name} {self.name}"


class Subject(models.Model):
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, unique=True)
    number_of_papers = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1)])
    is_archived = models.BooleanField(default=False)
    classes = models.ManyToManyField(SchoolClass, blank=True, related_name="subjects")

    class Meta:
        ordering = ["name"]

    def save(self, *a, **kw):
        self.code = self.code.strip().upper()
        super().save(*a, **kw)

    def __str__(self):
        return f"{self.code} {self.name}"


class TeachingAssignment(models.Model):
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assignments",
                                limit_choices_to={"role": "TEACHER"})
    stream = models.ForeignKey(Stream, on_delete=models.CASCADE, related_name="assignments")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT, related_name="assignments")
    paper_number = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1)])
    teacher_subject_code = models.CharField(max_length=30, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=["stream", "subject", "paper_number"], name="uniq_assignment_paper"
        )]

    def __str__(self):
        return f"{self.teacher} - {self.subject.code} - {self.stream}"


class ExamType(models.Model):
    """Configurable: ASSIGNMENT, BOT, MID, FINAL by default (see seed/setup). weight = share of the final subject mark."""
    name = models.CharField(max_length=60)
    code = models.CharField(max_length=20, unique=True)
    weight = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("25"))
    default_max = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("100"))
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class GradeBand(models.Model):
    minimum = models.DecimalField(max_digits=5, decimal_places=2)
    maximum = models.DecimalField(max_digits=5, decimal_places=2)
    grade = models.CharField(max_length=5)
    description = models.CharField(max_length=100, blank=True)
    remark = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["-minimum"]

    def clean(self):
        if self.minimum is not None and self.maximum is not None:
            if self.minimum > self.maximum:
                raise ValidationError("Minimum cannot exceed maximum.")
            overlap = GradeBand.objects.exclude(pk=self.pk).filter(minimum__lte=self.maximum, maximum__gte=self.minimum)
            if overlap.exists():
                raise ValidationError("This range overlaps an existing grade band.")

    def __str__(self):
        return f"{self.grade} ({self.minimum}-{self.maximum})"
