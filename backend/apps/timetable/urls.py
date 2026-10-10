from rest_framework.routers import SimpleRouter

from .views import TimetableViewSet

router = SimpleRouter()
router.register("", TimetableViewSet, basename="timetable")
urlpatterns = router.urls
