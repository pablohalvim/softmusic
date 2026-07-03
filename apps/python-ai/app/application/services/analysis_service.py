from __future__ import annotations

import json
import secrets
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.audio_pipeline import AudioPipeline, PipelineContext
from app.application.services.cifra_variation_builder import (
    build_cifra_variation_snapshot,
    next_import_variation_name,
    serialize_cifra_variation,
)
from app.domain.errors import AnalysisCancelledError
from app.domain.interfaces.source_downloader import extract_youtube_video_id
from app.infrastructure.database.models import (
    AnalysisJob,
    AnalysisResult,
    CifraVariation,
    JobStatus,
    Song,
    SongStatus,
)
from app.config import get_settings
from app.infrastructure.cifra.cifraclub_importer import CifraClubImporter, is_cifra_club_url
from app.infrastructure.ml.demucs_separator import DemucsSeparator
from app.infrastructure.download.resolver import SourceDownloadResolver
from app.infrastructure.jobs.cancellation import clear_cancel, is_cancelled, request_cancel
from app.infrastructure.storage.factory import get_storage
from app.logging import logger


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


class AnalysisService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = get_storage()
        self.pipeline = AudioPipeline()
        self.downloader = SourceDownloadResolver()

    async def create_from_upload(
        self,
        filename: str,
        content: bytes,
        options: dict[str, Any] | None = None,
    ) -> tuple[Song, AnalysisJob]:
        song_id = _new_id("song")
        job_id = _new_id("job")
        key = f"{song_id}/{filename}"
        file_path = await self.storage.save(key, content)

        cifra_url = (options or {}).get("cifra_club_url")
        cifra_club_url = cifra_url.strip() if isinstance(cifra_url, str) and cifra_url.strip() else None

        song = Song(
            id=song_id,
            source_type="upload",
            source_ref=filename,
            file_path=file_path,
            cifra_club_url=cifra_club_url,
            status=SongStatus.PENDING.value,
        )
        job = AnalysisJob(
            id=job_id,
            song_id=song_id,
            status=JobStatus.QUEUED.value,
            progress=0,
            options_json=json.dumps(options or {}),
        )
        self.session.add(song)
        self.session.add(job)
        await self.session.commit()
        await self.session.refresh(song)
        await self.session.refresh(job)
        return song, job

    async def create_from_source(
        self,
        source_type: str,
        source_ref: str,
        options: dict[str, Any] | None = None,
    ) -> tuple[Song, AnalysisJob]:
        song_id = _new_id("song")
        job_id = _new_id("job")

        opts = options or {}
        cifra_url = opts.get("cifra_club_url")
        cifra_club_url = cifra_url.strip() if isinstance(cifra_url, str) and cifra_url.strip() else None
        youtube_url = None
        youtube_video_id = None
        if source_type == "youtube":
            youtube_url = source_ref
            youtube_video_id = extract_youtube_video_id(source_ref)

        song = Song(
            id=song_id,
            source_type=source_type,
            source_ref=source_ref,
            youtube_url=youtube_url,
            youtube_video_id=youtube_video_id,
            cifra_club_url=cifra_club_url,
            status=SongStatus.PENDING.value,
        )
        job = AnalysisJob(
            id=job_id,
            song_id=song_id,
            status=JobStatus.QUEUED.value,
            progress=0,
            options_json=json.dumps(options or {}),
        )
        self.session.add(song)
        self.session.add(job)
        await self.session.commit()
        await self.session.refresh(song)
        await self.session.refresh(job)
        return song, job

    async def get_song(self, song_id: str) -> Song | None:
        result = await self.session.execute(select(Song).where(Song.id == song_id, Song.deleted_at.is_(None)))
        return result.scalar_one_or_none()

    async def find_song_by_youtube_video_id(self, url: str) -> Song | None:
        video_id = extract_youtube_video_id(url)
        if not video_id:
            return None
        result = await self.session.execute(
            select(Song)
            .where(
                Song.deleted_at.is_(None),
                Song.status == SongStatus.COMPLETED.value,
                or_(
                    Song.youtube_video_id == video_id,
                    (Song.source_type == "youtube") & Song.source_ref.contains(video_id),
                ),
            )
            .order_by(Song.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_cifra_variations(self, song_id: str) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(CifraVariation)
            .where(CifraVariation.song_id == song_id)
            .order_by(CifraVariation.created_at.desc())
        )
        return [serialize_cifra_variation(variation) for variation in result.scalars().all()]

    async def add_cifra_variation_from_cifra_club(self, song_id: str, url: str) -> dict[str, Any]:
        payload = self.fetch_cifra_club_payload(url)
        if not payload:
            raise ValueError("Não foi possível importar a cifra do Cifra Club")

        name = await next_import_variation_name(self.session, song_id)
        snapshot = build_cifra_variation_snapshot(payload)
        variation = CifraVariation(
            id=_new_id("var"),
            song_id=song_id,
            name=name,
            snapshot_json=json.dumps(snapshot),
            cifra_club_url=url.strip(),
        )
        self.session.add(variation)

        song = await self.get_song(song_id)
        if song:
            if song.source_type == "youtube":
                if not song.youtube_url:
                    song.youtube_url = song.source_ref
                if not song.youtube_video_id:
                    song.youtube_video_id = extract_youtube_video_id(song.source_ref)
            song.cifra_club_url = url.strip()

        await self.session.commit()
        await self.session.refresh(variation)
        return serialize_cifra_variation(variation)

    async def get_job(self, job_id: str) -> AnalysisJob | None:
        result = await self.session.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))
        return result.scalar_one_or_none()

    async def get_latest_job_for_song(self, song_id: str) -> AnalysisJob | None:
        result = await self.session.execute(
            select(AnalysisJob)
            .where(AnalysisJob.song_id == song_id)
            .order_by(AnalysisJob.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_songs(self, limit: int = 50, offset: int = 0) -> tuple[list[Song], int]:
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        count_result = await self.session.execute(
            select(func.count()).select_from(Song).where(Song.deleted_at.is_(None))
        )
        total = count_result.scalar_one()
        result = await self.session.execute(
            select(Song)
            .where(Song.deleted_at.is_(None))
            .order_by(Song.created_at.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )
        return list(result.scalars().all()), total

    async def get_dashboard_stats(self) -> dict[str, Any]:
        now = datetime.now(UTC)
        since_24h = now - timedelta(hours=24)

        async def count_songs(status: str | None = None) -> int:
            query = select(func.count()).select_from(Song).where(Song.deleted_at.is_(None))
            if status is not None:
                query = query.where(Song.status == status)
            result = await self.session.execute(query)
            return int(result.scalar_one())

        async def count_jobs(status: str | None = None, since: datetime | None = None) -> int:
            query = select(func.count()).select_from(AnalysisJob)
            if status is not None:
                query = query.where(AnalysisJob.status == status)
            if since is not None:
                query = query.where(AnalysisJob.created_at >= since)
            result = await self.session.execute(query)
            return int(result.scalar_one())

        completed_songs = await count_songs(SongStatus.COMPLETED.value)
        failed_songs = await count_songs(SongStatus.FAILED.value)
        pending_songs = await count_songs(SongStatus.PENDING.value)
        processing_songs = await count_songs(SongStatus.PROCESSING.value)
        total_songs = await count_songs()

        queued_jobs = await count_jobs(JobStatus.QUEUED.value)
        processing_jobs = await count_jobs(JobStatus.PROCESSING.value)

        duration_result = await self.session.execute(
            select(
                func.avg(
                    func.timestampdiff(
                        text("SECOND"),
                        AnalysisJob.created_at,
                        AnalysisJob.completed_at,
                    )
                )
            ).where(
                AnalysisJob.status == JobStatus.COMPLETED.value,
                AnalysisJob.completed_at.is_not(None),
                AnalysisJob.completed_at >= since_24h,
            )
        )
        avg_seconds = duration_result.scalar_one()
        average_duration_seconds = round(float(avg_seconds), 1) if avg_seconds is not None else None

        completed_24h = await count_jobs(JobStatus.COMPLETED.value, since_24h)
        failed_24h = await count_jobs(JobStatus.FAILED.value, since_24h)
        cancelled_24h = await count_jobs(JobStatus.CANCELLED.value, since_24h)
        finished_24h = completed_24h + failed_24h + cancelled_24h
        success_rate_24h = (
            round((completed_24h / finished_24h) * 100, 1) if finished_24h > 0 else None
        )

        recent_result = await self.session.execute(
            select(Song)
            .where(Song.deleted_at.is_(None))
            .order_by(Song.updated_at.desc())
            .limit(6)
        )
        recent_songs = [
            {
                "id": song.id,
                "title": song.title,
                "artist": song.artist,
                "status": song.status,
                "updated_at": song.updated_at.isoformat(),
            }
            for song in recent_result.scalars().all()
        ]

        active_jobs_result = await self.session.execute(
            select(AnalysisJob, Song)
            .join(Song, Song.id == AnalysisJob.song_id)
            .where(
                Song.deleted_at.is_(None),
                AnalysisJob.status.in_([JobStatus.QUEUED.value, JobStatus.PROCESSING.value]),
            )
            .order_by(AnalysisJob.updated_at.desc())
            .limit(6)
        )
        active_jobs = [
            {
                "job_id": job.id,
                "song_id": song.id,
                "title": song.title,
                "status": job.status,
                "stage": job.stage,
                "progress": job.progress,
                "updated_at": job.updated_at.isoformat(),
            }
            for job, song in active_jobs_result.all()
        ]

        return {
            "generated_at": now.isoformat(),
            "songs": {
                "total": total_songs,
                "completed": completed_songs,
                "failed": failed_songs,
                "pending": pending_songs,
                "processing": processing_songs,
            },
            "jobs": {
                "queued": queued_jobs,
                "processing": processing_jobs,
            },
            "pipeline": {
                "average_duration_seconds": average_duration_seconds,
                "success_rate_24h": success_rate_24h,
                "completed_24h": completed_24h,
                "failed_24h": failed_24h,
            },
            "recent_songs": recent_songs,
            "active_jobs": active_jobs,
        }

    async def get_analysis(self, song_id: str) -> AnalysisResult | None:
        result = await self.session.execute(select(AnalysisResult).where(AnalysisResult.song_id == song_id))
        return result.scalar_one_or_none()

    async def _raise_if_cancelled(self, job_id: str) -> None:
        job = await self.get_job(job_id)
        if job is None:
            raise ValueError(f"Job not found: {job_id}")
        if job.status == JobStatus.CANCELLED.value or is_cancelled(job_id):
            raise AnalysisCancelledError("Análise cancelada pelo usuário")

    async def cancel_song_analysis(self, song_id: str) -> AnalysisJob:
        song = await self.get_song(song_id)
        if song is None:
            raise ValueError("Song not found")

        job = await self.get_latest_job_for_song(song_id)
        if job is None:
            raise ValueError("Job not found")

        if job.status in {JobStatus.COMPLETED.value, JobStatus.CANCELLED.value}:
            return job

        job.status = JobStatus.CANCELLED.value
        job.error = "Cancelado pelo usuário"
        job.completed_at = datetime.now(UTC)
        song.status = SongStatus.FAILED.value
        request_cancel(job.id)
        await self.session.commit()
        await self.session.refresh(job)

        from app.worker import revoke_job_task

        revoke_job_task(job.id)
        logger.info("analysis_cancelled", song_id=song_id, job_id=job.id)
        return job

    async def delete_song(self, song_id: str) -> None:
        song = await self.get_song(song_id)
        if song is None:
            raise ValueError("Song not found")

        job = await self.get_latest_job_for_song(song_id)
        if job and job.status in {JobStatus.QUEUED.value, JobStatus.PROCESSING.value}:
            await self.cancel_song_analysis(song_id)
            song = await self.get_song(song_id)
            if song is None:
                return

        song_dir = Path(self.storage.base_path) / song_id  # type: ignore[attr-defined]
        if song_dir.exists():
            shutil.rmtree(song_dir, ignore_errors=True)

        song.deleted_at = datetime.now(UTC)
        await self.session.commit()
        logger.info("song_deleted", song_id=song_id)

    async def process_job(self, job_id: str) -> dict[str, Any]:
        job = await self.get_job(job_id)
        if job is None:
            raise ValueError(f"Job not found: {job_id}")

        song = await self.get_song(job.song_id)
        if song is None:
            raise ValueError(f"Song not found: {job.song_id}")

        if job.status == JobStatus.CANCELLED.value:
            raise AnalysisCancelledError("Análise cancelada pelo usuário")

        options = json.loads(job.options_json or "{}")
        await self._raise_if_cancelled(job_id)

        job.status = JobStatus.PROCESSING.value
        job.stage = "validate"
        job.progress = 5
        song.status = SongStatus.PROCESSING.value
        await self.session.commit()

        working_dir = Path(self.storage.base_path) / song.id  # type: ignore[attr-defined]
        working_dir.mkdir(parents=True, exist_ok=True)

        source_metadata: dict[str, Any] = {}
        source_path = Path(song.file_path) if song.file_path else working_dir / "source.bin"
        remote_source_types = {"http", "youtube", "s3", "azure_blob", "gcs"}

        if song.source_type in remote_source_types and not source_path.exists():
            job.stage = "download"
            job.progress = 15
            await self.session.commit()

            download = await self.downloader.download(song.source_type, song.source_ref, working_dir)
            source_path = download.file_path
            song.file_path = str(source_path)
            source_metadata = download.metadata.to_dict()

            if download.metadata.title:
                song.title = download.metadata.title
            if download.metadata.artist:
                song.artist = download.metadata.artist
            if download.metadata.duration_seconds:
                song.duration_seconds = download.metadata.duration_seconds

            if song.source_type == "youtube":
                song.youtube_url = song.source_ref
                video_id = extract_youtube_video_id(song.source_ref)
                if video_id:
                    song.youtube_video_id = video_id

            await self.session.commit()
            logger.info(
                "source_downloaded",
                song_id=song.id,
                source_type=song.source_type,
                file_path=str(source_path),
            )
            await self._raise_if_cancelled(job_id)
        elif not source_path.exists():
            raise FileNotFoundError(f"Arquivo de áudio não encontrado: {source_path}")

        job.stage = "separate_stems"
        job.progress = 25
        await self.session.commit()
        await self._raise_if_cancelled(job_id)

        settings = get_settings()
        context = PipelineContext(
            song_id=song.id,
            source_path=source_path,
            working_dir=working_dir,
            options=options,
            source_metadata=source_metadata,
            enable_stem_separation=settings.demucs_enabled,
            demucs_model=settings.demucs_model,
            models_cache_dir=settings.models_cache_dir,
        )

        job.stage = "analyze_stems"
        job.progress = 45
        await self.session.commit()
        await self._raise_if_cancelled(job_id)

        payload = self.pipeline.run(context)

        if source_metadata.get("title") and not payload["metadata"].get("title"):
            payload["metadata"]["title"] = source_metadata["title"]
        if source_metadata.get("artist") and not payload["metadata"].get("artist"):
            payload["metadata"]["artist"] = source_metadata["artist"]

        cifra_club_url = options.get("cifra_club_url")
        if isinstance(cifra_club_url, str) and cifra_club_url.strip():
            job.stage = "import_cifra"
            job.progress = 80
            await self.session.commit()
            await self._raise_if_cancelled(job_id)
            imported = self.import_cifra_club(song.id, cifra_club_url.strip())
            if imported:
                payload["cifra_club"] = imported
                song.cifra_club_url = cifra_club_url.strip()
                if imported.get("title") and not song.title:
                    song.title = imported["title"]
                if imported.get("artist") and not song.artist:
                    song.artist = imported["artist"]

        job.stage = "persist"
        job.progress = 90
        await self.session.commit()

        result = AnalysisResult(
            song_id=song.id,
            version=payload["version"],
            payload_json=json.dumps(payload),
        )
        self.session.add(result)
        song.status = SongStatus.COMPLETED.value
        song.duration_seconds = payload["metadata"]["duration_seconds"]
        if payload["metadata"].get("title"):
            song.title = payload["metadata"]["title"]
        if payload["metadata"].get("artist"):
            song.artist = payload["metadata"]["artist"]
        job.status = JobStatus.COMPLETED.value
        job.stage = "persist"
        job.progress = 100
        job.completed_at = datetime.now(UTC)
        await self.session.commit()
        clear_cancel(job.id)

        logger.info("analysis_completed", song_id=song.id, job_id=job.id)
        return payload

    def get_stems_manifest(self, song_id: str) -> dict[str, Any] | None:
        stems_dir = Path(self.storage.base_path) / song_id / "stems"  # type: ignore[attr-defined]
        manifest = DemucsSeparator.load_manifest(stems_dir)
        if manifest is None:
            return None
        return {
            "song_id": song_id,
            "separated": True,
            **manifest,
        }

    def resolve_stem_path(self, song_id: str, stem_name: str) -> Path | None:
        stems_dir = Path(self.storage.base_path) / song_id / "stems"  # type: ignore[attr-defined]
        manifest = DemucsSeparator.load_manifest(stems_dir)
        if manifest is None:
            return None

        for item in manifest.get("stems", []):
            if item.get("name") != stem_name:
                continue
            if item.get("available") is False:
                return None
            stem_path = stems_dir / str(item.get("file", ""))
            if stem_path.exists() and stem_path.is_file():
                return stem_path
        return None

    def resolve_playback_path(self, song_id: str, song: Song) -> Path | None:
        song_dir = Path(self.storage.base_path) / song_id  # type: ignore[attr-defined]
        candidates: list[Path] = [
            song_dir / "trimmed.wav",
            song_dir / "normalized.wav",
        ]
        if song.file_path:
            candidates.append(Path(song.file_path))

        for path in candidates:
            if path.exists() and path.is_file():
                return path
        return None

    def fetch_cifra_club_payload(self, url: str) -> dict[str, Any] | None:
        if not is_cifra_club_url(url):
            logger.warning("cifra_club_invalid_url", url=url)
            return None
        try:
            importer = CifraClubImporter()
            result = importer.fetch(url)
            return CifraClubImporter.to_payload(result)
        except Exception as exc:
            logger.warning("cifra_club_fetch_failed", url=url, error=str(exc))
            return None

    def import_cifra_club(self, song_id: str, url: str) -> dict[str, Any] | None:
        if not is_cifra_club_url(url):
            logger.warning("cifra_club_invalid_url", song_id=song_id, url=url)
            return None
        try:
            importer = CifraClubImporter()
            result = importer.fetch(url)
            output_path = Path(self.storage.base_path) / song_id / "cifra_club.json"  # type: ignore[attr-defined]
            payload = CifraClubImporter.to_payload(result)
            CifraClubImporter.save(result, output_path)
            return payload
        except Exception as exc:
            logger.warning("cifra_club_import_failed", song_id=song_id, url=url, error=str(exc))
            return None

    def get_cifra_club_sheet(self, song_id: str) -> dict[str, Any] | None:
        path = Path(self.storage.base_path) / song_id / "cifra_club.json"  # type: ignore[attr-defined]
        return CifraClubImporter.load(path)
