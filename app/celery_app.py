"""Celery application instance."""

from celery import Celery
from celery.schedules import crontab
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "common_ground",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=3600,  # results kept for 1 hour

    # Beat schedule disabled — scheduled ingest will run via server cron after deployment
    beat_schedule={},
    timezone="UTC",
)
