from django.conf import settings
from django.db import models

from apps.academics.models import IMAGE_VALIDATORS, Stream


class Gender(models.TextChoices):
    MALE = "M", "Male"
    FEMALE = "F", "Female"


class Student(models.Model):
    index_no = models.CharField(max_length=30, unique=True, db_index=True)
    candidate_no = models.CharField(max_length=30, unique=True, null=True, blank=True)
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    gender = models.CharField(max_length=1, choices=Gender.choices, db_index=True)
    date_of_birth = models.DateField(null=True, blank=True)
    photo = models.ImageField(upload_to="students/", blank=True, validators=IMAGE_VALIDATORS)
    stream = models.ForeignKey(Stream, null=True, blank=True, on_delete=models.PROTECT, related_name="students")
    parents = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="children",
                                     limit_choices_to={"role": "PARENT"})
    admission_date = models.DateField(auto_now_add=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["last_name", "first_name"]
        indexes = [models.Index(fields=["stream", "is_archived"])]

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"

    def __str__(self):
        return f"{self.full_name} ({self.index_no})"


class TeacherProfile(models.Model):
    class MaritalStatus(models.TextChoices):
        SINGLE = "SINGLE", "Single"
        MARRIED = "MARRIED", "Married"
        DIVORCED = "DIVORCED", "Divorced"
        WIDOWED = "WIDOWED", "Widowed"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="teacher_profile")
    gender = models.CharField(max_length=1, choices=Gender.choices)
    bio = models.TextField(blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    marital_status = models.CharField(max_length=10, choices=MaritalStatus.choices, blank=True)
    qualification = models.CharField(max_length=150, blank=True)
    years_experience = models.PositiveSmallIntegerField(default=0)
    languages = models.JSONField(default=list, blank=True)
    address = models.CharField(max_length=255, blank=True)
    photo = models.ImageField(upload_to="teachers/", blank=True, validators=IMAGE_VALIDATORS)
    is_archived = models.BooleanField(default=False, db_index=True)
    signin_code_hash = models.CharField(max_length=255, null=True, blank=True)
    signin_code_issued_at = models.DateTimeField(null=True, blank=True)

    def set_signin_code(self, raw_code):
        from django.contrib.auth.hashers import make_password
        from django.utils import timezone
        self.signin_code_hash = make_password(raw_code)
        self.signin_code_issued_at = timezone.now()

    def check_signin_code(self, raw_code):
        from django.contrib.auth.hashers import check_password
        if not self.signin_code_hash:
            return False
        return check_password(raw_code, self.signin_code_hash)

    def __str__(self):
        return self.user.full_name


class StaffMember(models.Model):
    class Category(models.TextChoices):
        TEACHING = "TEACHING", "Teaching"
        NON_TEACHING = "NON_TEACHING", "Non-teaching"

    class MaritalStatus(models.TextChoices):
        SINGLE = "SINGLE", "Single"
        MARRIED = "MARRIED", "Married"
        DIVORCED = "DIVORCED", "Divorced"
        WIDOWED = "WIDOWED", "Widowed"

    name = models.CharField(max_length=150)
    gender = models.CharField(max_length=1, choices=Gender.choices)
    category = models.CharField(max_length=15, choices=Category.choices, default=Category.NON_TEACHING)
    position = models.CharField(max_length=100)
    department = models.CharField(max_length=100, blank=True)
    contact = models.CharField(max_length=100, blank=True)
    bio = models.TextField(blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    marital_status = models.CharField(max_length=10, choices=MaritalStatus.choices, blank=True)
    qualification = models.CharField(max_length=150, blank=True)
    years_experience = models.PositiveSmallIntegerField(default=0)
    languages = models.JSONField(default=list, blank=True)
    address = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, default="ACTIVE", choices=[("ACTIVE", "Active"), ("INACTIVE", "Inactive")])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
