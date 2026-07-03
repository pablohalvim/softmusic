from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init

from app.config import get_settings
from app.infrastructure.database.models import JobStatus, SongStatus
from app.infrastructure.database.session import dispose_engine_after_fork, run_async_in_worker
from app.infrastructure.ml.device import log_compute_device

settings = get_settings()

celery_app = Celery(
    "softmusic",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="analysis",
    task_routes={
        "app.worker.run_analysis": {"queue": "analysis"},
        "app.worker.suspend_overdue_accounts": {"queue": "billing"},
    },
    beat_schedule={
        "suspend-overdue-accounts-hourly": {
            "task": "app.worker.suspend_overdue_accounts",
            "schedule": crontab(minute=0),
            "options": {"queue": "billing"},
        },
    },
)


@worker_process_init.connect
def on_worker_process_init(**_: object) -> None:
    dispose_engine_after_fork()
    log_compute_device("celery_worker")


@celery_app.task(name="app.worker.run_analysis", bind=True, max_retries=3)
def run_analysis(self, job_id: str) -> dict:
    from app.application.services.analysis_service import AnalysisService
    from app.domain.errors import AnalysisCancelledError

    async def process(session) -> dict:
        service = AnalysisService(session)
        try:
            return await service.process_job(job_id)
        except AnalysisCancelledError:
            return {"cancelled": True, "job_id": job_id}
        except Exception as exc:
            job = await service.get_job(job_id)
            if job and job.status != JobStatus.CANCELLED.value:
                job.status = JobStatus.FAILED.value
                job.error = str(exc)
                song = await service.get_song(job.song_id)
                if song:
                    song.status = SongStatus.FAILED.value
                await session.commit()
            raise

    return run_async_in_worker(process)


@celery_app.task(name="app.worker.suspend_overdue_accounts")
def suspend_overdue_accounts() -> dict[str, int]:
    from app.application.services.billing_service import BillingService

    async def run(session) -> dict[str, int]:
        count = await BillingService(session).suspend_overdue_accounts()
        return {"suspended": count}

    return run_async_in_worker(run)


def revoke_job_task(job_id: str) -> None:
    try:
        inspect = celery_app.control.inspect(timeout=1.0)
        active = inspect.active() or {}
        reserved = inspect.reserved() or {}
        for bucket in (active, reserved):
            for tasks in bucket.values():
                for task in tasks:
                    if task.get("name") != "app.worker.run_analysis":
                        continue
                    args = task.get("args") or []
                    if args and args[0] == job_id:
                        celery_app.control.revoke(task["id"], terminate=True, signal="SIGTERM")
    except Exception:
        pass


def main() -> None:
    celery_app.worker_main(["worker", "--loglevel=info"])
