import getpass

from django.contrib.auth import password_validation
from django.core.management.base import BaseCommand, CommandError

from apps.users.models import User


class Command(BaseCommand):
    help = "Create the first ADMIN or DEVELOPER account. Password is prompted, never hard-coded."

    def add_arguments(self, parser):
        parser.add_argument("--role", choices=["ADMIN", "DEVELOPER"], required=True)
        parser.add_argument("--username", required=True)
        parser.add_argument("--email", required=True)

    def handle(self, *args, **o):
        if User.objects.filter(username=o["username"]).exists():
            raise CommandError("That username already exists.")
        pwd = getpass.getpass("Password: ")
        if pwd != getpass.getpass("Password (again): "):
            raise CommandError("Passwords do not match.")
        password_validation.validate_password(pwd)
        user = User(username=o["username"], email=o["email"], role=o["role"])
        user.set_password(pwd)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Created {o['role']} account '{o['username']}'."))
