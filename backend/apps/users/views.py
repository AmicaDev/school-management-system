from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import connection
import os
import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.core.cache import cache
from rest_framework import exceptions, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, Throttled, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.audit.mixins import AuditMixin
from apps.audit.services import audit

from .models import User
from .passwords import check_password_strength
from .permissions import IsAdmin, IsDeveloper
from .serializers import (ChangePasswordSerializer, DeveloperAdminAccountSerializer, LoginSerializer,
                          ManagedUserSerializer, ResetConfirmSerializer, ResetRequestSerializer,
                          TeacherLoginSerializer, UserSerializer)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    permission_classes = []
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        ident = str(request.data.get("username", ""))[:150]
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            user = User.objects.filter(pk=response.data["user"]["id"]).first()
            audit(request, "LOGIN", "auth", ident, "SUCCESS", actor=user)
        else:
            audit(request, "LOGIN_FAILED", "auth", ident, "FAILURE", actor=None)
        return response


class TeacherLoginView(APIView):
    """
    Dedicated sign-in view for teachers using teacher identifier and admin-issued code.
    Throttled at 10/min, with a 5-minute lockout after 5 consecutive failed attempts on an identifier.
    Audit events: TEACHER_LOGIN (success), TEACHER_LOGIN_FAILED (failure).
    """
    permission_classes = []
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "teacher_login"
    www_authenticate_realm = "api"

    def get_authenticate_header(self, request):
        return 'Bearer realm="api"'

    def post(self, request, *args, **kwargs):
        ident = str(request.data.get("identifier") or request.data.get("username") or "")[:150]
        cache_ident = re.sub(r"[^a-zA-Z0-9]+", "_", ident).strip("_").lower()

        # Check per-identifier lockout
        # Note on caching: When REDIS_URL is not set (e.g. in development or single-dyno setups),
        # Django falls back to LocMemCache which is per-process. In a multi-worker environment without Redis,
        # per-identifier failure counts are tracked per process. This degrades gracefully while still
        # protecting against rapid brute-force attacks on any individual worker.
        lockout_key = f"teacher_lockout:{cache_ident}"
        if cache_ident and cache.get(lockout_key):
            audit(request, "TEACHER_LOGIN_FAILED", "auth", ident, "FAILURE", actor=None)
            raise Throttled(detail="Too many failed login attempts. Please try again later.")

        serializer = TeacherLoginSerializer(data=request.data, context={"request": request})
        try:
            serializer.is_valid(raise_exception=True)
        except (exceptions.AuthenticationFailed, exceptions.NotAuthenticated):
            if cache_ident:
                fail_key = f"teacher_fail_count:{cache_ident}"
                fails = cache.get(fail_key, 0) + 1
                if fails >= 5:
                    cache.set(lockout_key, True, timeout=300)
                    cache.delete(fail_key)
                else:
                    cache.set(fail_key, fails, timeout=300)
            audit(request, "TEACHER_LOGIN_FAILED", "auth", ident, "FAILURE", actor=None)
            raise
        except Exception:
            audit(request, "TEACHER_LOGIN_FAILED", "auth", ident, "FAILURE", actor=None)
            raise

        if cache_ident:
            cache.delete(f"teacher_fail_count:{cache_ident}")
            cache.delete(lockout_key)

        user_data = serializer.validated_data.get("user")
        user = User.objects.filter(pk=user_data["id"]).first() if user_data else None
        audit(request, "TEACHER_LOGIN", "auth", ident, "SUCCESS", actor=user)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            pass
        audit(request, "LOGOUT", "auth", request.user.username, "SUCCESS")
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        s = UserSerializer(request.user, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class ChangePasswordView(APIView):
    def post(self, request):
        s = ChangePasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if not request.user.check_password(s.validated_data["old_password"]):
            return Response({"old_password": ["Incorrect password."]}, status=400)
        request.user.set_password(s.validated_data["new_password"])
        request.user.save()
        audit(request, "PASSWORD_CHANGE", "auth", request.user.username, "SUCCESS")
        return Response({"detail": "Password updated."})


class PasswordResetRequestView(APIView):
    permission_classes = []
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "reset"

    def post(self, request):
        s = ResetRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        for user in User.objects.filter(email__iexact=s.validated_data["email"], is_active=True)[:3]:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
            send_mail("Reset your School Management System password",
                      f"Use this link to choose a new password:\n{link}\n\nIgnore this email if you did not ask for it.",
                      None, [user.email], fail_silently=True)
        # Same response whether or not the address exists (prevents account enumeration).
        return Response({"detail": "If the address is registered, a reset link has been sent."})


class PasswordResetConfirmView(APIView):
    permission_classes = []
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "reset"

    def post(self, request):
        s = ResetConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(s.validated_data["uid"])))
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return Response({"detail": "Invalid or expired link."}, status=400)
        if not default_token_generator.check_token(user, s.validated_data["token"]):
            return Response({"detail": "Invalid or expired link."}, status=400)
        check_password_strength(s.validated_data["new_password"], user, "new_password")
        user.set_password(s.validated_data["new_password"])
        user.save()
        audit(request, "PASSWORD_RESET", "auth", user.username, "SUCCESS", actor=user)
        return Response({"detail": "Password has been reset."})


class UserViewSet(AuditMixin, viewsets.ModelViewSet):
    """ADMIN: manage school accounts. Developer accounts are never visible here."""
    permission_classes = [IsAdmin]
    serializer_class = ManagedUserSerializer
    audit_module = "users"
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "first_name", "last_name", "email"]

    def get_queryset(self):
        return User.objects.exclude(role=User.Role.DEVELOPER)

    @staticmethod
    def _lock_active_admins():
        return list(
            User.objects.select_for_update().filter(role=User.Role.ADMIN, is_active=True)
            .values_list("pk", flat=True)
        )

    @transaction.atomic
    def perform_update(self, serializer):
        instance = serializer.instance
        role = serializer.validated_data.get("role", instance.role)
        active = serializer.validated_data.get("is_active", instance.is_active)
        if instance.role == User.Role.ADMIN and instance.is_active and (role != User.Role.ADMIN or not active):
            admin_ids = self._lock_active_admins()
            if not any(admin_id != instance.pk for admin_id in admin_ids):
                raise ValidationError({"detail": "At least one active administrator account must remain."})
        if instance.role == User.Role.ADMIN:
            if role != User.Role.ADMIN or (instance.is_active and not active):
                serializer.validated_data["admin_deactivated_at"] = timezone.now()
            elif role == User.Role.ADMIN and not instance.is_active and active:
                serializer.validated_data["admin_deactivated_at"] = None
        serializer.save()

    @transaction.atomic
    def perform_destroy(self, instance):  # accounts are deactivated, never deleted
        if instance.role == User.Role.ADMIN and instance.is_active:
            admin_ids = self._lock_active_admins()
            if not any(admin_id != instance.pk for admin_id in admin_ids):
                raise ValidationError({"detail": "At least one active administrator account must remain."})
        instance.is_active = False
        if instance.role == User.Role.ADMIN:
            instance.admin_deactivated_at = timezone.now()
        instance.save(update_fields=["is_active", "admin_deactivated_at", "updated_at"])
        audit(self.request, "DEACTIVATE", "users", instance.username, "SUCCESS")

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.query_params.get("permanent") == "true":
            if instance.role == User.Role.ADMIN:
                return Response({"detail": "Administrator accounts cannot be permanently deleted."}, status=status.HTTP_400_BAD_REQUEST)
            username = instance.username
            instance.delete()
            audit(request, "PERMANENT_DELETE", "users", username, "SUCCESS")
            return Response(status=status.HTTP_204_NO_CONTENT)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, pk=None):
        instance = self.get_object()
        if instance.role == User.Role.ADMIN:
            return Response({"detail": "Administrator accounts cannot be permanently deleted."}, status=status.HTTP_400_BAD_REQUEST)
        username = instance.username
        instance.delete()
        audit(request, "PERMANENT_DELETE", "users", username, "SUCCESS")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        instance = self.get_object()
        instance.is_active = True
        if instance.role == User.Role.ADMIN:
            instance.admin_deactivated_at = None
        instance.save(update_fields=["is_active", "admin_deactivated_at", "updated_at"])
        audit(request, "RESTORE", "users", instance.username, "SUCCESS")
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def reset_password(self, request, pk=None):
        user = self.get_object()
        s = ChangePasswordSerializer(data={"old_password": "-", "new_password": request.data.get("new_password", "")})
        s.is_valid(raise_exception=True)
        user.set_password(s.validated_data["new_password"])
        user.save()
        audit(request, "RESET_CREDENTIALS", "users", user.username, "SUCCESS")
        return Response({"detail": "Credentials reset."})


class DeveloperAdminAccountViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsDeveloper]
    serializer_class = DeveloperAdminAccountSerializer
    queryset = User.objects.filter(role=User.Role.ADMIN).order_by("username")
    http_method_names = ["get", "post", "head", "options"]

    @staticmethod
    def _assert_render_production_database():
        database = settings.DATABASES["default"]
        database_host = database.get("HOST", "").lower()
        is_render_database_host = (
            database_host.endswith(".render.com")
            or re.fullmatch(r"dpg-[a-z0-9-]+", database_host) is not None
        )
        if (
            settings.DEBUG
            or not os.environ.get("RENDER_EXTERNAL_HOSTNAME")
            or connection.vendor != "postgresql"
            or not is_render_database_host
        ):
            raise ValidationError({"detail": "Administrator management is only available on the production Render service."})

    def get_queryset(self):
        self._assert_render_production_database()
        return super().get_queryset()

    def list(self, request, *args, **kwargs):
        audit(request, "LIST_ADMIN_ACCOUNTS", "developer", "administrator accounts")
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        self._assert_render_production_database()
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except ValidationError:
            audit(request, "CREATE_ADMIN_ACCOUNT", "developer", request.data.get("username", ""), "FAILURE")
            raise
        with transaction.atomic():
            user = serializer.save()
        audit(request, "CREATE_ADMIN_ACCOUNT", "developer", user.username)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def _set_admin_active(self, request, user, active, action_name):
        self._assert_render_production_database()
        try:
            with transaction.atomic():
                locked_admins = list(
                    User.objects.select_for_update().filter(role=User.Role.ADMIN).order_by("pk")
                )
                user = next((admin for admin in locked_admins if admin.pk == user.pk), None)
                if user is None:
                    raise ValidationError({"detail": "Only administrator accounts can be managed here."})
                if user.is_active == active:
                    raise ValidationError({"detail": f"This administrator account is already {'active' if active else 'inactive'}."})

                now = timezone.now()
                if active:
                    cutoff = now - timedelta(days=30)
                    if not user.admin_deactivated_at or not cutoff <= user.admin_deactivated_at <= now:
                        raise ValidationError({"detail": "This account is not eligible for recovery; only accounts deactivated within the past 30 days can be reactivated."})
                elif not any(admin.pk != user.pk and admin.is_active for admin in locked_admins):
                    raise ValidationError({"detail": "At least one active administrator account must remain."})

                user.is_active = active
                user.admin_deactivated_at = None if active else now
                user.save(update_fields=["is_active", "admin_deactivated_at", "updated_at"])
        except ValidationError:
            audit(request, f"{action_name}_ADMIN_ACCOUNT", "developer", str(self.kwargs.get("pk", "")), "FAILURE")
            raise
        audit(request, f"{action_name}_ADMIN_ACCOUNT", "developer", user.username)
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        return self._set_admin_active(request, user, False, "DEACTIVATE")

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        user = self.get_object()
        return self._set_admin_active(request, user, True, "ACTIVATE")

    @action(detail=True, methods=["post"])
    def recover(self, request, pk=None):
        user = self.get_object()
        return self._set_admin_active(request, user, True, "RECOVER")
