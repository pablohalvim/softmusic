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
