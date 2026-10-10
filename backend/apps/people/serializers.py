from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.academics.models import Stream
from apps.users.models import User
from apps.users.passwords import check_password_strength

from .models import StaffMember, Student, TeacherProfile


class StudentSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    stream_label = serializers.SerializerMethodField()
    class_name = serializers.CharField(source="stream.school_class.name", read_only=True, default=None)
    parent_ids = serializers.PrimaryKeyRelatedField(source="parents", many=True, required=False,
                                                    queryset=User.objects.filter(role="PARENT"))
    index_no = serializers.CharField(required=False, allow_blank=True)
    candidate_no = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Student
        fields = ["id", "index_no", "candidate_no", "first_name", "last_name", "full_name", "gender", "date_of_birth", "photo", "stream",
                  "stream_label", "class_name", "parent_ids", "admission_date", "is_archived", "created_at", "updated_at"]
        read_only_fields = ["admission_date", "created_at", "updated_at", "is_archived"]

    def get_stream_label(self, obj):
        return str(obj.stream) if obj.stream_id else None

    def create(self, validated):
        with transaction.atomic():
            if not validated.get("index_no"):
                last = Student.objects.select_for_update().order_by("-id").first()
                validated["index_no"] = f"S{timezone.now().year}{(last.id + 1 if last else 1):05d}"
            return super().create(validated)

    def validate_index_no(self, v):
        qs = Student.objects.filter(index_no__iexact=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if v and qs.exists():
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
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    assignments = serializers.SerializerMethodField()
    class_stream_ids = serializers.PrimaryKeyRelatedField(
        source="user.class_streams", many=True, queryset=Stream.objects.all(), required=False
    )

    class Meta:
        model = TeacherProfile
        fields = ["id", "user_id", "username", "email", "first_name", "last_name", "full_name", "phone", "is_active",
                  "password", "gender", "bio", "nationality", "marital_status", "qualification", "years_experience",
                  "languages", "address", "photo", "is_archived", "assignments", "class_stream_ids"]
        read_only_fields = ["is_archived"]

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
        user = self._make_user(udata, "TEACHER")
        profile = TeacherProfile.objects.create(user=user, **validated)
        if class_streams is not None:
            user.class_streams.set(class_streams)
        return profile

    @transaction.atomic
    def update(self, instance, validated):
        udata = validated.pop("user", {})
        class_streams = udata.pop("class_streams", None)
        pwd = validated.pop("password", None)
        for k, v in udata.items():
            setattr(instance.user, k, v)
        if pwd:
            check_password_strength(pwd, instance.user)
            instance.user.set_password(pwd)
        instance.user.save()
        profile = super().update(instance, validated)
        if class_streams is not None:
            instance.user.class_streams.set(class_streams)
        return profile


class StaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffMember
        fields = "__all__"
