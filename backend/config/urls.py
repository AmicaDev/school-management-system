from django.conf import settings
from django.urls import re_path
from django.views.static import serve
from django.contrib import admin
from django.urls import include, path

v1 = [
    path("auth/", include("apps.users.urls")),
    path("academics/", include("apps.academics.urls")),
    path("", include("apps.people.urls")),
    path("attendance/", include("apps.attendance.urls")),
    path("results/", include("apps.results.urls")),
    path("timetable/", include("apps.timetable.urls")),
    path("", include("apps.comms.urls")),
    path("reports/", include("apps.reports.urls")),
    path("analytics/", include("apps.analytics.urls")),
    path("audit/", include("apps.audit.urls")),
    path("developer/", include("apps.developer.urls")),
    path("finance/", include("apps.finance.urls")),
]
urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/v1/", include(v1)),
] + ([re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT})] if settings.SERVE_MEDIA else [])
