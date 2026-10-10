from rest_framework.routers import SimpleRouter

from . import views as v

router = SimpleRouter()
router.register("events", v.EventViewSet, basename="event")
router.register("notifications", v.NotificationViewSet, basename="notification")
router.register("enquiries", v.EnquiryViewSet, basename="enquiry")
urlpatterns = router.urls
