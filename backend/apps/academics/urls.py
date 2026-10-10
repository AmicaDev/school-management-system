from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views as v

router = SimpleRouter()
router.register("years", v.AcademicYearViewSet)
router.register("terms", v.TermViewSet)
router.register("classes", v.ClassViewSet)
router.register("streams", v.StreamViewSet)
router.register("subjects", v.SubjectViewSet)
router.register("assignments", v.TeachingAssignmentViewSet)
router.register("exam-types", v.ExamTypeViewSet)
router.register("grading", v.GradeBandViewSet)

urlpatterns = [path("school-profile/", v.school_profile)] + router.urls
