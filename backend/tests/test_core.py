from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch
from urllib.parse import urlparse

from django.conf import settings
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.academics.models import (AcademicYear, ExamType, GradeBand, SchoolClass, Stream, Subject, TeachingAssignment, Term)
from apps.attendance.models import AttendanceRecord
from apps.audit.models import AuditLog
from apps.people.models import Student, TeacherProfile
from apps.results.models import Assessment
from apps.results.services import grade_for, term_summary
from apps.users.models import User

PW = "Str0ng-Test-Pass!9"


class ProductionAdminDatabaseGuardTests(SimpleTestCase):
    @override_settings(
        DEBUG=False,
        ENVIRONMENT="development",
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "render_production_database",
            "HOST": "dpg-production-a",
        }},
    )
    @patch.dict("os.environ", {
        "RENDER_EXTERNAL_HOSTNAME": "school-api.onrender.com",
        "RENDER_SERVICE_ID": "",
    })
    @patch("apps.users.views.connection.vendor", "postgresql")
    def test_allows_render_database_with_service_assigned_database_name(self):
        from apps.users.views import DeveloperAdminAccountViewSet

        DeveloperAdminAccountViewSet._assert_render_production_database()

    @override_settings(
        DEBUG=False,
        ENVIRONMENT="production",
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "school_db",
            "HOST": "dpg-production-a.oregon-postgres.render.com",
        }},
    )
    @patch.dict("os.environ", {
        "RENDER_EXTERNAL_HOSTNAME": "school-api.onrender.com",
        "RENDER_SERVICE_ID": "",
    })
    @patch("apps.users.views.connection.vendor", "postgresql")
    def test_allows_render_external_school_database(self):
        from apps.users.views import DeveloperAdminAccountViewSet

        DeveloperAdminAccountViewSet._assert_render_production_database()

    @override_settings(
        DEBUG=False,
        ENVIRONMENT="production",
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "school_db",
            "HOST": "db.example.com",
        }},
    )
    @patch.dict("os.environ", {
        "RENDER_EXTERNAL_HOSTNAME": "school-api.onrender.com",
        "RENDER_SERVICE_ID": "",
    })
    @patch("apps.users.views.connection.vendor", "postgresql")
    def test_rejects_non_render_database(self):
        from rest_framework.exceptions import ValidationError

        from apps.users.views import DeveloperAdminAccountViewSet

        with self.assertRaisesMessage(ValidationError, "production Render service"):
            DeveloperAdminAccountViewSet._assert_render_production_database()

    @override_settings(
        DEBUG=True,
        ENVIRONMENT="development",
        DATABASES={"default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "school_db",
            "HOST": "dpg-production-a",
        }},
    )
    @patch.dict("os.environ", {
        "RENDER_EXTERNAL_HOSTNAME": "school-api.onrender.com",
        "RENDER_SERVICE_ID": "",
    })
    @patch("apps.users.views.connection.vendor", "postgresql")
    def test_rejects_render_database_when_debug_is_enabled(self):
        from rest_framework.exceptions import ValidationError

        from apps.users.views import DeveloperAdminAccountViewSet

        with self.assertRaisesMessage(ValidationError, "production Render service"):
            DeveloperAdminAccountViewSet._assert_render_production_database()


def mk(username, role, **kw):
    u = User(username=username, role=role, **kw)
    u.set_password(PW)
    u.save()
    return u


class Base(APITestCase):
    def setUp(self):
        self.admin, self.dev = mk("adm", "ADMIN"), mk("dev", "DEVELOPER")
        self.t1, self.t2 = mk("t1", "TEACHER"), mk("t2", "TEACHER")
        self.p1, self.p2 = mk("p1", "PARENT"), mk("p2", "PARENT")
        y = AcademicYear.objects.create(name="2026", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_active=True)
        self.term = Term.objects.create(year=y, name="Term 1", start_date=date(2026, 1, 1), end_date=date(2026, 4, 1), is_active=True)
        self.stream = Stream.objects.create(school_class=SchoolClass.objects.create(name="P1"), name="A", class_teacher=self.t1)
        self.maths = Subject.objects.create(name="Maths", code="math")
        TeachingAssignment.objects.create(teacher=self.t1, stream=self.stream, subject=self.maths)
        self.s1 = Student.objects.create(index_no="S1", first_name="A", last_name="One", gender="M", stream=self.stream)
        self.s2 = Student.objects.create(index_no="S2", first_name="B", last_name="Two", gender="F", stream=self.stream)
        self.s1.parents.add(self.p1)
        self.s2.parents.add(self.p2)
        for mn, mx, g in [(90, 100, "A"), (80, 89.99, "B"), (0, 79.99, "C")]:
            GradeBand.objects.create(minimum=mn, maximum=mx, grade=g)
        self.et = ExamType.objects.create(name="Mid", code="MID", weight=100)

    def login(self, username):
        r = self.client.post("/api/v1/auth/login/", {"username": username, "password": PW}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        return r


class AuthTests(Base):
    def test_frontend_host_is_allowed_for_proxied_login(self):
        frontend_host = urlparse(settings.FRONTEND_URL).hostname
        self.assertIsNotNone(frontend_host)
        self.assertIn(frontend_host, settings.ALLOWED_HOSTS)

        response = self.client.post(
            "/api/v1/auth/login/",
            {"username": "invalid-diagnostic", "password": "invalid-diagnostic"},
            format="json",
            HTTP_HOST=frontend_host,
            secure=True,
        )
        self.assertEqual(response.status_code, 401, response.content)

    def test_login_returns_jwt_and_role(self):
        r = self.login("adm")
        self.assertEqual(r.data["user"]["role"], "ADMIN")
        self.assertIn("refresh", r.data)

    def test_bad_login(self):
        r = self.client.post("/api/v1/auth/login/", {"username": "adm", "password": "x"}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_admin_django_admin_url_is_registered(self):
        response = self.client.get("/django-admin/login/")
        self.assertEqual(response.status_code, 200)

    def test_parent_logs_in_with_student_index_no(self):
        r = self.client.post("/api/v1/auth/login/", {"username": "S1", "password": PW}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["username"], "p1")

    def test_teacher_logs_in_with_assigned_subject_and_paper_code(self):
        TeachingAssignment.objects.filter(teacher=self.t1, subject=self.maths).update(teacher_subject_code="P221")
        r = self.client.post("/api/v1/auth/login/", {"username": "Maths", "password": "P221"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["user"]["username"], "t1")

    def test_teacher_subject_login_requires_matching_assigned_code(self):
        TeachingAssignment.objects.filter(teacher=self.t1, subject=self.maths).update(teacher_subject_code="P221")
        r = self.client.post("/api/v1/auth/login/", {"username": "Maths", "password": "wrong"}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_password_is_hashed(self):
        self.assertNotEqual(self.admin.password, PW)
        self.assertTrue(self.admin.password.startswith("pbkdf2_"))

    def test_parent_can_update_profile_location(self):
        self.client.force_authenticate(user=self.p1)
        r = self.client.patch("/api/v1/auth/me/", {"address": "Kampala, Uganda"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["address"], "Kampala, Uganda")
        self.assertIn("photo", r.data)


class DeveloperAdminAccountTests(Base):
    endpoint = "/api/v1/developer/admin-accounts/"

    def setUp(self):
        super().setUp()
        self.production_database_guard = patch(
            "apps.users.views.DeveloperAdminAccountViewSet._assert_render_production_database"
        )
        self.production_database_guard.start()
        self.addCleanup(self.production_database_guard.stop)

    def login_developer(self):
        self.client.force_authenticate(user=self.dev)

    def create_admin(self, username="new-school-admin"):
        return self.client.post(self.endpoint, {
            "username": username, "email": f"{username}@example.test", "password": PW,
        }, format="json")

    def test_only_active_developer_can_manage_administrators(self):
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get(self.endpoint).status_code, 403)
        self.client.force_authenticate(user=self.p1)
        self.assertEqual(self.client.post(self.endpoint, {}, format="json").status_code, 403)
        self.dev.is_active = False
        self.dev.save(update_fields=["is_active"])
        self.client.force_authenticate(user=self.dev)
        self.assertEqual(self.client.get(self.endpoint).status_code, 403)

    def test_rejects_local_database_even_for_authenticated_developer(self):
        self.login_developer()
        self.production_database_guard.stop()
        response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 400)
        self.assertIn("production Render service", str(response.data))

    def test_developer_can_create_list_deactivate_and_recover_admin(self):
        self.login_developer()
        created = self.create_admin()
        self.assertEqual(created.status_code, 201, created.content)
        self.assertNotIn("password", created.data)
        admin = User.objects.get(username="new-school-admin")
        self.assertEqual(admin.role, User.Role.ADMIN)
        self.assertTrue(admin.is_active)
        self.assertFalse(admin.is_staff)
        self.assertFalse(admin.is_superuser)
        self.assertTrue(admin.check_password(PW))

        admin.first_name = "Existing"
        admin.save(update_fields=["first_name"])
        listed = self.client.get(self.endpoint)
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(any(row["id"] == admin.id for row in listed.data["results"]))

        deactivated = self.client.post(f"{self.endpoint}{admin.id}/deactivate/", {}, format="json")
        self.assertEqual(deactivated.status_code, 200, deactivated.content)
        admin.refresh_from_db()
        self.assertFalse(admin.is_active)
        self.assertIsNotNone(admin.admin_deactivated_at)
        activated = self.client.post(f"{self.endpoint}{admin.id}/recover/", {}, format="json")
        self.assertEqual(activated.status_code, 200, activated.content)
        admin.refresh_from_db()
        self.assertTrue(admin.is_active)
        self.assertIsNone(admin.admin_deactivated_at)
        self.assertEqual(admin.first_name, "Existing")
        self.assertTrue(admin.check_password(PW))
        self.assertEqual(
            AuditLog.objects.filter(module="developer", action__in=[
                "LIST_ADMIN_ACCOUNTS", "CREATE_ADMIN_ACCOUNT", "DEACTIVATE_ADMIN_ACCOUNT", "RECOVER_ADMIN_ACCOUNT",
            ]).count(),
            4,
        )

    def test_admin_password_is_validated_and_last_active_admin_is_protected(self):
        self.login_developer()
        invalid = self.client.post(self.endpoint, {
            "username": "new-school-admin", "email": "admin@example.test", "password": "short",
        }, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(User.objects.filter(username="new-school-admin").exists())
        response = self.client.post(f"{self.endpoint}{self.admin.id}/deactivate/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_recovery_refuses_expired_or_deleted_accounts(self):
        self.login_developer()
        expired = mk("expired-admin", "ADMIN")
        expired.is_active = False
        expired.admin_deactivated_at = timezone.now() - timedelta(days=31)
        expired.save(update_fields=["is_active", "admin_deactivated_at"])
        response = self.client.post(f"{self.endpoint}{expired.id}/recover/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        expired.refresh_from_db()
        self.assertFalse(expired.is_active)

        deleted = mk("deleted-admin", "ADMIN")
        deleted_id = deleted.id
        deleted.delete()
        response = self.client.post(f"{self.endpoint}{deleted_id}/recover/", {}, format="json")
        self.assertEqual(response.status_code, 404)


class PermissionTests(Base):
    def test_unauthenticated_blocked(self):
        self.assertEqual(self.client.get("/api/v1/students/").status_code, 401)

    def test_developer_console_restricted(self):
        for u in ("adm", "t1", "p1"):
            self.login(u)
            self.assertEqual(self.client.get("/api/v1/developer/health/").status_code, 403, u)
        self.login("dev")
        self.assertEqual(self.client.get("/api/v1/developer/health/").status_code, 200)

    def test_developer_cannot_read_school_data(self):
        self.login("dev")
        self.assertEqual(self.client.get("/api/v1/students/").status_code, 403)

    def test_admin_cannot_create_developer(self):
        self.login("adm")
        r = self.client.post("/api/v1/auth/users/", {"username": "x", "role": "DEVELOPER", "password": PW}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_admin_cannot_deactivate_last_active_admin(self):
        self.login("adm")
        r = self.client.patch(f"/api/v1/auth/users/{self.admin.id}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)
        r = self.client.delete(f"/api/v1/auth/users/{self.admin.id}/")
        self.assertEqual(r.status_code, 400, r.content)
        r = self.client.patch(f"/api/v1/auth/users/{self.admin.id}/", {"role": "PARENT"}, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_admin_can_deactivate_one_of_multiple_active_admins(self):
        other_admin = mk("adm2", "ADMIN")
        self.login("adm")
        r = self.client.patch(f"/api/v1/auth/users/{self.admin.id}/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        other_admin.refresh_from_db()
        self.assertTrue(other_admin.is_active)

    def test_teacher_cannot_write_config(self):
        self.login("t1")
        self.assertEqual(self.client.post("/api/v1/academics/subjects/", {"name": "X", "code": "X"}, format="json").status_code, 403)

    def test_parent_isolation(self):
        self.login("p1")
        ids = [s["id"] for s in self.client.get("/api/v1/students/").data["results"]]
        self.assertEqual(ids, [self.s1.id])
        self.assertEqual(self.client.get(f"/api/v1/students/{self.s2.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/results/summary/{self.s2.id}/{self.term.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/reports/report-card/{self.s2.id}/{self.term.id}/").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/parents/").status_code, 403)


class StudentTests(Base):
    def test_admin_crud_and_archive(self):
        self.login("adm")
        r = self.client.post("/api/v1/students/", {"first_name": "N", "last_name": "Pupil", "gender": "F", "stream": self.stream.id,
                                                  "index_no": "S3", "parent_ids": [self.p1.id]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Student.objects.get(pk=r.data["id"]).index_no, r.data["index_no"])
        self.assertTrue(r.data["index_no"])
        sid = r.data["id"]
        self.assertEqual(self.client.patch(f"/api/v1/students/{sid}/", {"last_name": "Changed"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/v1/students/{sid}/").status_code, 204)
        self.assertTrue(Student.objects.get(pk=sid).is_archived)  # soft delete
        self.assertEqual(self.client.get("/api/v1/students/").data["count"], 2)
        archived = self.client.get("/api/v1/students/?is_archived=true")
        self.assertEqual(archived.data["count"], 1)
        self.assertEqual(self.client.post(f"/api/v1/students/{sid}/restore/").status_code, 200)
        self.assertFalse(Student.objects.get(pk=sid).is_archived)
        self.client.delete(f"/api/v1/students/{sid}/")
        self.assertEqual(self.client.delete(f"/api/v1/students/{sid}/permanent-delete/").status_code, 204)
        self.assertFalse(Student.objects.filter(pk=sid).exists())

    def test_admin_must_assign_index_number(self):
        self.login("adm")
        r = self.client.post("/api/v1/students/", {"first_name": "N", "last_name": "Pupil", "gender": "F"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("index_no", r.data)

    def test_teacher_crud(self):
        self.login("adm")
        r = self.client.post("/api/v1/teachers/", {"username": "newt", "first_name": "N", "last_name": "T", "gender": "M",
                                                  "password": PW}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(User.objects.get(username="newt").check_password(PW))


class RecycleBinTests(Base):
    def test_parent_archive_restore_and_permanent_delete(self):
        self.login("adm")
        self.assertEqual(self.client.delete(f"/api/v1/parents/{self.p1.id}/").status_code, 204)
        parent = User.objects.get(pk=self.p1.id)
        self.assertTrue(parent.is_archived)
        self.assertFalse(parent.is_active)
        self.assertEqual(self.client.get("/api/v1/parents/").data["count"], 1)
        self.assertEqual(self.client.get("/api/v1/parents/?is_archived=true").data["count"], 1)
        self.assertEqual(self.client.post(f"/api/v1/parents/{parent.id}/restore/").status_code, 200)
        parent.refresh_from_db()
        self.assertFalse(parent.is_archived)
        self.assertTrue(parent.is_active)
        self.client.delete(f"/api/v1/parents/{parent.id}/")
        self.assertEqual(self.client.delete(f"/api/v1/parents/{parent.id}/permanent-delete/").status_code, 204)
        self.assertFalse(User.objects.filter(pk=parent.id).exists())

    def test_teacher_and_subject_archive_restore_and_permanent_delete(self):
        self.login("adm")
        profile = TeacherProfile.objects.create(user=self.t2, gender="M")
        self.assertEqual(self.client.delete(f"/api/v1/teachers/{profile.id}/").status_code, 204)
        self.assertEqual(self.client.get("/api/v1/teachers/").data["count"], 0)
        self.assertEqual(self.client.get("/api/v1/teachers/?is_archived=true").data["count"], 1)
        self.assertEqual(self.client.post(f"/api/v1/teachers/{profile.id}/restore/").status_code, 200)
        profile.refresh_from_db()
        profile.user.refresh_from_db()
        self.assertFalse(profile.is_archived)
        self.assertTrue(profile.user.is_active)
        self.client.delete(f"/api/v1/teachers/{profile.id}/")
        self.assertEqual(self.client.delete(f"/api/v1/teachers/{profile.id}/permanent-delete/").status_code, 204)
        self.assertFalse(TeacherProfile.objects.filter(pk=profile.id).exists())

        subject = Subject.objects.create(name="History", code="HIST")
        self.assertEqual(self.client.delete(f"/api/v1/academics/subjects/{subject.id}/").status_code, 204)
        self.assertFalse(any(item["id"] == subject.id for item in self.client.get("/api/v1/academics/subjects/").data))
        self.assertEqual(len(self.client.get("/api/v1/academics/subjects/?is_archived=true").data), 1)
        self.assertEqual(self.client.post(f"/api/v1/academics/subjects/{subject.id}/restore/").status_code, 200)
        subject.refresh_from_db()
        self.assertFalse(subject.is_archived)
        self.client.delete(f"/api/v1/academics/subjects/{subject.id}/")
        self.assertEqual(self.client.delete(f"/api/v1/academics/subjects/{subject.id}/permanent-delete/").status_code, 204)
        self.assertFalse(Subject.objects.filter(pk=subject.id).exists())

    def test_only_admin_can_permanently_delete_archived_records(self):
        self.login("adm")
        self.client.delete(f"/api/v1/students/{self.s1.id}/")
        self.login("t1")
        self.assertEqual(self.client.delete(f"/api/v1/students/{self.s1.id}/permanent-delete/").status_code, 403)

class StudentBehaviorTests(Base):
    def test_teacher_sees_only_assigned_students(self):
        self.client.force_authenticate(user=self.t2)
        self.assertEqual(self.client.get("/api/v1/students/").data["count"], 0)
        self.client.force_authenticate(user=self.t1)
        self.assertEqual(self.client.get("/api/v1/students/").data["count"], 2)

    def test_candidate_number_is_optional_and_unique(self):
        self.login("adm")
        data = {"first_name": "Candidate", "last_name": "Four", "gender": "F", "stream": self.stream.id,
                "index_no": "CAND04", "candidate_no": "U12345"}
        created = self.client.post("/api/v1/students/", data, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(created.data["index_no"])
        self.assertEqual(created.data["candidate_no"], "U12345")
        data.update(first_name="Another", index_no="S-SECOND")
        self.assertEqual(self.client.post("/api/v1/students/", data, format="json").status_code, 400)

    def test_teacher_registration_can_assign_class_teacher_streams(self):
        self.login("adm")
        r = self.client.post("/api/v1/teachers/", {
            "username": "new-class-teacher", "first_name": "New", "last_name": "Teacher", "gender": "F",
            "password": PW, "class_stream_ids": [self.stream.id], "nationality": "Ugandan",
            "marital_status": "SINGLE", "languages": ["English", "Luganda"],
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["class_stream_ids"], [self.stream.id])
        self.assertEqual(Stream.objects.get(pk=self.stream.id).class_teacher.username, "new-class-teacher")

    def test_subject_paper_teacher_assignment(self):
        self.login("adm")
        self.maths.number_of_papers = 2
        self.maths.save()
        r = self.client.post("/api/v1/academics/assignments/", {
            "teacher": self.t2.id, "stream": self.stream.id, "subject": self.maths.id, "paper_number": 2,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        duplicate = self.client.post("/api/v1/academics/assignments/", {
            "teacher": self.t2.id, "stream": self.stream.id, "subject": self.maths.id, "paper_number": 1,
        }, format="json")
        self.assertEqual(duplicate.status_code, 400)
        invalid = self.client.post("/api/v1/academics/assignments/", {
            "teacher": self.t2.id, "stream": self.stream.id, "subject": self.maths.id, "paper_number": 3,
        }, format="json")
        self.assertEqual(invalid.status_code, 400)
        payload = {"client_txn_id": "paper-authorization", "stream": self.stream.id, "subject": self.maths.id,
                   "term": self.term.id, "exam_type": self.et.id, "max_score": 100,
                   "entries": [{"student": self.s1.id, "score": 75}]}
        self.login("t2")
        self.assertEqual(self.client.post("/api/v1/results/assessments/bulk/", payload, format="json").status_code, 403)
        payload.update(client_txn_id="paper-two-result", paper_number=2)
        saved = self.client.post("/api/v1/results/assessments/bulk/", payload, format="json")
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(Assessment.objects.get(entered_by=self.t2).paper_number, 2)
        payload.update(client_txn_id="paper-one-result", paper_number=1, entries=[{"student": self.s1.id, "score": 25}])
        self.login("t1")
        self.assertEqual(self.client.post("/api/v1/results/assessments/bulk/", payload, format="json").status_code, 200)
        grid = self.client.get("/api/v1/results/grid/", {
            "stream": self.stream.id, "subject": self.maths.id, "term": self.term.id, "paper_number": 1,
        })
        self.assertEqual(grid.status_code, 200, grid.content)
        self.assertEqual(grid.data["rows"][0]["cells"]["MID"]["score"], Decimal("25"))
        self.assertEqual(self.client.get("/api/v1/results/grid/", {
            "stream": self.stream.id, "subject": self.maths.id, "term": self.term.id, "paper_number": 2,
        }).status_code, 403)
        summary = term_summary(self.s1, self.term)
        self.assertEqual(summary["subjects"][0]["components"]["MID"], Decimal("50.00"))


class AttendanceTests(Base):
    def payload(self, txn, status="PRESENT"):
        return {"client_txn_id": txn, "stream": self.stream.id, "date": "2026-02-02",
                "records": [{"student": self.s1.id, "status": status}, {"student": self.s2.id, "status": "ABSENT"}]}

    def test_bulk_save_and_edit_without_duplicates(self):
        self.login("t1")
        self.assertEqual(self.client.post("/api/v1/attendance/bulk/", self.payload("a1"), format="json").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/attendance/bulk/", self.payload("a2", "LATE"), format="json").status_code, 200)
        self.assertEqual(AttendanceRecord.objects.count(), 2)
        self.assertEqual(AttendanceRecord.objects.get(student=self.s1).status, "LATE")

    def test_same_txn_id_is_idempotent(self):
        self.login("t1")
        self.client.post("/api/v1/attendance/bulk/", self.payload("same"), format="json")
        r = self.client.post("/api/v1/attendance/bulk/", self.payload("same", "ABSENT"), format="json")
        self.assertTrue(r.data.get("duplicate"))
        self.assertEqual(AttendanceRecord.objects.get(student=self.s1).status, "PRESENT")

    def test_db_rejects_duplicate_row(self):
        AttendanceRecord.objects.create(student=self.s1, stream=self.stream, date=date(2026, 2, 3), status="PRESENT")
        with self.assertRaises(IntegrityError), transaction.atomic():
            AttendanceRecord.objects.create(student=self.s1, stream=self.stream, date=date(2026, 2, 3), status="ABSENT")

    def test_unassigned_teacher_forbidden(self):
        self.login("t2")
        self.assertEqual(self.client.post("/api/v1/attendance/bulk/", self.payload("z"), format="json").status_code, 403)


class ResultsTests(Base):
    def marks(self, txn, score, mx=100):
        return {"client_txn_id": txn, "stream": self.stream.id, "subject": self.maths.id, "term": self.term.id,
                "exam_type": self.et.id, "max_score": mx, "entries": [{"student": self.s1.id, "score": score}]}

    def test_marks_and_server_side_grade(self):
        self.login("t1")
        self.assertEqual(self.client.post("/api/v1/results/assessments/bulk/", self.marks("m1", 92), format="json").status_code, 200)
        s = term_summary(self.s1, self.term)
        self.assertEqual(s["subjects"][0]["grade"], "A")
        self.assertEqual(s["average"], Decimal("92.00"))

    def test_score_above_max_rejected(self):
        self.login("t1")
        r = self.client.post("/api/v1/results/assessments/bulk/", self.marks("m2", 25, 20), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Assessment.objects.count(), 0)

    def test_assignment_out_of_20(self):
        self.login("t1")
        self.client.post("/api/v1/results/assessments/bulk/", self.marks("m3", 15, 20), format="json")
        self.assertEqual(Assessment.objects.get().percent, Decimal("75"))

    def test_other_teacher_cannot_enter_marks(self):
        self.login("t2")
        self.assertEqual(self.client.post("/api/v1/results/assessments/bulk/", self.marks("m4", 50), format="json").status_code, 403)

    def test_grading_is_configurable(self):
        self.assertEqual(grade_for(Decimal("85"))[0], "B")
        GradeBand.objects.all().delete()
        GradeBand.objects.create(minimum=0, maximum=100, grade="P", remark="Pass")
        self.assertEqual(grade_for(Decimal("85"))[0], "P")

    def test_report_card_pdf_for_parent(self):
        self.login("t1")
        self.client.post("/api/v1/results/assessments/bulk/", self.marks("m5", 80), format="json")
        self.login("p1")
        r = self.client.get(f"/api/v1/reports/report-card/{self.s1.id}/{self.term.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(b"".join(r.streaming_content)[:4], b"%PDF")


class CommsTests(Base):
    def test_enquiry_flow_and_notifications(self):
        self.login("p1")
        r = self.client.post("/api/v1/enquiries/", {"subject": "Fees query", "body": "Hello", "client_txn_id": "e1"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        eid = r.data["id"]
        self.assertTrue(self.client.post("/api/v1/enquiries/", {"subject": "Fees query", "body": "Hello", "client_txn_id": "e1"},
                                         format="json").data.get("duplicate"))
        self.login("p2")
        self.assertEqual(self.client.get(f"/api/v1/enquiries/{eid}/").status_code, 404)
        self.login("adm")
        self.assertEqual(self.client.post(f"/api/v1/enquiries/{eid}/reply/", {"body": "Thanks"}, format="json").status_code, 200)
        self.login("p1")
        self.assertEqual(self.client.get("/api/v1/notifications/unread_count/").data["count"], 1)

    def test_sensitive_data_scrubbed_from_error_log(self):
        from apps.audit.services import scrub
        out = scrub("password=hunter2 token: abc eyJhbGciOi.eyJzdWIi.sig postgres://u:secretpw@db/x")
        for bad in ("hunter2", "secretpw", "eyJhbGciOi"):
            self.assertNotIn(bad, out)

    def test_parent_teacher_chat_archive_and_shared_message_delete(self):
        self.client.force_authenticate(user=self.p1)
        created = self.client.post("/api/v1/enquiries/", {
            "subject": "Class question", "body": "Please call me", "student": self.s1.id, "client_txn_id": "linked-chat",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        enquiry_id = created.data["id"]
        message_id = created.data["messages"][0]["id"]
        self.assertEqual(created.data["student_name"], self.s1.full_name)
        self.client.force_authenticate(user=self.p1)
        self.assertEqual(self.client.post(f"/api/v1/enquiries/{enquiry_id}/typing/", {"typing": True},
                                          format="json").status_code, 200)
        self.client.force_authenticate(user=self.admin)
        typing = self.client.get(f"/api/v1/enquiries/{enquiry_id}/typing/")
        self.assertEqual(typing.status_code, 200)
        self.assertEqual(typing.data[0]["id"], self.p1.id)
        self.client.force_authenticate(user=self.t1)
        self.assertEqual(self.client.get("/api/v1/enquiries/").data["count"], 1)
        self.assertEqual(self.client.post(f"/api/v1/enquiries/{enquiry_id}/reply/", {"body": "I will follow up."},
                                          format="json").status_code, 200)
        self.client.force_authenticate(user=self.t2)
        self.assertEqual(self.client.get("/api/v1/enquiries/").data["count"], 0)
        self.client.force_authenticate(user=self.p1)
        self.assertEqual(self.client.post(f"/api/v1/enquiries/{enquiry_id}/archive/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/enquiries/").data["count"], 0)
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get("/api/v1/enquiries/").data["count"], 1)
        self.client.force_authenticate(user=self.p1)
        deleted = self.client.post(f"/api/v1/enquiries/{enquiry_id}/delete_messages/",
                                   {"message_ids": [message_id]}, format="json")
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertEqual(deleted.data["deleted"], 1)
        self.client.force_authenticate(user=self.admin)
        remaining = self.client.get(f"/api/v1/enquiries/{enquiry_id}/").data["messages"]
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["sender_name"], "t1")
