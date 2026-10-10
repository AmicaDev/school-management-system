from django.core.cache import cache
from django.http import JsonResponse

ALLOWED_PREFIXES = ("/api/v1/auth/", "/api/v1/developer/", "/django-admin/", "/static/", "/media/")


class MaintenanceMiddleware:
    """When maintenance mode is on, school APIs return 503. Auth and the developer console stay reachable."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if cache.get("maintenance_mode") and request.path.startswith("/api/") and not request.path.startswith(ALLOWED_PREFIXES):
            return JsonResponse({"detail": "The system is temporarily unavailable for maintenance.", "maintenance": True},
                                status=503)
        return self.get_response(request)
