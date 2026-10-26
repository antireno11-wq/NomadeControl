"""Ejecución programada de la ingesta y de las predicciones en vivo con APScheduler.

Una sola instancia de trabajo (``max_instances=1``, ``coalesce=True``) y, además,
el lock consultivo de PostgreSQL impide que una corrida manual y una programada
se superpongan.
"""

from __future__ import annotations

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from radar.config import Settings
from radar.db.session import get_engine
from radar.ingestion.pipeline import RunAlreadyInProgressError, run_ingestion
from radar.logging_setup import get_logger
from radar.timeutil import utcnow

log = get_logger(__name__)


def scheduled_job(settings: Settings) -> None:
    try:
        run_id = run_ingestion(get_engine(settings.database_url), settings, trigger="scheduled")
        log.info("scheduled_run_done", run_id=run_id)
    except RunAlreadyInProgressError:
        log.warning("scheduled_run_skipped", reason="ingesta en curso")
    except Exception:
        # La corrida ya quedó registrada como 'failed' con su error; el
        # programador sigue vivo para el próximo intervalo.
        log.exception("scheduled_run_failed")


def predict_job(settings: Settings) -> None:
    from radar.predict.service import predict_live

    try:
        out = predict_live(settings, get_engine(settings.database_url))
        log.info("scheduled_predict_done", run_id=out.get("run_id"),
                 recomendaciones=(out.get("crypto") or {}).get("recomendaciones"))  # fmt: skip
    except Exception:
        # La corrida queda registrada como 'failed' en prediction_runs.
        log.exception("scheduled_predict_failed")


def run_scheduler(settings: Settings) -> None:
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(
        scheduled_job,
        IntervalTrigger(minutes=settings.schedule_interval_minutes),
        args=[settings],
        id="ingestion",
        max_instances=1,
        coalesce=True,
        next_run_time=utcnow() if settings.schedule_run_on_start else None,
        misfire_grace_time=300,
    )
    if settings.predict_interval_minutes > 0:
        scheduler.add_job(
            predict_job,
            IntervalTrigger(minutes=settings.predict_interval_minutes),
            args=[settings],
            id="predict_live",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=300,
        )
    log.info(
        "scheduler_started",
        interval_minutes=settings.schedule_interval_minutes,
        predict_interval_minutes=settings.predict_interval_minutes,
        run_on_start=settings.schedule_run_on_start,
    )
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("scheduler_stopped")
