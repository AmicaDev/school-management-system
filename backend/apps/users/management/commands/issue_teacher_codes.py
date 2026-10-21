import os
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.academics.models import SchoolClass, Stream, Subject, TeachingAssignment
from apps.people.models import TeacherProfile
from apps.people.serializers import generate_unique_teacher_code
from apps.users.models import User


class Command(BaseCommand):
    help = "Issue or backfill sign-in codes for active teachers. Safe and idempotent by default."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Regenerate and overwrite sign-in codes for teachers who already have one.",
        )
        parser.add_argument(
            "--output",
            type=str,
            default="",
            help="Optional file path to write issued codes for distribution (never commit this file).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        force = options["force"]
        output_path = options["output"]

        self.stdout.write("Checking and preparing teacher accounts...")

        # 1. Resolve reported case: HISTORY / his221
        history_user = (
            User.objects.filter(username__iexact="HISTORY").first()
            or User.objects.filter(username__iexact="his221").first()
        )
        if history_user:
            if history_user.role != User.Role.TEACHER:
                history_user.role = User.Role.TEACHER
            history_user.is_active = True
            history_user.save(update_fields=["role", "is_active"])
            h_profile, _ = TeacherProfile.objects.get_or_create(user=history_user)
            if h_profile.is_archived:
                h_profile.is_archived = False
                h_profile.save(update_fields=["is_archived"])

            # Ensure subject exists
            history_subject = (
                Subject.objects.filter(name__iexact="History").first()
                or Subject.objects.filter(code__iexact="HIS221").first()
                or Subject.objects.filter(code__iexact="his221").first()
            )
            if not history_subject:
                history_subject = Subject.objects.create(name="History", code="HIS221", number_of_papers=1)

            # Ensure teaching assignment exists
            assignment = TeachingAssignment.objects.filter(
                teacher=history_user, subject=history_subject
            ).first()
            if not assignment:
                sclass, _ = SchoolClass.objects.get_or_create(name="Senior 1", defaults={"order": 1})
                stream, _ = Stream.objects.get_or_create(school_class=sclass, name="Stream A")
                TeachingAssignment.objects.create(
                    teacher=history_user,
                    stream=stream,
                    subject=history_subject,
                    paper_number=1,
                    teacher_subject_code="his221",
                )
                self.stdout.write(self.style.SUCCESS("Created teaching assignment for HISTORY (his221)."))

        # 2. Confirm all teacher accounts are active, role TEACHER, not archived
        teacher_qs = User.objects.filter(role=User.Role.TEACHER) | User.objects.filter(teacher_profile__isnull=False)
        teacher_users = list(teacher_qs.distinct())
        for u in teacher_users:
            if u.role != User.Role.TEACHER:
                u.role = User.Role.TEACHER
            if not u.is_active:
                u.is_active = True
            u.save(update_fields=["role", "is_active"])

            prof, _ = TeacherProfile.objects.get_or_create(user=u)
            if prof.is_archived:
                prof.is_archived = False
                prof.save(update_fields=["is_archived"])

        # 3. Issue codes for teachers needing one
        issued = []
        already_had = 0
        active_teachers = (
            TeacherProfile.objects.filter(user__is_active=True, is_archived=False)
            .select_related("user")
            .order_by("user__username")
        )

        for profile in active_teachers:
            if profile.signin_code_hash and not force:
                already_had += 1
                continue

            code = generate_unique_teacher_code()
            profile.set_signin_code(code)
            profile.save(update_fields=["signin_code_hash", "signin_code_issued_at"])
            issued.append({
                "username": profile.user.username,
                "name": profile.user.full_name or profile.user.username,
                "email": profile.user.email or "",
                "code": code,
            })

        # 4. Display results
        if issued:
            header = f"{'Username':<20} | {'Full Name':<25} | {'Email':<25} | {'Issued Code':<12}"
            separator = "-" * len(header)
            lines = [header, separator]
            for row in issued:
                lines.append(f"{row['username']:<20} | {row['name']:<25} | {row['email']:<25} | {row['code']:<12}")

            output_text = "\n".join(lines)
            self.stdout.write(self.style.SUCCESS("\n" + output_text + "\n"))

            if output_path:
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(output_text + "\n")
                self.stdout.write(self.style.SUCCESS(f"Saved issued codes to: {output_path}"))

            self.stdout.write(
                self.style.SUCCESS(
                    f"Successfully issued codes for {len(issued)} teacher(s). "
                    f"({already_had} teacher(s) already had codes)."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"All {already_had} teacher(s) already have sign-in codes. None were changed. "
                    "(Use --force to regenerate codes)."
                )
            )

