import os

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand

from apps.users.models import User


class Command(BaseCommand):
    help = ("Create the first ADMIN / DEVELOPER account from environment variables (for hosts without a shell, e.g. free Render). "
            "Variables: BOOTSTRAP_ADMIN_USERNAME/EMAIL/PASSWORD and BOOTSTRAP_DEVELOPER_USERNAME/EMAIL/PASSWORD. "
            "Existing usernames are never touched. Remove the variables after the first successful start.")

    def handle(self, *a, **o):
        for role in ("ADMIN", "DEVELOPER"):
            username = os.environ.get(f"BOOTSTRAP_{role}_USERNAME", "").strip()
            password = os.environ.get(f"BOOTSTRAP_{role}_PASSWORD", "")
            if not username or not password:
                continue
            if User.objects.filter(username=username).exists():
                self.stdout.write(f"{role} '{username}' already exists - skipped.")
                continue
            try:
                password_validation.validate_password(password)
            except ValidationError as e:
                self.stderr.write(f"{role} not created: {' '.join(e.messages)}")
                continue
            user = User(username=username, email=os.environ.get(f"BOOTSTRAP_{role}_EMAIL", ""), role=role)
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f"Created {role} '{username}'. Remove BOOTSTRAP_{role}_* from your environment now."))
