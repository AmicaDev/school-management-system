import io
import zipfile

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.people.models import Student, TeacherProfile
from apps.users.models import User

from .test_core import PW, Base


class ImportTests(Base):
    def upload(self, kind, name, content, dry="true"):
        f = SimpleUploadedFile(name, content)
        return self.client.post(f"/api/v1/{kind}/import/", {"file": f, "dry_run": dry}, format="multipart")

    def test_student_csv_validate_then_import(self):
        self.login("adm")
        csv_bytes = ("first_name,last_name,gender,date_of_birth,class,stream,index_no\n"
                     "Ann,New,F,2015-03-02,P1,A,ANN01\nBad,Row,X,,,,BAD02\nC,Three,M,,,,C003\n").encode()
        r = self.upload("students", "s.csv", csv_bytes)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.data["valid"], len(r.data["invalid"])), (2, 1))
        self.assertEqual(Student.objects.count(), 2)  # dry run wrote nothing
        r = self.upload("students", "s.csv", csv_bytes, dry="false")
        self.assertEqual(r.data["created"], 2)
        self.assertTrue(Student.objects.filter(first_name="Ann", stream=self.stream).exists())
        r = self.upload("students", "s.csv", csv_bytes)
        self.assertEqual(len(r.data["duplicates"]), 2)  # Ann (now exists) + A One

    def test_teacher_xlsx_import_generates_temporary_passwords(self):
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active
        ws.append(["username", "first_name", "last_name", "gender", "password"])
        ws.append(["xt1", "Xi", "Teacher", "F", ""])
        ws.append(["t1", "Dupe", "User", "M", ""])      # username already exists
        buf = io.BytesIO(); wb.save(buf)
        self.login("adm")
        r = self.upload("teachers", "t.xlsx", buf.getvalue(), dry="false")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.data["created"], len(r.data["duplicates"])), (1, 1))
        pwd = r.data["credentials"][0]["temporary_password"]
        u = User.objects.get(username="xt1")
        self.assertTrue(u.check_password(pwd))
        self.assertTrue(TeacherProfile.objects.filter(user=u).exists())

    def test_parent_import_links_children_by_index_number(self):
        self.login("adm")
        r = self.upload("parents", "p.csv", b"username,first_name,last_name,children\nnewp,N,P,S1;S2\n", dry="false")
        self.assertEqual(r.data["created"], 1, r.content)
        self.assertEqual(User.objects.get(username="newp").children.count(), 2)

    def test_non_admin_cannot_import(self):
        self.login("t1")
        self.assertEqual(self.upload("students", "s.csv", b"first_name,last_name,gender\nA,B,M\n").status_code, 403)

    def test_weak_password_is_a_400_not_a_500(self):
        self.login("adm")
        r = self.client.post("/api/v1/teachers/", {"username": "weak", "first_name": "W", "last_name": "T", "gender": "M", "password": "12345678"}, format="json")
        self.assertEqual(r.status_code, 400)


class ReportJobTests(Base):
    def test_class_zip_job_runs_and_downloads(self):
        self.login("t1")  # class teacher of the stream
        r = self.client.post("/api/v1/reports/class-cards/", {"stream": self.stream.id, "term": self.term.id}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        self.assertEqual(r.data["status"], "DONE")
        d = self.client.get(f"/api/v1/reports/class-cards/{r.data['id']}/download/")
        self.assertEqual(d.status_code, 200)
        z = zipfile.ZipFile(io.BytesIO(b"".join(d.streaming_content)))
        self.assertEqual(len(z.namelist()), 2)
        self.login("t2")  # unrelated teacher
        self.assertEqual(self.client.post("/api/v1/reports/class-cards/", {"stream": self.stream.id, "term": self.term.id}, format="json").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v1/reports/class-cards/{r.data['id']}/download/").status_code, 404)

    def test_parents_cannot_start_batch_jobs(self):
        self.login("p1")
        self.assertEqual(self.client.post("/api/v1/reports/class-cards/", {"stream": self.stream.id, "term": self.term.id}, format="json").status_code, 403)


class MaintenanceTests(Base):
    def tearDown(self):
        cache.clear()

    def test_protected_action_needs_password_and_blocks_school_api(self):
        self.login("dev")
        url = "/api/v1/developer/maintenance/"
        self.assertEqual(self.client.post(url, {"action": "toggle_maintenance"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"action": "toggle_maintenance", "confirm": True, "password": "wrong"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(url, {"action": "toggle_maintenance", "confirm": True, "password": PW}, format="json").status_code, 200)
        self.assertTrue(self.client.get("/api/v1/developer/status/").data["maintenance"])
        self.assertEqual(self.client.get("/api/v1/students/").status_code, 503)
        self.assertEqual(self.client.post(url, {"action": "toggle_maintenance", "confirm": True, "password": PW}, format="json").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/developer/status/").data["maintenance"], False)

    def test_retry_failed_jobs_with_none_failed(self):
        self.login("dev")
        r = self.client.post("/api/v1/developer/maintenance/", {"action": "retry_failed_jobs"}, format="json")
        self.assertEqual((r.status_code, r.data["detail"]), (200, "No failed jobs."))

    def test_error_capture_and_resolve(self):
        self.client.post("/api/v1/developer/client-errors/", {"message": "Boom password=hunter2", "source": "react"}, format="json")
        self.login("dev")
        errs = self.client.get("/api/v1/developer/errors/").data["results"]
        self.assertEqual(len(errs), 1)
        self.assertNotIn("hunter2", errs[0]["message"])
        r = self.client.post(f"/api/v1/developer/errors/{errs[0]['id']}/resolve/", {}, format="json")
        self.assertTrue(r.data["resolved"])


class BootstrapTests(Base):
    def test_bootstrap_creates_missing_accounts_only(self):
        import os
        from unittest import mock

        from django.core.management import call_command
        env = {"BOOTSTRAP_ADMIN_USERNAME": "boot-admin", "BOOTSTRAP_ADMIN_PASSWORD": PW, "BOOTSTRAP_ADMIN_EMAIL": "a@b.co",
               "BOOTSTRAP_DEVELOPER_USERNAME": "dev", "BOOTSTRAP_DEVELOPER_PASSWORD": PW}  # 'dev' already exists
        with mock.patch.dict(os.environ, env):
            call_command("bootstrap_users", stdout=io.StringIO())
        self.assertEqual(User.objects.get(username="boot-admin").role, "ADMIN")
        self.assertEqual(User.objects.filter(username="dev").count(), 1)
        with mock.patch.dict(os.environ, {"BOOTSTRAP_ADMIN_USERNAME": "weak", "BOOTSTRAP_ADMIN_PASSWORD": "123"}):
            call_command("bootstrap_users", stdout=io.StringIO(), stderr=io.StringIO())
        self.assertFalse(User.objects.filter(username="weak").exists())
