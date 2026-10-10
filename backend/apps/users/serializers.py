from django.contrib.auth import password_validation
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class LoginSerializer(TokenObtainPairSerializer):
    """Accepts a username, or (for parents) a student index number as the identifier."""

    def validate(self, attrs):
        ident = attrs.get(self.username_field, "")
        if ident and not User.objects.filter(username__iexact=ident).exists():
            from apps.people.models import Student
            student = Student.objects.filter(index_no__iexact=ident, is_archived=False).first()
            if student:
                parents = list(student.parents.filter(is_active=True)[:2])
                if len(parents) == 1:
                    attrs[self.username_field] = parents[0].username
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name", "phone", "address", "photo", "role", "is_active",
                  "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at", "role", "is_active"]


class ManagedUserSerializer(serializers.ModelSerializer):
    """Used by ADMIN to manage non-developer accounts."""
    password = serializers.CharField(write_only=True, required=False, style={"input_type": "password"})
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name", "phone", "address", "photo", "role", "is_active",
                  "password", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_role(self, value):
        if value == User.Role.DEVELOPER:
            raise serializers.ValidationError("Developer accounts cannot be managed from the school portal.")
        return value

    def validate_password(self, value):
        password_validation.validate_password(value)
        return value

    def create(self, validated):
        pwd = validated.pop("password", None)
        if not pwd:
            raise serializers.ValidationError({"password": "Password is required."})
        user = User(**validated)
        user.set_password(pwd)
        user.save()
        return user

    def update(self, instance, validated):
        pwd = validated.pop("password", None)
        for k, v in validated.items():
            setattr(instance, k, v)
        if pwd:
            instance.set_password(pwd)
        instance.save()
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField()
    new_password = serializers.CharField()

    def validate_new_password(self, v):
        password_validation.validate_password(v)
        return v


class ResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField()
