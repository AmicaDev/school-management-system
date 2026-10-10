import secrets
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.academics.models import (AcademicYear, ExamType, GradeBand, SchoolClass, SchoolProfile, Stream, Subject, Term,
                                   TeachingAssignment)
from apps.people.models import Student, TeacherProfile
from apps.users.models import User


class Command(BaseCommand):
    help = "DEVELOPMENT ONLY: create clearly-labelled DEMO data. Refuses to run when DEBUG is False."

    def handle(self, *a, **o):
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DJANGO_DEBUG=True.")
        pwd = secrets.token_urlsafe(10)
        SchoolProfile.objects.update_or_create(pk=1, defaults={"name": "DEMO School (development data)"})
        for i, (n, mn, mx, g, r) in enumerate([("A", 90, 100, "A", "Excellent"), ("B", 80, 89.99, "B", "Very good"),
                                              ("C", 70, 79.99, "C", "Good"), ("D", 60, 69.99, "D", "Fair"), ("F", 0, 59.99, "F", "Needs support")]):
            GradeBand.objects.get_or_create(grade=g, defaults={"minimum": mn, "maximum": mx, "description": n, "remark": r})
        for i, (n, c, w, m) in enumerate([("Assignment", "ASSIGNMENT", 10, 10), ("Beginning of Term", "BOT", 20, 100),
                                         ("Mid-Term", "MID", 30, 100), ("End of Term", "FINAL", 40, 100)]):
            ExamType.objects.get_or_create(code=c, defaults={"name": n, "weight": Decimal(w), "default_max": Decimal(m), "order": i})
        y, _ = AcademicYear.objects.get_or_create(name=str(date.today().year), defaults={
            "start_date": date(date.today().year, 1, 1), "end_date": date(date.today().year, 12, 31), "is_active": True})
        for i in range(3):
            Term.objects.get_or_create(year=y, name=f"Term {i + 1}", defaults={
                "start_date": y.start_date + timedelta(days=120 * i), "end_date": y.start_date + timedelta(days=120 * i + 100),
                "is_active": i == 0})
        cls, _ = SchoolClass.objects.get_or_create(name="Primary 1", defaults={"order": 1})
        stream, _ = Stream.objects.get_or_create(school_class=cls, name="A")
        math, _ = Subject.objects.get_or_create(code="MATH", defaults={"name": "Mathematics"})
        eng, _ = Subject.objects.get_or_create(code="ENG", defaults={"name": "English"})
        teacher = User.objects.filter(username="demo.teacher").first()
        if not teacher:
            teacher = User(username="demo.teacher", first_name="Demo", last_name="Teacher", role="TEACHER")
            teacher.set_password(pwd)
            teacher.save()
            TeacherProfile.objects.create(user=teacher, gender="F")
        stream.class_teacher = teacher
        stream.save()
        for s in (math, eng):
            TeachingAssignment.objects.get_or_create(teacher=teacher, stream=stream, subject=s)
        parent = User.objects.filter(username="demo.parent").first()
        if not parent:
            parent = User(username="demo.parent", first_name="Demo", last_name="Parent", role="PARENT")
            parent.set_password(pwd)
            parent.save()
        for fn, ln, g in [("Demo", "Learner One", "M"), ("Demo", "Learner Two", "F")]:
            s, new = Student.objects.get_or_create(first_name=fn, last_name=ln, defaults={"gender": g, "stream": stream,
                                                  "index_no": f"DEMO{Student.objects.count() + 1:04d}"})
            s.parents.add(parent)
        self.stdout.write(self.style.WARNING(f"DEMO accounts demo.teacher / demo.parent created. Password for both: {pwd}"))
