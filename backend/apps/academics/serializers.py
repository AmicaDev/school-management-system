from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from . import models as m


class CleanedModelSerializer(serializers.ModelSerializer):
    """Runs Django model.clean() so model rules surface as API validation errors."""

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance or self.Meta.model()
        for key, value in attrs.items():
            setattr(instance, key, value)
        try:
            instance.clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.messages)
        return attrs


class SchoolProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.SchoolProfile
        fields = "__all__"


class AcademicYearSerializer(CleanedModelSerializer):
    class Meta:
        model = m.AcademicYear
        fields = "__all__"


class TermSerializer(CleanedModelSerializer):
    year_name = serializers.CharField(source="year.name", read_only=True)

    class Meta:
        model = m.Term
        fields = "__all__"


class SchoolClassSerializer(serializers.ModelSerializer):
    student_count = serializers.SerializerMethodField()

    class Meta:
        model = m.SchoolClass
        fields = ["id", "name", "order", "student_count"]

    def get_student_count(self, obj):
        from apps.people.models import Student
        return Student.objects.filter(stream__school_class=obj, is_archived=False).count()


class StreamSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="__str__", read_only=True)
    class_name = serializers.CharField(source="school_class.name", read_only=True)
    class_teacher_name = serializers.CharField(source="class_teacher.full_name", read_only=True, default=None)

    class Meta:
        model = m.Stream
        fields = "__all__"


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.Subject
        fields = "__all__"

    def validate_number_of_papers(self, value):
        if self.instance and self.instance.assignments.filter(paper_number__gt=value).exists():
            raise serializers.ValidationError("Remove or reassign higher-numbered papers before reducing this value.")
        return value


class TeachingAssignmentSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.full_name", read_only=True)
    stream_label = serializers.CharField(source="stream.__str__", read_only=True)
    class_name = serializers.CharField(source="stream.school_class.name", read_only=True)
    class_id = serializers.IntegerField(source="stream.school_class_id", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    subject_code = serializers.CharField(source="subject.code", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    class Meta:
        model = m.TeachingAssignment
        fields = [
            "id", "teacher", "teacher_name", "stream", "stream_label", "class_name", "class_id",
            "subject", "subject_name", "subject_code", "paper_number", "teacher_subject_code",
            "is_active", "created_at", "updated_at", "created_by", "created_by_name"
        ]
        read_only_fields = ["created_at", "updated_at", "created_by"]
        validators = []

    def validate(self, attrs):
        attrs = super().validate(attrs)
        teacher = attrs.get("teacher", getattr(self.instance, "teacher", None))
        stream = attrs.get("stream", getattr(self.instance, "stream", None))
        subject = attrs.get("subject", getattr(self.instance, "subject", None))
        paper_number = attrs.get("paper_number", getattr(self.instance, "paper_number", 1))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))

        if subject and paper_number > subject.number_of_papers:
            raise serializers.ValidationError({
                "paper_number": f"This subject has only {subject.number_of_papers} paper(s)."
            })

        # Prevent accidental duplicate active assignments for the same stream, subject, and paper
        if is_active and stream and subject:
            dupes = m.TeachingAssignment.objects.filter(
                stream=stream, subject=subject, paper_number=paper_number, is_active=True
            )
            if self.instance:
                dupes = dupes.exclude(pk=self.instance.pk)
            if dupes.exists():
                existing = dupes.first()
                teacher_id = getattr(teacher, "id", teacher)
                if teacher_id and existing.teacher_id == teacher_id:
                    raise serializers.ValidationError({
                        "teacher": "This teacher is already actively assigned to this class and subject paper."
                    })
                raise serializers.ValidationError({
                    "stream": f"This subject paper is already actively assigned to {existing.teacher.full_name}."
                })
        return attrs


class ExamTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.ExamType
        fields = "__all__"


class GradeBandSerializer(CleanedModelSerializer):
    class Meta:
        model = m.GradeBand
        fields = "__all__"
