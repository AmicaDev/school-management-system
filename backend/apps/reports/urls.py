from django.urls import path

from . import views

urlpatterns = [
    path("report-card/<int:student_id>/<int:term_id>/", views.report_card),
    path("class-cards/", views.class_jobs),
    path("class-cards/<int:job_id>/download/", views.job_download),
]
