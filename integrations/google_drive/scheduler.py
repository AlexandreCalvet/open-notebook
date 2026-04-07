"""
APScheduler setup for Drive polling.
Registered in api/main.py lifespan when GOOGLE_DRIVE_CLIENT_ID is set.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger

from integrations.google_drive.sync_service import sync_all

_scheduler: AsyncIOScheduler | None = None


def start_drive_scheduler(interval_minutes: int = 15) -> None:
    """Start the polling scheduler. Idempotent — safe to call multiple times."""
    global _scheduler
    if _scheduler and _scheduler.running:
        logger.debug("Drive scheduler already running")
        return

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        sync_all,
        trigger="interval",
        minutes=interval_minutes,
        id="drive_sync_poll",
        replace_existing=True,
        misfire_grace_time=300,
    )
    _scheduler.start()
    logger.success(f"Drive sync scheduler started (every {interval_minutes} min)")


def stop_drive_scheduler() -> None:
    """Gracefully stop the polling scheduler on API shutdown."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Drive sync scheduler stopped")
