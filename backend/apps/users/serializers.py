import re

from django.contrib.auth import password_validation
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User
from .passwords import check_password_strength

# "ICT 220", "ict-220" and "ICT220" are the same code for a teacher.
_CODE_STRIP = re.compile(r"[^a-z0-9]+")
# Class part of a typed subject, e.g. "P1", "S.2", "Senior 3", "Primary 1".
_CLASS_TOKEN = re.compile(r"\b((?:s\.?|senior\s*|p\.?|primary\s*)[1-6])\b", re.I)
_DIGIT = re.compile(r"([1-9])")


def _norm(value):
    """Lower-case alphanumeric form of a value, so spacing and case never block a sign-in."""
    return _CODE_STRIP.sub("", str(value or "").lower())


def _initials(value):
    """Initials of a subject name, so 'Information Communication Technology' also answers to 'ICT'."""
    return "".join(part[0] for part in re.split(r"[^A-Za-z0-9]+", str(value or "")) if part)


def _class_key(value):
    """Class letters and number of a class name, e.g. 'Senior 2' -> ('S', '2')."""
    text = str(value or "")
    letter = next((c.upper() for c in text if c.isalpha()), "")
    digit = _DIGIT.search(text)
    return (letter if letter in ("S", "P") else "", digit.group(1) if digit else "")


def _class_matches(hint, class_name):
    """True when a class hint such as 'S2' points at the given class."""
    letter, digit = hint
    if not digit:
        return True
    c_letter, c_digit = _class_key(class_name)
    if c_digit and c_digit != digit:
        return False
    if letter and c_letter and letter != c_letter:
        return False
    return True


class LoginSerializer(TokenObtainPairSerializer):
    """Accepts usernames, parent student indexes, and teacher subject names with subject codes."""

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

        # 3. Teacher sign-in with the subject they teach and its subject code
        if pwd:
            teacher = self._teacher_for(ident, pwd)
            if teacher is not None:
                self.user = teacher
                refresh = self.get_token(teacher)
                return {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                    "user": UserSerializer(teacher).data,
                }

        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data

    @staticmethod
    def _teacher_for(ident, pwd):
        """Resolve the teacher signing in with a subject name and that subject's code."""
        from apps.academics.models import TeachingAssignment

        code = _norm(pwd)
        if not code:
            return None

        assignments = list(
            TeachingAssignment.objects.filter(
                teacher__role=User.Role.TEACHER,
                teacher__is_active=True,
            ).select_related("teacher", "teacher__teacher_profile", "subject", "stream__school_class")
        )
        assignments = [
            a for a in assignments
            if not (getattr(a.teacher, "teacher_profile", None) and a.teacher.teacher_profile.is_archived)
        ]

        # The code assigned to a teacher is more precise than the code of the subject itself.
        pool = [a for a in assignments if _norm(a.teacher_subject_code) == code]
        if not pool:
            pool = [a for a in assignments if _norm(a.subject.code) == code]
        if not pool:
            return None

        hint = _CLASS_TOKEN.search(ident)
        subject_part = _CLASS_TOKEN.sub(" ", ident).strip(" -_().") if hint else ident
        subject_key = _norm(subject_part)
        hint_key = _class_key(hint.group(1)) if hint else ("", "")

        scored = []
        for a in pool:
            if subject_key and _norm(a.teacher.username) == subject_key:
                rank = 3  # the teacher signed in with their own username
            elif _norm(a.subject.name) == subject_key or _norm(a.subject.code) == subject_key:
                rank = 2  # exact subject name or subject code
            elif _norm(a.teacher_subject_code) == subject_key:
                rank = 2  # the code they were given for this assignment
            elif len(subject_key) >= 2 and _initials(a.subject.name) == subject_key:
                rank = 2  # initials, e.g. "ICT"
            elif len(subject_key) >= 3 and (
                _norm(a.subject.name).startswith(subject_key) or subject_key in _norm(a.subject.name)
            ):
                rank = 1  # partial subject name, e.g. "Math" for "Mathematics"
            else:
                rank = 0
            scored.append((rank, a))

        if hint_key[1]:
            narrowed = [x for x in scored if _class_matches(hint_key, x[1].stream.school_class.name)]
            if narrowed:
                scored = narrowed

        if subject_key:
            best = max(rank for rank, _ in scored)
            if best == 0:
                return None
            scored = [x for x in scored if x[0] == best]

        teachers = {a.teacher_id for _, a in scored}
        if len(teachers) == 1:
            return User.objects.get(pk=teachers.pop())
        if len(teachers) > 1:
            raise serializers.ValidationError({
                "username": "More than one teacher is assigned this subject. Add the class to the username, for example 'English S2'."
            })
        return None


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
