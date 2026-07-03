from __future__ import annotations

import json
import mimetypes
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.analysis_service import AnalysisService
from app.application.services.band_service import BandService
from app.domain.interfaces.source_downloader import is_youtube_url
from app.infrastructure.database.models import Song, SongStatus, User
from app.infrastructure.database.session import get_session
from app.presentation.api.deps import get_band_id, get_current_user
from app.worker import run_analysis

router = APIRouter(prefix="/internal", tags=["internal"])


async def _ensure_song_access(
    session: AsyncSession, band_id: str | None, user_id: str, song_id: str
) -> None:
    if not band_id:
        raise HTTPException(status_code=400, detail="Header X-Band-Id é obrigatório")
    band_service = BandService(session)
    try:
        await band_service.require_view_access(band_id, user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not await band_service.song_linked_to_band(band_id, song_id):
        raise HTTPException(status_code=404, detail="Música não encontrada nesta banda")
    song_result = await session.execute(select(Song).where(Song.id == song_id, Song.deleted_at.is_(None)))
    song = song_result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Música não encontrada")
    if song.moderation_status == "blocked":
        raise HTTPException(status_code=403, detail="Esta música foi bloqueada pela moderação")


async def _ensure_job_access(
    session: AsyncSession, band_id: str | None, user_id: str, job_id: str
) -> Any:
    service = AnalysisService(session)
    job = await service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await _ensure_song_access(session, band_id, user_id, job.song_id)
    return job


class AnalyzeBody(BaseModel):
    source: dict[str, Any]
    options: dict[str, Any] | None = None


class JobResponse(BaseModel):
    job_id: str | None = None
    song_id: str
    duplicate: bool = False
    message: str | None = None
    variation: dict[str, Any] | None = None


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    from app.infrastructure.ml.device import device_info_as_dict

    await session.execute(text("SELECT 1"))
    gpu = device_info_as_dict()
    return {
        "status": "healthy",
        "gpu_available": str(gpu["available"]).lower(),
        "gpu_device": gpu["device_name"] or "",
        "gpu_backend": gpu["backend"],
    }


@router.post("/songs/analyze")
async def analyze(
    body: AnalyzeBody,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    if not band_id:
        raise HTTPException(status_code=400, detail="Header X-Band-Id é obrigatório")
    band_service = BandService(session)
    try:
        await band_service.require_analyze_access(band_id, user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    service = AnalysisService(session)
    source = body.source
    source_type = source.get("type")
    if source_type == "upload":
        raise HTTPException(status_code=400, detail="Use /songs/upload for file uploads")
    source_ref = source.get("url") or source.get("file_id")
    if not source_ref:
        raise HTTPException(status_code=400, detail="Invalid source reference")
    if source_type == "youtube" and not is_youtube_url(str(source_ref)):
        raise HTTPException(status_code=400, detail="URL do YouTube inválida")

    options = body.options or {}
    cifra_club_url = options.get("cifra_club_url")
    if cifra_club_url:
        from app.infrastructure.cifra.cifraclub_importer import is_cifra_club_url

        if not is_cifra_club_url(str(cifra_club_url)):
            raise HTTPException(status_code=400, detail="URL do Cifra Club inválida")

    if source_type == "youtube":
        existing = await service.find_song_by_youtube_video_id(str(source_ref))
        if existing:
            cifra_str = (
                cifra_club_url.strip()
                if isinstance(cifra_club_url, str) and cifra_club_url.strip()
                else None
            )
            if cifra_str:
                try:
                    variation = await service.add_cifra_variation_from_cifra_club(existing.id, cifra_str)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
                await band_service.link_song(band_id, existing.id, user.id)
                return {
                    "duplicate": True,
                    "song_id": existing.id,
                    "job_id": None,
                    "message": f'Música já importada. Variação "{variation["name"]}" criada.',
                    "variation": variation,
                }
            await band_service.link_song(band_id, existing.id, user.id)
            return {
                "duplicate": True,
                "song_id": existing.id,
                "job_id": None,
                "message": "Esta música do YouTube já foi importada.",
                "variation": None,
            }

    song, job = await service.create_from_source(str(source_type), str(source_ref), body.options)
    await band_service.link_song(band_id, song.id, user.id)
    run_analysis.delay(job.id)
    return {
        "duplicate": False,
        "job_id": job.id,
        "song_id": song.id,
        "variation": None,
    }


@router.post("/songs/upload", response_model=JobResponse)
async def upload_song(
    file: UploadFile = File(...),
    options: str | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> JobResponse:
    if not band_id:
        raise HTTPException(status_code=400, detail="Header X-Band-Id é obrigatório")
    band_service = BandService(session)
    try:
        await band_service.require_analyze_access(band_id, user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    service = AnalysisService(session)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    parsed_options = json.loads(options) if options else None
    if parsed_options and parsed_options.get("cifra_club_url"):
        from app.infrastructure.cifra.cifraclub_importer import is_cifra_club_url

        if not is_cifra_club_url(str(parsed_options["cifra_club_url"])):
            raise HTTPException(status_code=400, detail="URL do Cifra Club inválida")
    song, job = await service.create_from_upload(file.filename or "upload.bin", content, parsed_options)
    await band_service.link_song(band_id, song.id, user.id)
    run_analysis.delay(job.id)
    return {"duplicate": False, "job_id": job.id, "song_id": song.id, "variation": None}


def _serialize_job(job: Any) -> dict[str, Any]:
    return {
        "id": job.id,
        "song_id": job.song_id,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


def _serialize_song(song: Any) -> dict[str, Any]:
    return {
        "id": song.id,
        "title": song.title,
        "artist": song.artist,
        "duration_seconds": song.duration_seconds,
        "status": song.status,
        "source_type": song.source_type,
        "youtube_url": song.youtube_url,
        "cifra_club_url": song.cifra_club_url,
        "created_at": song.created_at.isoformat(),
        "updated_at": song.updated_at.isoformat(),
    }


@router.get("/dashboard/stats")
async def dashboard_stats(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    if not band_id:
        raise HTTPException(status_code=400, detail="Header X-Band-Id é obrigatório")
    band_service = BandService(session)
    try:
        await band_service.require_view_access(band_id, user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    songs, total = await band_service.list_band_songs(band_id, limit=500)
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    by_status = {s: 0 for s in ("pending", "processing", "completed", "failed")}
    for song in songs:
        if song.status in by_status:
            by_status[song.status] += 1
    recent = sorted(songs, key=lambda s: s.updated_at, reverse=True)[:6]
    return {
        "generated_at": now.isoformat(),
        "songs": {
            "total": total,
            "completed": by_status["completed"],
            "failed": by_status["failed"],
            "pending": by_status["pending"],
            "processing": by_status["processing"],
        },
        "jobs": {"queued": 0, "processing": by_status["pending"] + by_status["processing"]},
        "pipeline": {
            "average_duration_seconds": None,
            "success_rate_24h": None,
            "completed_24h": 0,
            "failed_24h": 0,
        },
        "recent_songs": [
            {
                "id": song.id,
                "title": song.title,
                "artist": song.artist,
                "status": song.status,
                "updated_at": song.updated_at.isoformat(),
            }
            for song in recent
        ],
        "active_jobs": [],
    }


@router.get("/songs")
async def list_songs(
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    if not band_id:
        raise HTTPException(status_code=400, detail="Header X-Band-Id é obrigatório")
    band_service = BandService(session)
    try:
        await band_service.require_view_access(band_id, user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    songs, total = await band_service.list_band_songs(band_id, limit=limit, offset=offset)
    return {
        "items": [_serialize_song(song) for song in songs],
        "total": total,
        "limit": max(1, min(limit, 100)),
        "offset": max(0, offset),
    }


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    job = await _ensure_job_access(session, band_id, user.id, job_id)
    return _serialize_job(job)


@router.get("/songs/{song_id}/job")
async def get_song_job(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    job = await service.get_latest_job_for_song(song_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize_job(job)


@router.get("/songs/{song_id}")
async def get_song(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    song = await service.get_song(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return _serialize_song(song)


@router.delete("/songs/{song_id}")
async def delete_song(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, str]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    try:
        await service.delete_song(song_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted", "song_id": song_id}


@router.post("/songs/{song_id}/cancel")
async def cancel_song_analysis(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    try:
        job = await service.cancel_song_analysis(song_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _serialize_job(job)


@router.get("/songs/{song_id}/analysis")
async def get_analysis(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    result = await service.get_analysis(song_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return json.loads(result.payload_json)


@router.get("/songs/{song_id}/timeline")
async def get_timeline(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    analysis = await get_analysis(song_id, session, user, band_id)
    return {"song_id": song_id, "sections": analysis["structure"]["sections"]}


@router.get("/songs/{song_id}/cifra-variations")
async def list_cifra_variations(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    items = await service.list_cifra_variations(song_id)
    return {"items": items}


class ImportCifraVariationBody(BaseModel):
    cifra_club_url: str = Field(min_length=1)


@router.post("/songs/{song_id}/cifra-variations")
async def import_cifra_variation(
    song_id: str,
    body: ImportCifraVariationBody,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    from app.infrastructure.cifra.cifraclub_importer import is_cifra_club_url

    if not band_id:
        raise HTTPException(status_code=400, detail="Header X-Band-Id é obrigatório")
    band_service = BandService(session)
    try:
        await band_service.require_analyze_access(band_id, user.id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    await _ensure_song_access(session, band_id, user.id, song_id)

    service = AnalysisService(session)
    song = await service.get_song(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.status != SongStatus.COMPLETED.value:
        raise HTTPException(status_code=400, detail="A análise da música ainda não foi concluída")

    url = body.cifra_club_url.strip()
    if not is_cifra_club_url(url):
        raise HTTPException(status_code=400, detail="URL do Cifra Club inválida")

    try:
        variation = await service.add_cifra_variation_from_cifra_club(song_id, url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"variation": variation}


@router.get("/songs/{song_id}/chords")
async def get_chords(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    analysis = await get_analysis(song_id, session, user, band_id)
    service = AnalysisService(session)
    song = await service.get_song(song_id)
    imported = service.get_cifra_club_sheet(song_id)
    if imported:
        key = imported.get("key") or analysis["harmony"]["key"]
        mode = imported.get("mode") or analysis["harmony"]["mode"]
        return {
            "song_id": song_id,
            "title": song.title if song else imported.get("title"),
            "artist": song.artist if song else imported.get("artist"),
            "key": key,
            "mode": mode,
            "tempo_bpm": analysis["harmony"]["tempo_bpm"],
            "progression": analysis["harmony"]["chord_progression"],
            "sections": analysis["structure"]["sections"],
            "scale": analysis["harmony"]["scale"],
            "source": "cifra_club",
            "cifra_club_url": imported.get("url"),
            "cifra_sheet": {
                "original_key": key,
                "mode": mode,
                "tempo_bpm": analysis["harmony"]["tempo_bpm"],
                "sections": imported.get("sections", []),
            },
            "separated": bool(analysis.get("guitar", {}).get("separated")),
        }

    progression = analysis["harmony"]["chord_progression"]
    guitar = analysis.get("guitar")
    if isinstance(guitar, dict) and guitar.get("chord_progression"):
        progression = guitar["chord_progression"]
    return {
        "song_id": song_id,
        "title": song.title if song else None,
        "artist": song.artist if song else None,
        "key": analysis["harmony"]["key"],
        "mode": analysis["harmony"]["mode"],
        "tempo_bpm": analysis["harmony"]["tempo_bpm"],
        "progression": progression,
        "sections": analysis["structure"]["sections"],
        "scale": analysis["harmony"]["scale"],
        "source": "analysis",
        "source_stem": guitar.get("source_stem") if isinstance(guitar, dict) else "mix",
        "separated": bool(isinstance(guitar, dict) and guitar.get("separated")),
    }


@router.get("/songs/{song_id}/waveform")
async def get_waveform(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    from pathlib import Path

    from app.application.services.audio_pipeline import write_waveform_peaks

    service = AnalysisService(session)
    song = await service.get_song(song_id)
    if song is None or not song.file_path:
        raise HTTPException(status_code=404, detail="Song audio not found")
    peaks = write_waveform_peaks(Path(song.file_path))
    return {"song_id": song_id, "peaks": peaks}


@router.get("/songs/{song_id}/audio")
async def get_audio(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> FileResponse:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    song = await service.get_song(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    audio_path = service.resolve_playback_path(song_id, song)
    if audio_path is None:
        raise HTTPException(status_code=404, detail="Song audio not found")

    media_type, _ = mimetypes.guess_type(str(audio_path))
    if not media_type:
        media_type = "audio/wav" if audio_path.suffix.lower() == ".wav" else "application/octet-stream"

    return FileResponse(
        path=audio_path,
        media_type=media_type,
        filename=audio_path.name,
        headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"},
    )


@router.get("/songs/{song_id}/stems")
async def get_stems(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    song = await service.get_song(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    manifest = service.get_stems_manifest(song_id)
    if manifest is None:
        return {
            "song_id": song_id,
            "separated": False,
            "stems": [],
            "message": "Stems ainda não disponíveis. Reprocesse a análise para gerar separação Demucs.",
        }
    return manifest


@router.get("/songs/{song_id}/stems/{stem_name}/audio")
async def get_stem_audio(
    song_id: str,
    stem_name: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> FileResponse:
    await _ensure_song_access(session, band_id, user.id, song_id)
    service = AnalysisService(session)
    song = await service.get_song(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    stem_path = service.resolve_stem_path(song_id, stem_name)
    if stem_path is None:
        raise HTTPException(status_code=404, detail="Stem audio not found")

    media_type, _ = mimetypes.guess_type(str(stem_path))
    if media_type is None:
        media_type = "audio/wav" if stem_path.suffix.lower() == ".wav" else "application/octet-stream"

    return FileResponse(
        path=stem_path,
        media_type=media_type,
        filename=stem_path.name,
        headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"},
    )


@router.get("/songs/{song_id}/lyrics")
async def get_lyrics(
    song_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    band_id: str | None = Depends(get_band_id),
) -> dict[str, Any]:
    await _ensure_song_access(session, band_id, user.id, song_id)
    return {"song_id": song_id, "lyrics": [], "message": "Lyrics alignment requires Whisper pipeline"}
