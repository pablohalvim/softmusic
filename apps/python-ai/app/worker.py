from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init

from app.config import get_settings
from app.infrastructure.database.models import JobStatus, SongStatus
from app.infrastructure.database.session import dispose_engine_after_fork, run_async_in_worker
from app.infrastructure.ml.device import configure_compute_threads, log_compute_device

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
    timezone="America/Sao_Paulo",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="analysis",
    task_routes={
        "app.worker.run_analysis": {"queue": "analysis"},
        "app.worker.run_pitch_shift": {"queue": "analysis"},
        "app.worker.suspend_overdue_accounts": {"queue": "billing"},
        "app.worker.run_daily_billing": {"queue": "billing"},
    },
    beat_schedule={
        "daily-billing-robot": {
            "task": "app.worker.run_daily_billing",
            "schedule": crontab(hour=5, minute=0),
            "options": {"queue": "billing"},
        },
    },
)


@worker_process_init.connect
def on_worker_process_init(**_: object) -> None:
    dispose_engine_after_fork()
    configure_compute_threads("celery_worker")
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
            # A sessão pode estar em rollback pendente (ex.: erro no flush).
            # Sem o rollback, o próprio handler falha e o job fica preso em
            # "processing" em vez de ser marcado como FAILED.
            await session.rollback()
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


@celery_app.task(name="app.worker.run_pitch_shift", bind=True, max_retries=2)
def run_pitch_shift(self, job_id: str) -> dict:
    """Pitch-shift job: does NOT flip Song.status to processing/failed."""
    from sqlalchemy import select

    from app.application.services.analysis_service import AnalysisService
    from app.domain.errors import AnalysisCancelledError
    from app.infrastructure.database.models import KeyVariantStatus, SongKeyVariant

    async def process(session) -> dict:
        service = AnalysisService(session)
        try:
            return await service.process_pitch_shift_job(job_id)
        except AnalysisCancelledError:
            job = await service.get_job(job_id)
            if job:
                result = await session.execute(
                    select(SongKeyVariant).where(SongKeyVariant.job_id == job_id)
                )
                variant = result.scalar_one_or_none()
                if variant:
                    variant.status = KeyVariantStatus.FAILED.value
                    variant.error = "Cancelado"
                await session.commit()
            return {"cancelled": True, "job_id": job_id}
        except Exception as exc:
            await session.rollback()
            job = await service.get_job(job_id)
            if job and job.status != JobStatus.CANCELLED.value:
                job.status = JobStatus.FAILED.value
                job.error = str(exc)
                result = await session.execute(
                    select(SongKeyVariant).where(SongKeyVariant.job_id == job_id)
                )
                variant = result.scalar_one_or_none()
                if variant:
                    variant.status = KeyVariantStatus.FAILED.value
                    variant.error = str(exc)
                await session.commit()
            raise

    return run_async_in_worker(process)


@celery_app.task(name="app.worker.run_daily_billing")
def run_daily_billing() -> dict[str, int]:
    from app.application.services.billing_service import BillingService

    async def run(session) -> dict[str, int]:
        return await BillingService(session).run_daily_billing_robot()

    return run_async_in_worker(run)


@celery_app.task(name="app.worker.suspend_overdue_accounts")
def suspend_overdue_accounts() -> dict[str, int]:
    """Compat: redireciona para o robô diário de billing."""
    return run_daily_billing()


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
