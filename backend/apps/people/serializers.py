import re
import secrets
import string

from django.db import transaction
from rest_framework import serializers

from apps.academics.models import Stream
from apps.users.models import User
from apps.users.passwords import check_password_strength

from .models import StaffMember, Student, TeacherProfile


def generate_teacher_code():
    """Default random code in format XXXX-NNNN (e.g. ABCD-1234)."""
    letters = "".join(secrets.choice(string.ascii_uppercase) for _ in range(4))
    digits = "".join(secrets.choice(string.digits) for _ in range(4))
    return f"{letters}-{digits}"


def generate_unique_index_no(year=None):
    from datetime import date
    y = year or date.today().year
    prefix = f"STU/{y}/"
    for _ in range(100):
        code = f"{prefix}{secrets.randbelow(90000) + 10000}"
        if not Student.objects.filter(index_no__iexact=code).exists():
            return code
    return f"{prefix}{secrets.token_hex(3).upper()}"


def generate_unique_teacher_code():
    for _ in range(100):
        code = generate_teacher_code()
        collision = False
        for p in TeacherProfile.objects.filter(signin_code_hash__isnull=False).exclude(signin_code_hash=""):
            if p.check_signin_code(code):
                collision = True
                break
        if not collision:
            return code
    return code


class StudentSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    stream_label = serializers.SerializerMethodField()
    class_name = serializers.CharField(source="stream.school_class.name", read_only=True, default=None)
    parent_ids = serializers.PrimaryKeyRelatedField(source="parents", many=True, required=False,
                                                    queryset=User.objects.filter(role="PARENT"))
    index_no = serializers.CharField(required=True, allow_blank=False)
    candidate_no = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Student
        fields = ["id", "index_no", "candidate_no", "first_name", "last_name", "full_name", "gender", "date_of_birth", "photo", "stream",
                  "stream_label", "class_name", "parent_ids", "admission_date", "is_archived", "created_at", "updated_at"]
        read_only_fields = ["admission_date", "created_at", "updated_at", "is_archived"]

    def get_stream_label(self, obj):
        return str(obj.stream) if obj.stream_id else None

    def validate_index_no(self, v):
        v = (v or "").strip()
        if not v:
            raise serializers.ValidationError("This field is required.")
        qs = Student.objects.filter(index_no__iexact=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This index number is already in use.")
        return v

    def validate_candidate_no(self, value):
        value = value.strip() if value else ""
        value = value or None
        qs = Student.objects.filter(candidate_no__iexact=value) if value else Student.objects.none()
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This candidate number is already in use.")
        return value


class ParentStudentSerializer(StudentSerializer):
    """Reduced view for parents - no internal fields."""
    class Meta(StudentSerializer.Meta):
        fields = ["id", "index_no", "candidate_no", "full_name", "gender", "date_of_birth", "photo", "stream_label", "class_name"]


class _UserWriteMixin:
    @staticmethod
    def _make_user(data, role):
        pwd = data.pop("password", None)
        if not pwd:
            raise serializers.ValidationError({"password": "Password is required."})
        check_password_strength(pwd)
        user = User(role=role, **data)
        user.set_password(pwd)
        user.save()
        return user


class ParentSerializer(_UserWriteMixin, serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    full_name = serializers.CharField(read_only=True)
    children = serializers.SerializerMethodField()
    child_ids = serializers.PrimaryKeyRelatedField(source="children", many=True, required=False,
                                                   queryset=Student.objects.all())

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "full_name", "phone", "address", "photo", "is_active", "password",
                  "is_archived", "children", "child_ids"]
        read_only_fields = ["is_archived"]

    def get_children(self, obj):
        return [{"id": s.id, "name": s.full_name, "index_no": s.index_no} for s in obj.children.all()]

    @transaction.atomic
    def create(self, validated):
        kids = validated.pop("children", [])
        user = self._make_user(validated, "PARENT")
        user.children.set(kids)
        return user

    @transaction.atomic
    def update(self, instance, validated):
        kids = validated.pop("children", None)
        pwd = validated.pop("password", None)
        for k, v in validated.items():
            setattr(instance, k, v)
        if pwd:
            check_password_strength(pwd, instance)
            instance.set_password(pwd)
        instance.save()
        if kids is not None:
            instance.children.set(kids)
        return instance


class TeacherSerializer(_UserWriteMixin, serializers.ModelSerializer):
    username = serializers.CharField(source="user.username")
    email = serializers.EmailField(source="user.email", required=False, allow_blank=True)
    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name")
    phone = serializers.CharField(source="user.phone", required=False, allow_blank=True)
    is_active = serializers.BooleanField(source="user.is_active", required=False)
    password = serializers.CharField(write_only=True, required=False)
    signin_code = serializers.CharField(required=False, allow_blank=True)
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    assignments = serializers.SerializerMethodField()
    class_stream_ids = serializers.PrimaryKeyRelatedField(
        source="user.class_streams", many=True, queryset=Stream.objects.all(), required=False
    )

    class Meta:
        model = TeacherProfile
        fields = ["id", "user_id", "username", "email", "first_name", "last_name", "full_name", "phone", "is_active",
                  "password", "signin_code", "gender", "bio", "nationality", "marital_status", "qualification", "years_experience",
                  "languages", "address", "photo", "is_archived", "assignments", "class_stream_ids"]
        read_only_fields = ["is_archived"]

    def _validate_custom_code(self, code, instance=None):
        from apps.academics.models import Subject
        code = code.strip()
        if len(code) < 4:
            raise serializers.ValidationError({
                "signin_code": "Sign-in code must be at least 4 characters long."
            })
        code_norm = re.sub(r"[^a-zA-Z0-9]+", "", code).lower()
        for s in Subject.objects.all():
            s_name_norm = re.sub(r"[^a-zA-Z0-9]+", "", s.name).lower()
            s_code_norm = re.sub(r"[^a-zA-Z0-9]+", "", s.code).lower()
            if code_norm in (s_name_norm, s_code_norm):
                raise serializers.ValidationError({
                    "signin_code": f"A bare subject name or code cannot be used. Suffix it with the class (e.g. {s.name}-S1) for security."
                })
        for p in TeacherProfile.objects.filter(signin_code_hash__isnull=False).exclude(signin_code_hash=""):
            if instance and p.pk == instance.pk:
                continue
            if p.check_signin_code(code):
                raise serializers.ValidationError({
                    "signin_code": "This sign-in code is already assigned to another teacher."
                })

    def validate(self, attrs):
        uname = (attrs.get("user") or {}).get("username")
        if uname:
            qs = User.objects.filter(username__iexact=uname)
            if self.instance:
                qs = qs.exclude(pk=self.instance.user_id)
            if qs.exists():
                raise serializers.ValidationError({"username": "This username is already taken."})
        return attrs

    def get_assignments(self, obj):
        return [{"subject": a.subject.name, "code": a.teacher_subject_code or a.subject.code, "stream": str(a.stream),
                 "paper_number": a.paper_number}
                for a in obj.user.assignments.all()]

    @transaction.atomic
    def create(self, validated):
        udata = validated.pop("user")
        class_streams = udata.pop("class_streams", None)
        udata["password"] = validated.pop("password", None)
        raw_code = (validated.pop("signin_code", None) or "").strip()
        if raw_code:
            self._validate_custom_code(raw_code)
        else:
            raw_code = generate_unique_teacher_code()

        user = self._make_user(udata, "TEACHER")
        profile = TeacherProfile.objects.create(user=user, **validated)
        profile.set_signin_code(raw_code)
        profile.save(update_fields=["signin_code", "signin_code_hash", "signin_code_issued_at"])
        profile._raw_signin_code = raw_code
        if class_streams is not None:
            user.class_streams.set(class_streams)
        return profile

    @transaction.atomic
    def update(self, instance, validated):
        udata = validated.pop("user", {})
        class_streams = udata.pop("class_streams", None)
        pwd = validated.pop("password", None)
        raw_code = (validated.pop("signin_code", None) or "").strip()
        for k, v in udata.items():
            setattr(instance.user, k, v)
        if pwd:
            check_password_strength(pwd, instance.user)
            instance.user.set_password(pwd)
        instance.user.save()

        if raw_code:
            self._validate_custom_code(raw_code, instance=instance)
            instance.set_signin_code(raw_code)
            instance.save(update_fields=["signin_code", "signin_code_hash", "signin_code_issued_at"])
            instance._raw_signin_code = raw_code

        profile = super().update(instance, validated)
        if raw_code:
            profile._raw_signin_code = raw_code
        if class_streams is not None:
            instance.user.class_streams.set(class_streams)
        return profile

    def to_representation(self, instance):
        data = super().to_representation(instance)
        code = getattr(instance, "_raw_signin_code", None) or instance.signin_code
        if not code and not instance.is_archived:
            try:
                code = generate_unique_teacher_code()
                instance.set_signin_code(code)
                instance.save(update_fields=["signin_code", "signin_code_hash", "signin_code_issued_at"])
            except Exception:
                pass
        data["signin_code"] = code or ""
        return data


class StaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffMember
        fields = "__all__"
