import getpass
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.users.models import User


class Command(BaseCommand):
    help = "Create or recover an ADMIN superuser on the Render production PostgreSQL database."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--email", default=None)
        parser.add_argument("--confirm-production", action="store_true")

    def handle(self, *args, **options):
        database = settings.DATABASES["default"]
        if not options["confirm_production"]:
            raise CommandError("Pass --confirm-production to confirm this production operation.")
        if settings.DEBUG or settings.ENVIRONMENT.lower() != "production" or not os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
            raise CommandError("Set DJANGO_DEBUG=False and DJANGO_ENVIRONMENT=production.")
        if database["ENGINE"] != "django.db.backends.postgresql":
            raise CommandError("Refusing to run: the configured database is not PostgreSQL.")
        if not database.get("HOST", "").lower().endswith(".render.com") or database.get("NAME") != "school_db":
            raise CommandError("Refusing to run: configure the Render external URL for the school_db database.")

        username = options["username"].strip()
        if not username:
            raise CommandError("Username cannot be blank.")
        user = User.objects.filter(username=username).first()
        if user is None and User.objects.filter(username__iexact=username).exists():
            raise CommandError("A username differing only by letter case already exists.")
        if user and user.role != User.Role.ADMIN:
            raise CommandError("Refusing to take over an existing non-admin account.")
        if user and not user.is_active and (
            not user.admin_deactivated_at
            or not timezone.now() - timedelta(days=30) <= user.admin_deactivated_at <= timezone.now()
        ):
            raise CommandError("This administrator was not deactivated within the past 30 days.")

        password = getpass.getpass("New admin password: ")
        if not password or password != getpass.getpass("Confirm new admin password: "):
            raise CommandError("Passwords are blank or do not match.")
        if user is None:
            user = User(username=username)
        try:
            password_validation.validate_password(password, user=user)
        except ValidationError as error:
            raise CommandError("Password does not meet the configured password policy.") from error

        with transaction.atomic():
            user.role = User.Role.ADMIN
            user.is_active = True
            user.is_staff = True
            user.is_superuser = True
            if options["email"] is not None:
                user.email = options["email"]
            user.set_password(password)
            user.save()

        self.stdout.write(self.style.SUCCESS(f"Production administrator '{username}' is active and recovered."))
