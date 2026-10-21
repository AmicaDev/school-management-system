import re

from django.contrib.auth import password_validation
from django.contrib.auth.models import update_last_login
from rest_framework import exceptions, serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .passwords import check_password_strength


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name", "phone", "address", "photo", "role", "is_active",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class LoginSerializer(TokenObtainPairSerializer):
    """Accepts standard usernames and parent student index numbers."""

    def validate(self, attrs):
        ident = (attrs.get(self.username_field) or "").strip()
        pwd = (attrs.get("password") or "").strip()

        # 1. Standard authentication if username exists and password matches
        user = User.objects.filter(username__iexact=ident, is_active=True).first()
        if user and user.check_password(pwd):
            self.user = user
            refresh = self.get_token(self.user)
            return {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "user": UserSerializer(self.user).data,
            }

        # 2. Parent sign-in via student index number
        from apps.people.models import Student
        student = Student.objects.filter(index_no__iexact=ident, is_archived=False).first()
        if student:
            parents = list(student.parents.filter(is_active=True)[:2])
            if len(parents) == 1:
                attrs[self.username_field] = parents[0].username
                data = super().validate(attrs)
                data["user"] = UserSerializer(self.user).data
                return data

        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class TeacherLoginSerializer(serializers.Serializer):
    """
    Teacher login channel using teacher identifier (username, email, or full name)
    and admin-issued sign-in code.
    """
    identifier = serializers.CharField(required=False, allow_blank=True)
    username = serializers.CharField(required=False, allow_blank=True)
    code = serializers.CharField(required=False, allow_blank=True)
    password = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        ident = (attrs.get("identifier") or attrs.get("username") or "").strip()
        code = (attrs.get("code") or attrs.get("password") or "").strip()

        if not ident or not code:
            raise exceptions.AuthenticationFailed("Incorrect username or password.")

        # 1. Exact username match among teachers (case-insensitive)
        candidates = list(User.objects.filter(role=User.Role.TEACHER, username__iexact=ident))

        # 2. Fallback: exact email match among teachers (only if non-empty and unique)
        if not candidates:
            email_matches = list(User.objects.filter(role=User.Role.TEACHER, email__iexact=ident).exclude(email=""))
            if len(email_matches) > 1:
                raise serializers.ValidationError("More than one teacher matches that email address — use the username the administrator gave you.")
            elif len(email_matches) == 1:
                candidates = email_matches

        # 3. Fallback: full name matching
        if not candidates:
            norm_ident = re.sub(r"[^a-zA-Z0-9]+", "", ident).lower()
            if norm_ident:
                name_matches = []
                for teacher in User.objects.filter(role=User.Role.TEACHER):
                    f_norm = re.sub(r"[^a-zA-Z0-9]+", "", teacher.first_name or "").lower()
                    l_norm = re.sub(r"[^a-zA-Z0-9]+", "", teacher.last_name or "").lower()
                    # forms: first last, last first, firstlast, firstlast (case/space/punct insensitive)
                    if norm_ident in (f"{f_norm}{l_norm}", f"{l_norm}{f_norm}"):
                        name_matches.append(teacher)
                if len(name_matches) > 1:
                    raise serializers.ValidationError("More than one teacher matches that name — use the username the administrator gave you.")
                elif len(name_matches) == 1:
                    candidates = name_matches

        if not candidates:
            raise exceptions.AuthenticationFailed("Incorrect username or password.")

        teacher = candidates[0]

        # Account state check: reject unless is_active=True, role == TEACHER, profile exists and not archived
        if not teacher.is_active or teacher.role != User.Role.TEACHER:
            raise exceptions.AuthenticationFailed("Incorrect username or password.")

        profile = getattr(teacher, "teacher_profile", None)
        if profile is None or profile.is_archived:
            raise exceptions.AuthenticationFailed("Incorrect username or password.")

        # Credential check using constant-time check_password against stored hash
        if not profile.signin_code_hash or not profile.check_signin_code(code):
            raise exceptions.AuthenticationFailed("Incorrect username or password.")

        refresh = RefreshToken.for_user(teacher)
        update_last_login(None, teacher)

        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "user": UserSerializer(teacher).data,
        }
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


class DeveloperAdminAccountSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(allow_blank=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name", "is_active",
                  "admin_deactivated_at", "created_at", "password"]
        read_only_fields = ["id", "full_name", "is_active", "admin_deactivated_at", "created_at"]

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate(self, attrs):
        account = User(username=attrs["username"], email=attrs["email"])
        check_password_strength(attrs["password"], user=account)
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(role=User.Role.ADMIN, **validated_data)
        user.set_password(password)
        user.save()
        return user


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
