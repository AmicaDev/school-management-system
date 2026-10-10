from rest_framework.routers import SimpleRouter

from .views import AttendanceViewSet

router = SimpleRouter()
router.register("", AttendanceViewSet, basename="attendance")
urlpatterns = router.urls
