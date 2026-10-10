from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers


def check_password_strength(password, user=None, field="password"):
    """Run Django's configured validators and raise a DRF 400 (not a 500) on failure."""
    try:
        password_validation.validate_password(password, user)
    except DjangoValidationError as e:
        raise serializers.ValidationError({field: list(e.messages)})
