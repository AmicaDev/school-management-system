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
    subject_name = serializers.CharField(source="subject.name", read_only=True)

    class Meta:
        model = m.TeachingAssignment
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        stream = attrs.get("stream", getattr(self.instance, "stream", None))
        subject = attrs.get("subject", getattr(self.instance, "subject", None))
        paper_number = attrs.get("paper_number", getattr(self.instance, "paper_number", 1))
        if subject and paper_number > subject.number_of_papers:
            raise serializers.ValidationError({
                "paper_number": f"This subject has {subject.number_of_papers} paper(s)."
            })
        if stream and subject:
            assignments = m.TeachingAssignment.objects.filter(
                stream=stream, subject=subject, paper_number=paper_number
            )
            if self.instance:
                assignments = assignments.exclude(pk=self.instance.pk)
            if assignments.exists():
                raise serializers.ValidationError({
                    "paper_number": "A teacher is already assigned to this paper and class."
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
