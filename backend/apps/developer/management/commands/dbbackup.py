import gzip
import json
import os
from datetime import datetime
from io import BytesIO

from django.core import serializers
from django.core.management.base import BaseCommand
from django.conf import settings


class Command(BaseCommand):
    help = "Create a full system data backup (all models) as a gzipped JSON file."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            type=str,
            default="",
            help="Output file path. Defaults to media/backups/db_backup_<timestamp>.json.gz",
        )
        parser.add_argument(
            "--exclude",
            action="append",
            default=[],
            help="App/model to exclude (repeatable, e.g. --exclude contenttypes --exclude auth.Permission).",
        )

    def handle(self, *args, **options):
        output = options["output"]
        excludes = options["exclude"]

        backup_dir = os.path.join(settings.MEDIA_ROOT, "backups")
        os.makedirs(backup_dir, exist_ok=True)

        if not output:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            output = os.path.join(backup_dir, f"db_backup_{ts}.json.gz")

        self.stdout.write("Serialising all models...")
        data = serializers.serialize("json", self._all_models(), use_natural_foreign_keys=True, use_natural_primary_keys=True)

        payload = {
            "schema_version": 1,
            "created_at": datetime.now().isoformat(),
            "app_version": getattr(settings, "APP_VERSION", "1.0.0"),
            "environment": getattr(settings, "ENVIRONMENT", "development"),
            "data": json.loads(data),
        }

        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        with gzip.open(output, "wb") as f:
            f.write(raw)

        size_mb = os.path.getsize(output) / (1024 * 1024)
        self.stdout.write(
            self.style.SUCCESS(f"Backup written to {output} ({size_mb:.2f} MB)")
        )

    def _all_models(self):
        from django.apps import apps
        excluded = set()
        for ex in getattr(self, "_excludes", []):
            excluded.add(ex)
        all_objs = []
        for model in apps.get_models():
            label = f"{model._meta.app_label}.{model._meta.model_name}"
            if label in excluded:
                continue
            all_objs.extend(model.objects.all().iterator())
        return all_objs

