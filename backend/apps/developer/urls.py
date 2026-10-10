from django.urls import include, path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("errors", views.ErrorViewSet, basename="dev-error")
urlpatterns = [
    path("status/", views.status),
    path("health/", views.health),
    path("tests/", views.run_tests),
    path("sync/", views.sync_status),
    path("updates/", views.updates),
    path("maintenance/", views.maintenance),
    path("client-errors/", views.client_error),
    path("", include(router.urls)),
]
