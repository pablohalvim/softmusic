from __future__ import annotations

import json
import secrets
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
from app.infrastructure.storage.service import PlaybackTarget, StorageService
from app.logging import logger


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _option_bool(options: dict[str, Any], key: str, *, default: bool) -> bool:
    if key not in options:
        return default
    value = options.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "sim", "on"}
    return default


def _normalize_variation_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise ValueError("Snapshot da variação inválido")

    transpose = snapshot.get("transposeSemitones", 0)
    capo = snapshot.get("capo", 0)
    section_chords = snapshot.get("sectionChords") or {}
    imported_sheet = snapshot.get("importedSheet")
    key_override = snapshot.get("keyOverride")
    is_imported = bool(snapshot.get("isImported")) or imported_sheet is not None

    if not isinstance(transpose, int):
        raise ValueError("transposeSemitones deve ser um inteiro")
    if not isinstance(capo, int) or capo < 0 or capo > 12:
        raise ValueError("capo deve ser um inteiro entre 0 e 12")
    if not isinstance(section_chords, dict):
        raise ValueError("sectionChords deve ser um objeto")
    if imported_sheet is not None and not isinstance(imported_sheet, dict):
        raise ValueError("importedSheet inválido")
    if key_override is not None and not isinstance(key_override, dict):
        raise ValueError("keyOverride inválido")

    return {
        "transposeSemitones": transpose,
        "capo": capo,
        "sectionChords": section_chords,
        "isImported": is_imported,
        "importedSheet": imported_sheet,
        "keyOverride": key_override,
    }


class AnalysisService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = StorageService()
        self.pipeline = AudioPipeline()
        self.downloader = SourceDownloadResolver()

    async def create_from_upload(
        self,
        filename: str,
        content: bytes,
        options: dict[str, Any] | None = None,
        *,
        created_by_user_id: str | None = None,
    ) -> tuple[Song, AnalysisJob]:
        song_id = _new_id("song")
        job_id = _new_id("job")
        key = f"{song_id}/{filename}"
        file_path = await self.storage.save(key, content)

        opts = options or {}
        cifra_url = opts.get("cifra_club_url")
        cifra_club_url = cifra_url.strip() if isinstance(cifra_url, str) and cifra_url.strip() else None
        title_raw = opts.get("title")
        title = title_raw.strip() if isinstance(title_raw, str) and title_raw.strip() else None
        artist_raw = opts.get("artist")
        artist = artist_raw.strip() if isinstance(artist_raw, str) and artist_raw.strip() else None
        is_global = _option_bool(opts, "share_to_global", default=True)

        song = Song(
            id=song_id,
            source_type="upload",
            source_ref=filename,
            file_path=file_path,
            title=title,
            artist=artist,
            cifra_club_url=cifra_club_url,
            status=SongStatus.PENDING.value,
            created_by_user_id=created_by_user_id,
            is_global=is_global,
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
        *,
        created_by_user_id: str | None = None,
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
        is_global = _option_bool(opts, "share_to_global", default=True)

        song = Song(
            id=song_id,
            source_type=source_type,
            source_ref=source_ref,
            youtube_url=youtube_url,
            youtube_video_id=youtube_video_id,
            cifra_club_url=cifra_club_url,
            status=SongStatus.PENDING.value,
            created_by_user_id=created_by_user_id,
            is_global=is_global,
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

    async def create_cifra_draft(
        self,
        *,
        title: str | None = None,
        artist: str | None = None,
        cifra_club_url: str | None = None,
        tempo_bpm: int = 120,
        band_id: str | None = None,
        created_by_user_id: str | None = None,
        share_to_global: bool = True,
    ) -> dict[str, Any]:
        """Cria música completed sem job de áudio (Cifra Club ou cifra em branco)."""
        trimmed_title = title.strip() if isinstance(title, str) and title.strip() else None
        trimmed_artist = artist.strip() if isinstance(artist, str) and artist.strip() else None
        url = cifra_club_url.strip() if isinstance(cifra_club_url, str) and cifra_club_url.strip() else None

        if not url and not trimmed_title:
            raise ValueError("Informe o título da música ou um link do Cifra Club")

        song_id = _new_id("song")
        imported: dict[str, Any] | None = None
        if url:
            imported = self.import_cifra_club(song_id, url)
            if not imported:
                raise ValueError("Não foi possível importar a cifra do Cifra Club")
            if not trimmed_title and imported.get("title"):
                trimmed_title = str(imported["title"])
            if not trimmed_artist and imported.get("artist"):
                trimmed_artist = str(imported["artist"])
        else:
            self._save_manual_cifra_sheet(
                song_id,
                title=trimmed_title or "Sem título",
                artist=trimmed_artist,
                tempo_bpm=tempo_bpm,
            )

        song = Song(
            id=song_id,
            title=trimmed_title or "Sem título",
            artist=trimmed_artist,
            source_type="cifra_club" if url else "manual",
            source_ref=url or "manual",
            cifra_club_url=url,
            status=SongStatus.COMPLETED.value,
            created_by_user_id=created_by_user_id,
            is_global=bool(share_to_global),
        )
        self.session.add(song)

        sheet = imported or await self.get_cifra_club_sheet(song_id) or {}
        snapshot = {
            "transposeSemitones": 0,
            "capo": 0,
            "sectionChords": {},
            "isImported": True,
            "importedSheet": {"sections": sheet.get("sections") or []},
            "keyOverride": None,
            "tempoBpm": max(40, min(int(tempo_bpm), 240)),
        }
        variation = CifraVariation(
            id=_new_id("var"),
            song_id=song_id,
            band_id=band_id,
            name="Versão oficial",
            snapshot_json=json.dumps(snapshot),
            cifra_club_url=url,
        )
        self.session.add(variation)
        await self.session.commit()
        await self.session.refresh(song)
        await self.session.refresh(variation)

        return {"song": song, "variation": serialize_cifra_variation(variation)}

    def _save_manual_cifra_sheet(
        self,
        song_id: str,
        *,
        title: str,
        artist: str | None,
        tempo_bpm: int,
    ) -> None:
        output_path = Path(self.storage.base_path) / song_id / "cifra_club.json"  # type: ignore[attr-defined]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "manual",
            "url": None,
            "title": title,
            "artist": artist,
            "key": "C",
            "mode": "major",
            "tempo_bpm": max(40, min(int(tempo_bpm), 240)),
            "sections": [],
        }
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    async def attach_audio_source(
        self,
        song_id: str,
        source_type: str,
        source_ref: str,
        options: dict[str, Any] | None = None,
        *,
        replace: bool = False,
    ) -> AnalysisJob:
        """Anexa YouTube/HTTP a uma música e enfileira análise de áudio."""
        song = await self.get_song(song_id)
        if song is None:
            raise ValueError("Song not found")
        if song.status in {SongStatus.PENDING.value, SongStatus.PROCESSING.value}:
            raise ValueError("Há uma análise em andamento para esta música")
        has_audio = bool(song.file_path or song.youtube_url)
        if has_audio and not replace:
            raise ValueError("Esta música já possui áudio analisado")
        if source_type not in {"youtube", "http", "s3", "azure_blob", "gcs"}:
            raise ValueError("Tipo de fonte de áudio inválido")

        opts = dict(options or {})
        if song.cifra_club_url and "cifra_club_url" not in opts:
            opts["cifra_club_url"] = song.cifra_club_url
        if song.title and "title" not in opts:
            opts["title"] = song.title
        if song.artist and "artist" not in opts:
            opts["artist"] = song.artist

        song.source_type = source_type
        song.source_ref = source_ref
        # Nova fonte remota: o worker baixa de novo (não reutiliza arquivo antigo).
        song.file_path = None
        if source_type == "youtube":
            song.youtube_url = source_ref
            song.youtube_video_id = extract_youtube_video_id(source_ref)
        else:
            song.youtube_url = None
            song.youtube_video_id = None
        song.status = SongStatus.PENDING.value

        job = AnalysisJob(
            id=_new_id("job"),
            song_id=song_id,
            status=JobStatus.QUEUED.value,
            progress=0,
            options_json=json.dumps(opts),
        )
        self.session.add(job)
        await self.session.commit()
        await self.session.refresh(job)
        return job

    async def attach_audio_upload(
        self,
        song_id: str,
        filename: str,
        content: bytes,
        options: dict[str, Any] | None = None,
        *,
        replace: bool = False,
    ) -> AnalysisJob:
        song = await self.get_song(song_id)
        if song is None:
            raise ValueError("Song not found")
        if song.status in {SongStatus.PENDING.value, SongStatus.PROCESSING.value}:
            raise ValueError("Há uma análise em andamento para esta música")
        if song.file_path and not replace:
            raise ValueError("Esta música já possui áudio analisado")

        opts = dict(options or {})
        if song.cifra_club_url and "cifra_club_url" not in opts:
            opts["cifra_club_url"] = song.cifra_club_url
        if song.title and "title" not in opts:
            opts["title"] = song.title
        if song.artist and "artist" not in opts:
            opts["artist"] = song.artist

        key = f"{song_id}/{filename}"
        file_path = await self.storage.save(key, content)
        song.source_type = "upload"
        song.source_ref = filename
        song.file_path = file_path
        song.youtube_url = None
        song.youtube_video_id = None
        song.status = SongStatus.PENDING.value

        job = AnalysisJob(
            id=_new_id("job"),
            song_id=song_id,
            status=JobStatus.QUEUED.value,
            progress=0,
            options_json=json.dumps(opts),
        )
        self.session.add(job)
        await self.session.commit()
        await self.session.refresh(job)
        return job

    async def get_song(self, song_id: str) -> Song | None:
        result = await self.session.execute(select(Song).where(Song.id == song_id, Song.deleted_at.is_(None)))
        return result.scalar_one_or_none()

    async def update_song_metadata(
        self,
        song_id: str,
        *,
        title: str,
        artist: str | None,
    ) -> Song:
        song = await self.get_song(song_id)
        if song is None:
            raise ValueError("Song not found")
        trimmed_title = title.strip() if isinstance(title, str) else ""
        if not trimmed_title:
            raise ValueError("Informe o nome da música")
        trimmed_artist = artist.strip() if isinstance(artist, str) and artist.strip() else None
        song.title = trimmed_title
        song.artist = trimmed_artist
        song.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(song)
        return song

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

    async def list_cifra_variations(
        self, song_id: str, band_id: str | None = None
    ) -> list[dict[str, Any]]:
        query = select(CifraVariation).where(CifraVariation.song_id == song_id)
        if band_id is not None:
            # Variações são da banda (não do usuário): qualquer membro vê as mesmas.
            query = query.where(CifraVariation.band_id == band_id)
        query = query.order_by(CifraVariation.created_at.desc())
        result = await self.session.execute(query)
        return [serialize_cifra_variation(variation) for variation in result.scalars().all()]

    async def add_cifra_variation_from_cifra_club(
        self, song_id: str, url: str, band_id: str | None = None
    ) -> dict[str, Any]:
        payload = self.fetch_cifra_club_payload(url)
        if not payload:
            raise ValueError("Não foi possível importar a cifra do Cifra Club")

        name = await next_import_variation_name(self.session, song_id, band_id)
        snapshot = build_cifra_variation_snapshot(payload)
        variation = CifraVariation(
            id=_new_id("var"),
            song_id=song_id,
            band_id=band_id,
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

    async def upsert_cifra_variation(
        self,
        song_id: str,
        name: str,
        snapshot: dict[str, Any],
        band_id: str | None = None,
        cifra_club_url: str | None = None,
    ) -> dict[str, Any]:
        trimmed = name.strip()
        if not trimmed:
            raise ValueError("Nome da variação é obrigatório")
        if len(trimmed) > 128:
            raise ValueError("Nome da variação deve ter no máximo 128 caracteres")

        normalized = _normalize_variation_snapshot(snapshot)
        query = select(CifraVariation).where(
            CifraVariation.song_id == song_id,
            func.lower(CifraVariation.name) == trimmed.lower(),
        )
        if band_id is not None:
            query = query.where(CifraVariation.band_id == band_id)
        result = await self.session.execute(query)
        existing = result.scalar_one_or_none()

        if existing is not None:
            existing.name = trimmed
            existing.snapshot_json = json.dumps(normalized)
            if cifra_club_url:
                existing.cifra_club_url = cifra_club_url.strip()
            variation = existing
        else:
            variation = CifraVariation(
                id=_new_id("var"),
                song_id=song_id,
                band_id=band_id,
                name=trimmed,
                snapshot_json=json.dumps(normalized),
                cifra_club_url=cifra_club_url.strip() if cifra_club_url else None,
            )
            self.session.add(variation)

        await self.session.commit()
        await self.session.refresh(variation)
        return serialize_cifra_variation(variation)

    async def delete_cifra_variation(
        self,
        song_id: str,
        variation_id: str,
        band_id: str | None = None,
    ) -> bool:
        query = select(CifraVariation).where(
            CifraVariation.id == variation_id,
            CifraVariation.song_id == song_id,
        )
        if band_id is not None:
            query = query.where(CifraVariation.band_id == band_id)
        result = await self.session.execute(query)
        variation = result.scalar_one_or_none()
        if variation is None:
            return False
        await self.session.delete(variation)
        await self.session.commit()
        return True

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
        try:
            request_cancel(job.id)
        except Exception:
            logger.warning("cancel_flag_failed", job_id=job.id, song_id=song_id, exc_info=True)
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
            try:
                await self.cancel_song_analysis(song_id)
            except Exception:
                logger.warning("delete_cancel_failed", song_id=song_id, exc_info=True)
            song = await self.get_song(song_id)
            if song is None:
                return

        # Soft-delete primeiro: a música some da biblioteca mesmo se o
        # cleanup de arquivos/storage falhar (ex.: pasta vazia após 403 do YT).
        song.deleted_at = datetime.now(UTC)
        await self.session.commit()
        logger.info("song_deleted", song_id=song_id)

        try:
            await self.storage.delete_song(song_id)
        except Exception:
            logger.warning("storage_delete_failed", song_id=song_id, exc_info=True)

    async def process_job(self, job_id: str) -> dict[str, Any]:
        job = await self.get_job(job_id)
        if job is None:
            raise ValueError(f"Job not found: {job_id}")

        song = await self.get_song(job.song_id)
        if song is None:
            raise ValueError(f"Song not found: {job.song_id}")

        if job.status == JobStatus.CANCELLED.value:
            raise AnalysisCancelledError("Análise cancelada pelo usuário")
        if song.deleted_at is not None:
            raise AnalysisCancelledError("Música excluída")

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

            if download.metadata.title and not song.title:
                song.title = download.metadata.title
            if download.metadata.artist and not song.artist:
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
            # Origem local ausente (ex.: offload para o R2): tenta restaurar.
            restored = await self.storage.ensure_source_local(song.id, song.file_path)
            if restored is not None:
                source_path = restored
            else:
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

        existing = await self.get_analysis(song.id)
        payload_text = json.dumps(payload)
        if existing is not None:
            existing.version = payload["version"]
            existing.payload_json = payload_text
            existing.created_at = datetime.now(UTC)
        else:
            self.session.add(
                AnalysisResult(
                    song_id=song.id,
                    version=payload["version"],
                    payload_json=payload_text,
                )
            )
        song.status = SongStatus.COMPLETED.value
        song.duration_seconds = payload["metadata"]["duration_seconds"]
        # Não sobrescreve título/artista já definidos (ex.: nome informado no upload).
        if payload["metadata"].get("title") and not song.title:
            song.title = payload["metadata"]["title"]
        if payload["metadata"].get("artist") and not song.artist:
            song.artist = payload["metadata"]["artist"]
        job.status = JobStatus.COMPLETED.value
        job.stage = "persist"
        job.progress = 100
        job.completed_at = datetime.now(UTC)
        await self.session.commit()
        clear_cancel(job.id)

        # Sobe os artefatos (áudio, stems, cifra) para o storage durável (R2).
        # Falha aqui não invalida a análise já persistida — apenas loga.
        try:
            await self.storage.persist_song_artifacts(song.id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("storage_persist_failed", song_id=song.id, error=str(exc))

        logger.info("analysis_completed", song_id=song.id, job_id=job.id)
        return payload

    async def get_stems_manifest(self, song_id: str) -> dict[str, Any] | None:
        # Restaura o manifest do R2 se ausente localmente (após offload).
        manifest_path = await self.storage.ensure_local_file(song_id, "stems/manifest.json")
        if manifest_path is None:
            # Fallback: manifest só existe localmente (modo local puro).
            stems_dir = Path(self.storage.base_path) / song_id / "stems"
            manifest = DemucsSeparator.load_manifest(stems_dir)
            if manifest is None:
                return None
            return {"song_id": song_id, "separated": True, **manifest}

        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        stems = []
        for item in payload.get("stems", []):
            file = str(item.get("file", ""))
            stems.append({**item, "available": await self.storage.stem_available(song_id, file)})
        payload["stems"] = stems
        return {"song_id": song_id, "separated": True, **payload}

    async def get_playback_target(self, song_id: str, song: Song) -> PlaybackTarget | None:
        return await self.storage.playback_target(song_id, song.file_path)

    async def get_stem_target(self, song_id: str, stem_name: str) -> PlaybackTarget | None:
        manifest_path = await self.storage.ensure_local_file(song_id, "stems/manifest.json")
        if manifest_path is None:
            stem_path = self.resolve_stem_path(song_id, stem_name)
            return PlaybackTarget(kind="local", path=stem_path) if stem_path else None
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        for item in payload.get("stems", []):
            if item.get("name") != stem_name:
                continue
            file = str(item.get("file", ""))
            return await self.storage.stem_target(song_id, file) if file else None
        return None

    async def ensure_source_local(self, song: Song) -> Path | None:
        return await self.storage.ensure_source_local(song.id, song.file_path)

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
        # Mesma prioridade do StorageService.playback_target (HQ primeiro).
        candidates: list[Path] = [
            song_dir / "playback.wav",
            song_dir / "separation_input.wav",
            song_dir / "source.flac",
            song_dir / "source.opus",
            song_dir / "source.webm",
            song_dir / "source.m4a",
            song_dir / "source.wav",
            song_dir / "source.mp3",
        ]
        if song.file_path:
            original = Path(song.file_path)
            if original not in candidates:
                candidates.append(original)
        candidates.extend([song_dir / "trimmed.wav", song_dir / "normalized.wav"])

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

    async def get_cifra_club_sheet(self, song_id: str) -> dict[str, Any] | None:
        # Restaura do R2 se ausente localmente (após offload).
        path = await self.storage.ensure_local_file(song_id, "cifra_club.json")
        if path is None:
            path = Path(self.storage.base_path) / song_id / "cifra_club.json"
        return CifraClubImporter.load(path)
