from django.contrib.auth.models import AbstractUser
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models


def validate_profile_photo_size(image):
    if image.size > settings.MAX_IMAGE_BYTES:
        raise ValidationError("Image must be 2 MB or smaller.")


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Admin"
        TEACHER = "TEACHER", "Teacher"
        PARENT = "PARENT", "Parent"
        DEVELOPER = "DEVELOPER", "Developer"

    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.CharField(max_length=255, blank=True)
    photo = models.ImageField(
        upload_to="profiles/",
        blank=True,
        validators=[FileExtensionValidator(["jpg", "jpeg", "png", "webp"]), validate_profile_photo_size],
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.PARENT, db_index=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    admin_deactivated_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["first_name", "last_name", "username"]

    def save(self, *args, **kwargs):
        if self.role == self.Role.DEVELOPER:
            self.is_staff = True
        super().save(*args, **kwargs)

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.username
