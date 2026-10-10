from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views as v

router = SimpleRouter()
router.register("assessments", v.AssessmentViewSet, basename="assessment")
urlpatterns = [
    path("grid/", v.grid),
    path("class-summary/", v.class_summary),
    path("summary/<int:student_id>/<int:term_id>/", v.student_summary),
    path("trend/<int:student_id>/", v.student_trend),
    path("comments/<int:student_id>/<int:term_id>/", v.comment),
] + router.urls
