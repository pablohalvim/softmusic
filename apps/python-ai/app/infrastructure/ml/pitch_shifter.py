"""Pitch-shift existing Demucs stems and remix playback for a key variant."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.logging import logger
from app.infrastructure.ml.demucs_separator import STEM_ROLES


@dataclass(frozen=True)
class PitchShiftResult:
    target_key: str
    source_key: str
    semitones: int
    output_dir: Path
    playback_path: Path
    stems_dir: Path
    manifest: dict[str, Any]


class PitchShifter:
    """Shift each stem by N semitones (librosa) and write remix + manifest."""

    def __init__(self, method: str = "librosa") -> None:
        self.method = method

    def shift_stems(
        self,
        *,
        source_stems_dir: Path,
        output_dir: Path,
        source_key: str,
        target_key: str,
        semitones: int,
        source_manifest: dict[str, Any] | None = None,
    ) -> PitchShiftResult:
        import librosa
        import soundfile as sf

        if semitones == 0:
            raise ValueError("semitones must be non-zero for a key variant")

        stems_out = output_dir / "stems"
        stems_out.mkdir(parents=True, exist_ok=True)

        manifest_stems = (source_manifest or {}).get("stems") or []
        if not manifest_stems:
            # Fallback: every *.wav in the source stems dir except manifest.
            manifest_stems = [
                {
                    "name": path.stem,
                    "file": path.name,
                    "role": STEM_ROLES.get(path.stem, path.stem),
                }
                for path in sorted(source_stems_dir.glob("*.wav"))
            ]

        if not manifest_stems:
            raise ValueError("Nenhum stem disponível para pitch-shift")

        shifted: list[tuple[str, np.ndarray, int, dict[str, Any]]] = []
        sample_rate: int | None = None

        for item in manifest_stems:
            name = str(item.get("name") or "")
            file_name = str(item.get("file") or f"{name}.wav")
            if not name:
                continue
            src = source_stems_dir / file_name
            if not src.exists():
                raise FileNotFoundError(f"Stem ausente: {file_name}")

            y, sr = librosa.load(str(src), sr=None, mono=False)
            if y.ndim == 1:
                y = y[np.newaxis, :]
            if sample_rate is None:
                sample_rate = int(sr)
            elif int(sr) != sample_rate:
                # Align to first stem SR.
                channels = [
                    librosa.resample(y[ch], orig_sr=sr, target_sr=sample_rate)
                    for ch in range(y.shape[0])
                ]
                y = np.stack(channels, axis=0)

            assert sample_rate is not None
            shifted_channels = [
                librosa.effects.pitch_shift(y[ch], sr=sample_rate, n_steps=semitones)
                for ch in range(y.shape[0])
            ]
            y_shift = np.stack(shifted_channels, axis=0)
            shifted.append((name, y_shift, sample_rate, item))

        assert sample_rate is not None

        # Align lengths (librosa can differ by a few samples).
        max_len = max(audio.shape[-1] for _, audio, _, _ in shifted)
        remix = np.zeros((shifted[0][1].shape[0], max_len), dtype=np.float32)

        out_stem_items: list[dict[str, Any]] = []
        for name, audio, sr, item in shifted:
            if audio.shape[-1] < max_len:
                pad = max_len - audio.shape[-1]
                audio = np.pad(audio, ((0, 0), (0, pad)))
            elif audio.shape[-1] > max_len:
                audio = audio[..., :max_len]

            out_path = stems_out / f"{name}.wav"
            # soundfile expects (frames, channels)
            sf.write(str(out_path), audio.T, sr, subtype="PCM_16")
            remix += audio.astype(np.float32)
            duration = round(float(audio.shape[-1] / sr), 3)
            out_stem_items.append(
                {
                    "name": name,
                    "file": out_path.name,
                    "path": str(out_path),
                    "duration_seconds": duration,
                    "role": item.get("role", STEM_ROLES.get(name, name)),
                }
            )

        # Soft clip remix to avoid overs from stem sum.
        peak = float(np.max(np.abs(remix))) if remix.size else 0.0
        if peak > 1.0:
            remix = remix / peak * 0.99

        playback_path = output_dir / "playback.wav"
        sf.write(str(playback_path), remix.T, sample_rate, subtype="PCM_16")

        manifest: dict[str, Any] = {
            "model": (source_manifest or {}).get("model", "pitch_shift"),
            "backend": (source_manifest or {}).get("backend", "cpu"),
            "method": self.method,
            "source_key": source_key,
            "target_key": target_key,
            "semitones": semitones,
            "generated_at": datetime.now(UTC).isoformat(),
            "stems": out_stem_items,
        }
        (stems_out / "manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

        logger.info(
            "pitch_shift_completed",
            source_key=source_key,
            target_key=target_key,
            semitones=semitones,
            stems=[item["name"] for item in out_stem_items],
        )
        return PitchShiftResult(
            target_key=target_key,
            source_key=source_key,
            semitones=semitones,
            output_dir=output_dir,
            playback_path=playback_path,
            stems_dir=stems_out,
            manifest=manifest,
        )

    def shift_multitrack_files(
        self,
        *,
        tracks: list[dict[str, Any]],
        source_dir: Path,
        output_dir: Path,
        source_key: str,
        target_key: str,
        semitones: int,
    ) -> dict[str, Any]:
        """Pitch-shift Multitrack tracks; ``pitch_shift=False`` are copied as-is."""
        import librosa
        import soundfile as sf
        import shutil

        if semitones == 0:
            raise ValueError("semitones must be non-zero for a key variant")

        tracks_out = output_dir / "tracks"
        tracks_out.mkdir(parents=True, exist_ok=True)
        out_items: list[dict[str, Any]] = []
        sample_rate: int | None = None

        for item in tracks:
            track_id = str(item.get("id") or "")
            file_name = str(item.get("file_name") or "")
            do_shift = bool(item.get("pitch_shift", True))
            if not track_id or not file_name:
                continue
            src = source_dir / "tracks" / file_name
            if not src.exists():
                raise FileNotFoundError(f"Faixa ausente: {file_name}")
            out_name = f"{track_id}.wav"
            dest = tracks_out / out_name

            if not do_shift:
                # Mantém formato original se já for wav; senão converte via librosa.
                if src.suffix.lower() == ".wav":
                    shutil.copy2(src, dest)
                    y, sr = librosa.load(str(dest), sr=None, mono=False)
                else:
                    y, sr = librosa.load(str(src), sr=None, mono=False)
                    if y.ndim == 1:
                        y = y[np.newaxis, :]
                    sf.write(str(dest), y.T, int(sr), subtype="PCM_16")
                duration = round(float(y.shape[-1] / sr), 3) if y.ndim > 1 else round(float(len(y) / sr), 3)
            else:
                y, sr = librosa.load(str(src), sr=None, mono=False)
                if y.ndim == 1:
                    y = y[np.newaxis, :]
                if sample_rate is None:
                    sample_rate = int(sr)
                elif int(sr) != sample_rate:
                    channels = [
                        librosa.resample(y[ch], orig_sr=sr, target_sr=sample_rate)
                        for ch in range(y.shape[0])
                    ]
                    y = np.stack(channels, axis=0)
                    sr = sample_rate
                shifted = [
                    librosa.effects.pitch_shift(y[ch], sr=int(sr), n_steps=semitones)
                    for ch in range(y.shape[0])
                ]
                y_shift = np.stack(shifted, axis=0)
                sf.write(str(dest), y_shift.T, int(sr), subtype="PCM_16")
                duration = round(float(y_shift.shape[-1] / sr), 3)

            out_items.append(
                {
                    "id": track_id,
                    "name": item.get("name"),
                    "role": item.get("role"),
                    "file_name": out_name,
                    "duration_seconds": duration,
                    "pitch_shift": do_shift,
                }
            )

        manifest = {
            "source_key": source_key,
            "target_key": target_key,
            "semitones": semitones,
            "method": self.method,
            "generated_at": datetime.now(UTC).isoformat(),
            "tracks": out_items,
        }
        (output_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info(
            "multitrack_pitch_shift_completed",
            source_key=source_key,
            target_key=target_key,
            semitones=semitones,
            tracks=len(out_items),
        )
        return manifest
