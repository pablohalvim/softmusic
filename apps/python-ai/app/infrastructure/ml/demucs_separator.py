from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.logging import logger


@dataclass(frozen=True)
class StemFile:
    name: str
    path: Path
    duration_seconds: float
    role: str


@dataclass(frozen=True)
class SeparationResult:
    model: str
    backend: str
    stems: tuple[StemFile, ...]
    output_dir: Path


STEM_ROLES = {
    "drums": "drums",
    "bass": "bass",
    # htdemucs (4 fontes): "other" agrega instrumentos harmônicos.
    "other": "harmony_other",
    "vocals": "vocals",
    # htdemucs_6s (6 fontes): stems dedicados.
    "guitar": "guitar",
    "piano": "keys",
}


class DemucsSeparator:
    def __init__(self, model_name: str = "htdemucs", models_cache_dir: str | None = None) -> None:
        self.model_name = model_name
        if models_cache_dir:
            cache = Path(models_cache_dir)
            cache.mkdir(parents=True, exist_ok=True)

    def separate(self, audio_path: Path, output_dir: Path) -> SeparationResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = output_dir / "manifest.json"
        cached = self._load_cached(output_dir, manifest_path)
        if cached is not None:
            logger.info("demucs_cache_hit", output_dir=str(output_dir))
            return cached

        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        import torch
        import torchaudio

        from app.infrastructure.ml.device import get_compute_device, log_compute_device

        device_info = log_compute_device("demucs")
        device = get_compute_device()

        model = get_model(self.model_name)
        model.to(device)
        model.eval()

        wav, sample_rate = torchaudio.load(str(audio_path))
        if sample_rate != model.samplerate:
            wav = torchaudio.functional.resample(wav, sample_rate, model.samplerate)

        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        elif wav.shape[0] > 2:
            wav = wav[:2]

        reference = wav.mean(0)
        wav = (wav - reference.mean()) / (reference.std() + 1e-8)

        with torch.inference_mode():
            sources = apply_model(model, wav.unsqueeze(0).to(device), device=device)[0]

        stems: list[StemFile] = []
        for source, name in zip(sources, model.sources, strict=True):
            stem_path = output_dir / f"{name}.wav"
            tensor = source.detach().cpu()
            if tensor.dim() == 1:
                tensor = tensor.unsqueeze(0)
            torchaudio.save(str(stem_path), tensor, model.samplerate)
            duration = float(tensor.shape[-1] / model.samplerate)
            stems.append(
                StemFile(
                    name=name,
                    path=stem_path,
                    duration_seconds=round(duration, 3),
                    role=STEM_ROLES.get(name, name),
                )
            )

        result = SeparationResult(
            model=self.model_name,
            backend=device_info.backend,
            stems=tuple(stems),
            output_dir=output_dir,
        )
        self._write_manifest(result, manifest_path)
        logger.info(
            "demucs_completed",
            model=self.model_name,
            backend=device_info.backend,
            stems=[stem.name for stem in stems],
        )
        return result

    @staticmethod
    def _write_manifest(result: SeparationResult, manifest_path: Path) -> None:
        payload = {
            "model": result.model,
            "backend": result.backend,
            "generated_at": datetime.now(UTC).isoformat(),
            "stems": [
                {
                    "name": stem.name,
                    "file": stem.path.name,
                    "path": str(stem.path),
                    "duration_seconds": stem.duration_seconds,
                    "role": stem.role,
                }
                for stem in result.stems
            ],
        }
        manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    @staticmethod
    def _load_cached(output_dir: Path, manifest_path: Path) -> SeparationResult | None:
        if not manifest_path.exists():
            return None

        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        stems: list[StemFile] = []
        for item in payload.get("stems", []):
            stem_path = output_dir / item["file"]
            if not stem_path.exists():
                return None
            stems.append(
                StemFile(
                    name=item["name"],
                    path=stem_path,
                    duration_seconds=float(item["duration_seconds"]),
                    role=item.get("role", item["name"]),
                )
            )

        if not stems:
            return None

        return SeparationResult(
            model=str(payload.get("model", "htdemucs")),
            backend=str(payload.get("backend", "cpu")),
            stems=tuple(stems),
            output_dir=output_dir,
        )

    @staticmethod
    def load_manifest(stems_dir: Path) -> dict[str, Any] | None:
        manifest_path = stems_dir / "manifest.json"
        if not manifest_path.exists():
            return None
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        payload["stems"] = [
            {
                **item,
                "path": str(stems_dir / item["file"]),
                "available": (stems_dir / item["file"]).exists(),
            }
            for item in payload.get("stems", [])
        ]
        return payload
