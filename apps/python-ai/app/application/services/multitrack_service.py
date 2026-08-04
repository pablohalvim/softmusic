"""Multitracks: sessões de áudio enviadas pelo usuário (independente do Demucs)."""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.models import (
    KeyVariantStatus,
    Multitrack,
    MultitrackKeyVariant,
    MultitrackTrack,
)
from app.infrastructure.ml.key_theory import (
    available_chromatic_targets,
    format_key,
    parse_key,
    semitones_between,
    storage_key_segment,
)
from app.infrastructure.storage.service import PlaybackTarget, StorageService
from app.logging import logger

MAX_TRACK_BYTES = 200 * 1024 * 1024
NO_PITCH_ROLES = {"click", "guide", "cue", "metronome", "count"}
ALLOWED_TIME_SIGNATURES = {
    "2/4",
    "3/4",
    "4/4",
    "5/4",
    "6/4",
    "3/8",
    "5/8",
    "6/8",
    "7/8",
    "9/8",
    "12/8",
}
AUDIO_EXTENSIONS = {
    ".mp3",
    ".wav",
    ".wave",
    ".m4a",
    ".aac",
    ".ogg",
    ".oga",
    ".flac",
    ".opus",
    ".wma",
    ".aiff",
    ".aif",
    ".caf",
}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _safe_stem(name: str) -> str:
    base = Path(name).stem.strip() or "track"
    cleaned = re.sub(r"[^\w\-]+", "_", base, flags=re.UNICODE).strip("_")
    return (cleaned or "track")[:80]


def _default_pitch_shift(role: str) -> bool:
    return role.strip().lower() not in NO_PITCH_ROLES


def _normalize_time_signature(value: str | None) -> str:
    raw = (value or "4/4").strip().replace(" ", "")
    if raw not in ALLOWED_TIME_SIGNATURES:
        raise ValueError(
            "Compasso inválido. Use um destes: " + ", ".join(sorted(ALLOWED_TIME_SIGNATURES))
        )
    return raw


class MultitrackService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = StorageService()

    def storage_id(self, multitrack_id: str) -> str:
        return self.storage.multitrack_storage_id(multitrack_id)

    def root_dir(self, multitrack_id: str) -> Path:
        return self.storage.multitrack_dir(multitrack_id)

    async def get(self, multitrack_id: str, band_id: str) -> Multitrack | None:
        result = await self.session.execute(
            select(Multitrack).where(
                Multitrack.id == multitrack_id,
                Multitrack.band_id == band_id,
            )
        )
        return result.scalar_one_or_none()

    async def counts_for_songs(
        self, band_id: str, song_ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        """Retorna {song_id: {count, primary_multitrack_id}} para a banda."""
        if not song_ids:
            return {}
        result = await self.session.execute(
            select(Multitrack.song_id, Multitrack.id, Multitrack.updated_at)
            .where(
                Multitrack.band_id == band_id,
                Multitrack.song_id.in_(song_ids),
            )
            .order_by(Multitrack.updated_at.desc())
        )
        out: dict[str, dict[str, Any]] = {}
        for song_id, mt_id, _updated in result.all():
            if not song_id:
                continue
            entry = out.get(song_id)
            if entry is None:
                out[song_id] = {"count": 1, "primary_multitrack_id": mt_id}
            else:
                entry["count"] = int(entry["count"]) + 1
        return out

    async def list_for_band(
        self,
        band_id: str,
        *,
        song_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Multitrack], int]:
        filters = [Multitrack.band_id == band_id]
        if song_id:
            filters.append(Multitrack.song_id == song_id)
        count = await self.session.execute(
            select(func.count()).select_from(Multitrack).where(*filters)
        )
        total = int(count.scalar_one())
        result = await self.session.execute(
            select(Multitrack)
            .where(*filters)
            .order_by(Multitrack.updated_at.desc())
            .offset(max(0, offset))
            .limit(max(1, min(limit, 100)))
        )
        return list(result.scalars().all()), total

    async def create(
        self,
        *,
        band_id: str,
        title: str,
        source_key: str,
        source_mode: str | None = None,
        song_id: str | None = None,
        bpm: float | None = None,
        time_signature: str | None = None,
        notes: str | None = None,
        created_by_user_id: str | None = None,
    ) -> Multitrack:
        title_clean = (title or "").strip()
        if not title_clean:
            raise ValueError("Título é obrigatório")
        root, is_minor = parse_key(source_key, source_mode)
        if source_mode and source_mode.strip().lower() in {"minor", "m"}:
            is_minor = True
        elif source_mode and source_mode.strip().lower() in {"major"}:
            is_minor = False
        mode = "minor" if is_minor else "major"
        compass = _normalize_time_signature(time_signature)

        mt = Multitrack(
            id=_new_id("mt"),
            band_id=band_id,
            song_id=song_id.strip() if song_id else None,
            title=title_clean[:255],
            source_key=root,
            source_mode=mode,
            bpm=bpm,
            time_signature=compass,
            notes=notes.strip() if notes else None,
            created_by_user_id=created_by_user_id,
        )

        self.session.add(mt)
        self.root_dir(mt.id).mkdir(parents=True, exist_ok=True)
        (self.root_dir(mt.id) / "tracks").mkdir(parents=True, exist_ok=True)
        await self.session.commit()
        await self.session.refresh(mt)
        return mt

    async def update_meta(
        self,
        multitrack_id: str,
        band_id: str,
        *,
        title: str | None = None,
        bpm: float | None = None,
        time_signature: str | None = None,
        notes: str | None = None,
        song_id: str | None = None,
        clear_song: bool = False,
        source_key: str | None = None,
        source_mode: str | None = None,
    ) -> Multitrack:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        if title is not None:
            clean = title.strip()
            if not clean:
                raise ValueError("Título é obrigatório")
            mt.title = clean[:255]
        if bpm is not None:
            mt.bpm = bpm
        if time_signature is not None:
            mt.time_signature = _normalize_time_signature(time_signature)
        if notes is not None:
            mt.notes = notes.strip() or None
        if clear_song:
            mt.song_id = None
        elif song_id is not None:
            mt.song_id = song_id.strip() or None

        key_changed = False
        if source_key is not None or source_mode is not None:
            next_key = source_key if source_key is not None else mt.source_key
            next_mode = source_mode if source_mode is not None else mt.source_mode
            root, is_minor = parse_key(next_key, next_mode)
            if source_mode and source_mode.strip().lower() in {"minor", "m"}:
                is_minor = True
            elif source_mode and source_mode.strip().lower() in {"major"}:
                is_minor = False
            mode = "minor" if is_minor else "major"
            old_label = format_key(*parse_key(mt.source_key, mt.source_mode))
            new_label = format_key(root, is_minor)
            if old_label != new_label or mt.source_mode != mode:
                key_changed = True
                mt.source_key = root
                mt.source_mode = mode

        mt.updated_at = datetime.now(UTC)
        if key_changed:
            # Variantes antigas deixam de ser válidas com o novo tom base.
            await self._clear_key_variants(mt.id)
        await self.session.commit()
        await self.session.refresh(mt)
        return mt

    async def _clear_key_variants(self, multitrack_id: str) -> None:
        variants = await self._variants(multitrack_id)
        for variant in variants:
            await self.session.delete(variant)
        keys_dir = self.root_dir(multitrack_id) / "keys"
        if keys_dir.exists():
            shutil.rmtree(keys_dir, ignore_errors=True)

    async def delete(self, multitrack_id: str, band_id: str) -> None:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        tracks = await self._tracks(mt.id)
        for track in tracks:
            await self.session.delete(track)
        variants = await self._variants(mt.id)
        for variant in variants:
            await self.session.delete(variant)
        await self.session.delete(mt)
        await self.session.commit()
        await self.storage.delete_multitrack(mt.id)

    async def _tracks(self, multitrack_id: str) -> list[MultitrackTrack]:
        result = await self.session.execute(
            select(MultitrackTrack)
            .where(MultitrackTrack.multitrack_id == multitrack_id)
            .order_by(MultitrackTrack.sort_order.asc(), MultitrackTrack.created_at.asc())
        )
        return list(result.scalars().all())

    async def _variants(self, multitrack_id: str) -> list[MultitrackKeyVariant]:
        result = await self.session.execute(
            select(MultitrackKeyVariant)
            .where(MultitrackKeyVariant.multitrack_id == multitrack_id)
            .order_by(MultitrackKeyVariant.created_at.desc())
        )
        return list(result.scalars().all())

    async def add_track(
        self,
        multitrack_id: str,
        band_id: str,
        *,
        filename: str,
        content: bytes,
        name: str | None = None,
        role: str | None = None,
    ) -> MultitrackTrack:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        if not content:
            raise ValueError("Arquivo vazio")
        if len(content) > MAX_TRACK_BYTES:
            raise ValueError("Arquivo excede o limite de 200 MB")

        ext = Path(filename or "track.mp3").suffix.lower() or ".mp3"
        if ext not in AUDIO_EXTENSIONS and not (filename or "").lower().startswith("audio"):
            # Ainda permite se a extensão for desconhecida mas o cliente mandou como áudio
            if ext and ext not in AUDIO_EXTENSIONS:
                logger.info("multitrack_unusual_extension", ext=ext, filename=filename)

        role_clean = (role or "other").strip().lower()[:64] or "other"
        display = (name or _safe_stem(filename)).strip()[:128] or "Faixa"
        track_id = _new_id("mtt")
        stored_name = f"{track_id}{ext if ext in AUDIO_EXTENSIONS else '.bin'}"

        tracks_dir = self.root_dir(mt.id) / "tracks"
        tracks_dir.mkdir(parents=True, exist_ok=True)
        dest = tracks_dir / stored_name
        dest.write_bytes(content)

        duration = await asyncio.to_thread(self._probe_duration, dest)
        # Converte para wav quando possível (player/pitch-shift estáveis)
        wav_name = f"{track_id}.wav"
        wav_path = tracks_dir / wav_name
        converted = await asyncio.to_thread(self._ensure_wav, dest, wav_path)
        if converted:
            if dest != wav_path and dest.exists():
                dest.unlink(missing_ok=True)
            stored_name = wav_name
            duration = await asyncio.to_thread(self._probe_duration, wav_path)

        count = await self.session.execute(
            select(func.count())
            .select_from(MultitrackTrack)
            .where(MultitrackTrack.multitrack_id == mt.id)
        )
        sort_order = int(count.scalar_one())

        track = MultitrackTrack(
            id=track_id,
            multitrack_id=mt.id,
            name=display,
            role=role_clean,
            file_name=stored_name,
            original_file_name=(filename or stored_name)[:255],
            duration_seconds=duration,
            sort_order=sort_order,
            gain=1.0,
            muted=False,
            pitch_shift=_default_pitch_shift(role_clean),
        )
        self.session.add(track)
        mt.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(track)
        try:
            await self.storage.persist_multitrack_artifacts(mt.id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("multitrack_persist_failed", multitrack_id=mt.id, error=str(exc))
        return track

    @staticmethod
    def _probe_duration(path: Path) -> float | None:
        try:
            import librosa

            return round(float(librosa.get_duration(path=str(path))), 3)
        except Exception:
            return None

    @staticmethod
    def _ensure_wav(src: Path, dest: Path) -> bool:
        try:
            from pydub import AudioSegment

            audio = AudioSegment.from_file(src)
            audio.export(dest, format="wav", parameters=["-acodec", "pcm_s16le"])
            return dest.exists()
        except Exception:
            if src.suffix.lower() == ".wav":
                if src != dest:
                    shutil.copy2(src, dest)
                return dest.exists()
            return False

    async def update_track(
        self,
        multitrack_id: str,
        band_id: str,
        track_id: str,
        *,
        name: str | None = None,
        role: str | None = None,
        gain: float | None = None,
        muted: bool | None = None,
        pitch_shift: bool | None = None,
        sort_order: int | None = None,
    ) -> MultitrackTrack:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        result = await self.session.execute(
            select(MultitrackTrack).where(
                MultitrackTrack.id == track_id,
                MultitrackTrack.multitrack_id == mt.id,
            )
        )
        track = result.scalar_one_or_none()
        if track is None:
            raise ValueError("Faixa não encontrada")
        if name is not None:
            clean = name.strip()
            if not clean:
                raise ValueError("Nome da faixa é obrigatório")
            track.name = clean[:128]
        if role is not None:
            track.role = role.strip().lower()[:64] or "other"
        if gain is not None:
            track.gain = max(0.0, min(2.0, float(gain)))
        if muted is not None:
            track.muted = bool(muted)
        if pitch_shift is not None:
            track.pitch_shift = bool(pitch_shift)
        if sort_order is not None:
            track.sort_order = int(sort_order)
        mt.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(track)
        return track

    async def delete_track(self, multitrack_id: str, band_id: str, track_id: str) -> None:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        result = await self.session.execute(
            select(MultitrackTrack).where(
                MultitrackTrack.id == track_id,
                MultitrackTrack.multitrack_id == mt.id,
            )
        )
        track = result.scalar_one_or_none()
        if track is None:
            raise ValueError("Faixa não encontrada")
        path = self.root_dir(mt.id) / "tracks" / track.file_name
        await self.session.delete(track)
        mt.updated_at = datetime.now(UTC)
        await self.session.commit()
        if path.exists():
            path.unlink(missing_ok=True)

    async def track_audio_target(
        self,
        multitrack_id: str,
        band_id: str,
        track_id: str,
        *,
        key: str | None = None,
    ) -> PlaybackTarget | None:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            return None
        result = await self.session.execute(
            select(MultitrackTrack).where(
                MultitrackTrack.id == track_id,
                MultitrackTrack.multitrack_id == mt.id,
            )
        )
        track = result.scalar_one_or_none()
        if track is None:
            return None

        if key:
            root, is_minor = parse_key(key, mt.source_mode)
            label = format_key(root, is_minor)
            source_label = format_key(*parse_key(mt.source_key, mt.source_mode))
            if label != source_label:
                variant = await self.get_key_variant(mt.id, label)
                if variant is None or variant.status != KeyVariantStatus.READY.value:
                    return None
                rel = f"{variant.storage_prefix}/tracks/{track.id}.wav"
                return await self.storage.multitrack_file_target(mt.id, rel)

        rel = f"tracks/{track.file_name}"
        return await self.storage.multitrack_file_target(mt.id, rel)

    async def get_key_variant(self, multitrack_id: str, target_key: str) -> MultitrackKeyVariant | None:
        root, is_minor = parse_key(target_key)
        label = format_key(root, is_minor)
        result = await self.session.execute(
            select(MultitrackKeyVariant).where(
                MultitrackKeyVariant.multitrack_id == multitrack_id,
                MultitrackKeyVariant.target_key == label,
            )
        )
        return result.scalar_one_or_none()

    async def list_keys(self, multitrack_id: str, band_id: str) -> dict[str, Any]:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        source_label = format_key(*parse_key(mt.source_key, mt.source_mode))
        variants = await self._variants(mt.id)
        available = available_chromatic_targets(mt.source_key, mt.source_mode)
        occupied = {v.target_key for v in variants if v.status != KeyVariantStatus.FAILED.value}
        return {
            "source_key": source_label,
            "source_mode": mt.source_mode,
            "available_targets": [k for k in available if k not in occupied],
            "variants": [self.serialize_variant(v) for v in variants],
        }

    async def request_key_variant(
        self, multitrack_id: str, band_id: str, target_key: str
    ) -> dict[str, Any]:
        mt = await self.get(multitrack_id, band_id)
        if mt is None:
            raise ValueError("Multitrack não encontrado")
        tracks = await self._tracks(mt.id)
        if not tracks:
            raise ValueError("Envie ao menos uma faixa antes de converter o tom")

        root, is_minor = parse_key(target_key, mt.source_mode)
        label = format_key(root, is_minor)
        source_label = format_key(*parse_key(mt.source_key, mt.source_mode))
        if label == source_label:
            raise ValueError("O tom alvo é o mesmo do Multitrack")

        existing = await self.get_key_variant(mt.id, label)
        if existing and existing.status in {
            KeyVariantStatus.QUEUED.value,
            KeyVariantStatus.PROCESSING.value,
        }:
            return {
                **self.serialize_variant(existing),
                "message": "Conversão já em andamento",
            }
        if existing and existing.status == KeyVariantStatus.READY.value:
            return {**self.serialize_variant(existing), "message": "Tom já disponível"}

        semitones = semitones_between(mt.source_key, label, mt.source_mode)
        prefix = f"keys/{storage_key_segment(label)}"
        if existing:
            variant = existing
            variant.semitones = semitones
            variant.status = KeyVariantStatus.QUEUED.value
            variant.progress = 0
            variant.error = None
            variant.storage_prefix = prefix
        else:
            variant = MultitrackKeyVariant(
                id=_new_id("mtk"),
                multitrack_id=mt.id,
                target_key=label,
                semitones=semitones,
                status=KeyVariantStatus.QUEUED.value,
                progress=0,
                storage_prefix=prefix,
            )
            self.session.add(variant)
        await self.session.commit()
        await self.session.refresh(variant)
        return self.serialize_variant(variant)

    async def process_key_variant(self, variant_id: str) -> dict[str, Any]:
        from app.infrastructure.ml.pitch_shifter import PitchShifter

        result = await self.session.execute(
            select(MultitrackKeyVariant).where(MultitrackKeyVariant.id == variant_id)
        )
        variant = result.scalar_one_or_none()
        if variant is None:
            raise ValueError("Variante não encontrada")
        mt_result = await self.session.execute(
            select(Multitrack).where(Multitrack.id == variant.multitrack_id)
        )
        mt = mt_result.scalar_one_or_none()
        if mt is None:
            raise ValueError("Multitrack não encontrado")

        variant.status = KeyVariantStatus.PROCESSING.value
        variant.progress = 10
        variant.error = None
        await self.session.commit()

        tracks = await self._tracks(mt.id)
        storage_id = self.storage_id(mt.id)
        for track in tracks:
            restored = await self.storage.ensure_local_file(
                storage_id, f"tracks/{track.file_name}"
            )
            if restored is None:
                raise ValueError(f"Faixa ausente: {track.name}")

        source_dir = self.root_dir(mt.id)
        output_dir = source_dir / variant.storage_prefix
        if output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        variant.progress = 30
        await self.session.commit()

        payload_tracks = [
            {
                "id": t.id,
                "name": t.name,
                "role": t.role,
                "file_name": t.file_name,
                "pitch_shift": t.pitch_shift,
            }
            for t in tracks
        ]
        shifter = PitchShifter()
        await asyncio.to_thread(
            shifter.shift_multitrack_files,
            tracks=payload_tracks,
            source_dir=source_dir,
            output_dir=output_dir,
            source_key=format_key(*parse_key(mt.source_key, mt.source_mode)),
            target_key=variant.target_key,
            semitones=variant.semitones,
        )

        variant.progress = 85
        await self.session.commit()
        try:
            await self.storage.persist_multitrack_key_variant(mt.id, variant.storage_prefix)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "multitrack_key_persist_failed",
                multitrack_id=mt.id,
                error=str(exc),
            )

        variant.status = KeyVariantStatus.READY.value
        variant.progress = 100
        variant.error = None
        await self.session.commit()
        return self.serialize_variant(variant)

    def serialize_track(self, track: MultitrackTrack) -> dict[str, Any]:
        return {
            "id": track.id,
            "name": track.name,
            "role": track.role,
            "file_name": track.file_name,
            "original_file_name": track.original_file_name,
            "duration_seconds": track.duration_seconds,
            "sort_order": track.sort_order,
            "gain": track.gain,
            "muted": track.muted,
            "pitch_shift": track.pitch_shift,
            "created_at": track.created_at.isoformat(),
            "updated_at": track.updated_at.isoformat(),
        }

    def serialize_variant(self, variant: MultitrackKeyVariant) -> dict[str, Any]:
        return {
            "id": variant.id,
            "multitrack_id": variant.multitrack_id,
            "target_key": variant.target_key,
            "semitones": variant.semitones,
            "status": variant.status,
            "progress": variant.progress,
            "error": variant.error,
            "storage_prefix": variant.storage_prefix,
            "created_at": variant.created_at.isoformat(),
            "updated_at": variant.updated_at.isoformat(),
        }

    async def serialize(
        self, mt: Multitrack, *, include_tracks: bool = True, include_keys: bool = True
    ) -> dict[str, Any]:
        source_label = format_key(*parse_key(mt.source_key, mt.source_mode))
        payload: dict[str, Any] = {
            "id": mt.id,
            "band_id": mt.band_id,
            "song_id": mt.song_id,
            "title": mt.title,
            "source_key": source_label,
            "source_mode": mt.source_mode,
            "bpm": mt.bpm,
            "time_signature": getattr(mt, "time_signature", None) or "4/4",
            "notes": mt.notes,
            "created_by_user_id": mt.created_by_user_id,
            "created_at": mt.created_at.isoformat(),
            "updated_at": mt.updated_at.isoformat(),
            "track_count": 0,
        }
        if include_tracks:
            tracks = await self._tracks(mt.id)
            payload["tracks"] = [self.serialize_track(t) for t in tracks]
            payload["track_count"] = len(tracks)
        else:
            count = await self.session.execute(
                select(func.count())
                .select_from(MultitrackTrack)
                .where(MultitrackTrack.multitrack_id == mt.id)
            )
            payload["track_count"] = int(count.scalar_one())
        variants = await self._variants(mt.id)
        ready_keys = [source_label] + [
            v.target_key
            for v in variants
            if v.status == KeyVariantStatus.READY.value and v.target_key != source_label
        ]
        payload["ready_keys"] = ready_keys
        if include_keys:
            payload["key_variants"] = [self.serialize_variant(v) for v in variants]
        return payload
