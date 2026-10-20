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


def _names_subject(name_key, subject):
    """True when a typed name points at the subject, e.g. 'History', 'hist' or 'H' for History."""
    if not name_key or subject is None:
        return False
    if _norm(subject.name) == name_key or _norm(subject.code) == name_key:
        return True
    if len(name_key) >= 2 and _initials(subject.name) == name_key:
        return True
    return len(name_key) >= 3 and name_key in _norm(subject.name)


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
    def _is_signable_teacher(user):
        """True when a teacher account may still sign in: active and not archived."""
        if not user.is_active or user.role != User.Role.TEACHER:
            return False
        profile = getattr(user, "teacher_profile", None)
        return not (profile and profile.is_archived)

    @staticmethod
    def _bindings():
        """Every teacher/subject pairing the school recorded, with the code the administrator set."""
        from apps.academics.models import TeachingAssignment
        from apps.timetable.models import TimetableEntry

        rows = []
        sources = (
            (TeachingAssignment.objects.filter(teacher__role=User.Role.TEACHER, teacher__is_active=True),
             lambda row: row.teacher_subject_code),
            (TimetableEntry.objects.filter(teacher__role=User.Role.TEACHER, teacher__is_active=True),
             lambda row: ""),
        )
        for queryset, code_of in sources:
            for row in queryset.select_related("teacher", "teacher__teacher_profile", "subject", "stream__school_class"):
                if not LoginSerializer._is_signable_teacher(row.teacher):
                    continue
                rows.append({
                    "teacher": row.teacher,
                    "subject": row.subject,
                    "code": code_of(row),
                    "class": row.stream.school_class.name if row.stream_id else "",
                })
        return rows

    @staticmethod
    def _subject_for_code(code):
        """The subject whose own code matches, ignoring case and separators."""
        from apps.academics.models import Subject

        for subject in Subject.objects.all():
            if _norm(subject.code) == code:
                return subject
        return None

    @staticmethod
    def _rank(binding, name_key):
        """How well a typed name matches a teacher's subject (3 = the teacher's own username)."""
        teacher, subject, teacher_code = binding["teacher"], binding["subject"], binding["code"]
        if not name_key:
            return 1
        if _norm(teacher.username) == name_key:
            return 3  # the teacher signed in with their own username
        if _norm(subject.name) == name_key or _norm(subject.code) == name_key:
            return 2  # exact subject name or subject code
        if _norm(teacher_code) == name_key:
            return 2  # the code they were given for this assignment
        if len(name_key) >= 2 and _initials(subject.name) == name_key:
            return 2  # initials, e.g. "ICT"
        if len(name_key) >= 3 and name_key in _norm(subject.name):
            return 1  # partial subject name, e.g. "Math" for "Mathematics"
        return 0

    @staticmethod
    def _signin_error(ident, name_key, subject):
        """Explain what a teacher sign-in is missing, instead of a bare 'wrong credentials'."""
        if subject is None or not _names_subject(name_key, subject):
            return None
        account = User.objects.filter(role=User.Role.TEACHER, username__iexact=ident.strip()).first()
        if account is not None and not LoginSerializer._is_signable_teacher(account):
            return None  # an archived or inactive account keeps the generic rejection
        detail = (f"No teacher is signed in with the subject code '{subject.code}' yet. "
                  f"Ask the administrator to assign '{subject.name}' to a teacher.")
        return serializers.ValidationError({"username": detail})

    @staticmethod
    def _teacher_for(ident, pwd):
        """Resolve the teacher signing in with a subject name and that subject's code."""
        code = _norm(pwd)
        if not code or not ident.strip():
            return None

        hint = _CLASS_TOKEN.search(ident)
        subject_part = _CLASS_TOKEN.sub(" ", ident).strip(" -_().") if hint else ident
        name_key = _norm(subject_part)
        hint_key = _class_key(hint.group(1)) if hint else ("", "")

        bindings = LoginSerializer._bindings()
        subject = LoginSerializer._subject_for_code(code)

        # The code assigned to a teacher is more precise than the code of the subject itself.
        pool = [b for b in bindings if _norm(b["code"]) == code]
        if not pool and subject is not None:
            pool = [b for b in bindings if b["subject"].pk == subject.pk]
        if subject is not None and _names_subject(name_key, subject):
            # The account may be named after the subject it teaches, e.g. 'HISTORY' for History.
            named = User.objects.filter(role=User.Role.TEACHER, is_active=True, username__iexact=subject_part.strip())
            for teacher in named:
                if LoginSerializer._is_signable_teacher(teacher):
                    pool.append({"teacher": teacher, "subject": subject, "code": code, "class": ""})
        if not pool:
            error = LoginSerializer._signin_error(ident, name_key, subject)
            if error is not None:
                raise error
            return None

        if hint_key[1]:
            narrowed = [b for b in pool if _class_matches(hint_key, b["class"])]
            if narrowed:
                pool = narrowed

        ranked = [(LoginSerializer._rank(b, name_key), b) for b in pool]
        best = max((rank for rank, _ in ranked), default=0)
        if best:
            # Keep only the best matches; an unmatched name falls back to the code alone.
            pool = [b for rank, b in ranked if rank == best]

        teachers = {b["teacher"].pk for b in pool}
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
