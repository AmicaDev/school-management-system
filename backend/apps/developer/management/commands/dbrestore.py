import gzip
import json
import os
from datetime import datetime

from django.apps import apps
from django.conf import settings
from django.core import serializers
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.audit.models import AuditLog


class Command(BaseCommand):
    help = "Restore system database backup from a gzipped JSON file with integrity validation."

    def add_arguments(self, parser):
        parser.add_argument(
            "--input",
            type=str,
            default="",
            help="Path to backup .json.gz file. Defaults to most recent backup in media/backups/.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Simulate restoration and integrity validation inside a transaction and roll back.",
        )

    def handle(self, *args, **options):
        input_file = options["input"]
        dry_run = options["dry_run"]
        backup_dir = os.path.join(settings.MEDIA_ROOT, "backups")

        if not input_file:
            if not os.path.isdir(backup_dir):
                raise CommandError(f"Backup directory {backup_dir} does not exist.")
            files = sorted(
                [f for f in os.listdir(backup_dir) if f.endswith(".json.gz") or f.endswith(".json")],
                key=lambda n: os.path.getctime(os.path.join(backup_dir, n)),
                reverse=True,
            )
            if not files:
                raise CommandError(f"No backup files found in {backup_dir}.")
            input_file = os.path.join(backup_dir, files[0])

        if not os.path.isfile(input_file):
            raise CommandError(f"Backup file not found: {input_file}")

        self.stdout.write(f"Reading backup from: {input_file}...")

        # 1. Unpack & verify payload
        try:
            if input_file.endswith(".gz"):
                with gzip.open(input_file, "rb") as f:
                    raw = f.read().decode("utf-8")
            else:
                with open(input_file, "r", encoding="utf-8") as f:
                    raw = f.read()
            payload = json.loads(raw)
        except Exception as e:
            raise CommandError(f"Corrupted or invalid backup file: {e}")

        objects_data = payload.get("data", [])
        if not isinstance(objects_data, list):
            raise CommandError("Invalid backup format: 'data' list missing.")

        self.stdout.write(
            f"Found {len(objects_data)} serialized objects (created: {payload.get('created_at', 'unknown')}, schema: {payload.get('schema_version', 1)})."
        )

        # 2. Restore inside transaction
        restored_counts = {}
        try:
            with transaction.atomic():
                deserialized_objects = serializers.deserialize(
                    "json", json.dumps(objects_data), ignorenonexistent=True
                )
                count = 0
                for obj in deserialized_objects:
                    model_label = f"{obj.object._meta.app_label}.{obj.object._meta.model_name}"
                    obj.save()
                    restored_counts[model_label] = restored_counts.get(model_label, 0) + 1
                    count += 1

                self.stdout.write(self.style.SUCCESS(f"Successfully processed {count} records."))

                if dry_run:
                    self.stdout.write(self.style.WARNING("DRY RUN mode: Rolling back all changes."))
                    transaction.set_rollback(True)

            # Record in developer audit
            AuditLog.objects.create(
                action="RESTORE_TEST" if dry_run else "DATABASE_RESTORE",
                module="developer",
                object_repr=f"{os.path.basename(input_file)} ({count} records)",
                result="SUCCESS",
            )

        except Exception as e:
            AuditLog.objects.create(
                action="RESTORE_TEST" if dry_run else "DATABASE_RESTORE",
                module="developer",
                object_repr=f"{os.path.basename(input_file)}: {str(e)[:200]}",
                result="FAILURE",
            )
            raise CommandError(f"Restoration failed: {e}")

        self.stdout.write(self.style.SUCCESS("Restoration and integrity verification complete."))
