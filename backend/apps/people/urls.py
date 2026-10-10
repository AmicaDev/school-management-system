from rest_framework.routers import SimpleRouter

from . import views as v

router = SimpleRouter()
router.register("students", v.StudentViewSet, basename="student")
router.register("parents", v.ParentViewSet, basename="parent")
router.register("teachers", v.TeacherViewSet, basename="teacher")
router.register("staff", v.StaffViewSet, basename="staff")
urlpatterns = router.urls
