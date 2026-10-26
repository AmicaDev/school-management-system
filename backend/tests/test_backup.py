import json
import os
import tempfile
from django.conf import settings
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.users.models import User


class BackupAndRestorationTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.dev_user = User.objects.create_user(
            username="testdev", password="password123", role="DEVELOPER", is_staff=True
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.dev_user)

    def tearDown(self):
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_backup_and_dry_run_restoration_cycle(self):
        with override_settings(MEDIA_ROOT=self.temp_dir):
            # 1. Create backup
            backup_path = os.path.join(self.temp_dir, "backups", "test_backup.json.gz")
            call_command("dbbackup", output=backup_path, verbosity=0)
            self.assertTrue(os.path.exists(backup_path))

            # 2. Run dbrestore with dry_run
            call_command("dbrestore", input=backup_path, dry_run=True, verbosity=0)

            # 3. Check audit log
            log = AuditLog.objects.filter(action="RESTORE_TEST", result="SUCCESS").first()
            self.assertIsNotNone(log)
            self.assertEqual(log.module, "developer")

    def test_backup_verify_endpoint(self):
        with override_settings(MEDIA_ROOT=self.temp_dir):
            # Create a backup first
            backup_path = os.path.join(self.temp_dir, "backups", "db_backup_20261026.json.gz")
            call_command("dbbackup", output=backup_path, verbosity=0)

            res = self.client.post("/api/v1/developer/backup/verify/", {"filename": "db_backup_20261026.json.gz"})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data["status"], "PASSED")
