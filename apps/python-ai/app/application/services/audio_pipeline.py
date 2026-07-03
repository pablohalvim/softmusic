from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import librosa
import numpy as np
from pydub import AudioSegment
from pydub.silence import detect_nonsilent

from app.infrastructure.ml.demucs_separator import DemucsSeparator, SeparationResult
from app.infrastructure.ml.device import log_compute_device
from app.infrastructure.ml.features import compute_chroma
from app.infrastructure.ml.stem_harmony import estimate_bass_progression, estimate_chord_progression
from app.logging import logger

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass
class PipelineContext:
    song_id: str
    source_path: Path
    working_dir: Path
    options: dict[str, Any]
    source_metadata: dict[str, Any] | None = None
    enable_stem_separation: bool = True
    demucs_model: str = "htdemucs_6s"
    models_cache_dir: str = "./models"


class AudioPipeline:
    def __init__(self, sample_rate: int = 22050) -> None:
        self.sample_rate = sample_rate

    def run(self, context: PipelineContext) -> dict[str, Any]:
        device_info = log_compute_device("audio_pipeline")
        wav_path = self._convert_to_wav(context)
        start_ms, end_ms = self._detect_trim_bounds(wav_path)
        trimmed_path = self._apply_trim(wav_path, start_ms, end_ms, context.working_dir / "trimmed.wav")
        y, sr = librosa.load(trimmed_path, sr=self.sample_rate, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))

        # A separação roda sobre o áudio em qualidade máxima (estéreo, sample rate
        # original) para preservar detalhe e informação estéreo — o mesmo recorte de
        # silêncio (start_ms/end_ms) é aplicado para manter o alinhamento temporal.
        separation = self._separate_stems(context, start_ms, end_ms)
        stem_paths = {stem.name: stem.path for stem in separation.stems} if separation else {}

        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        bpm = float(tempo) if np.isscalar(tempo) else float(tempo[0])
        if bpm <= 0:
            bpm = 120.0
        if not beat_times:
            beat_times = np.arange(0, duration, 60 / bpm).tolist()

        mix_chroma, chroma_backend = compute_chroma(y, sr)
        key, mode = self._estimate_key(mix_chroma)
        relative_key, parallel_key = self._related_keys(key, mode)

        y_harmony = self._load_harmony_signal(stem_paths, trimmed_path)
        harmony_chroma, _ = compute_chroma(y_harmony, self.sample_rate)
        max_segments = min(128, max(16, int(duration / 4)))
        chord_progression = estimate_chord_progression(
            harmony_chroma,
            beat_times,
            key,
            mode,
            max_segments=max_segments,
        )

        bass_progression: list[dict[str, Any]] = []
        if "bass" in stem_paths:
            y_bass, sr_bass = librosa.load(stem_paths["bass"], sr=self.sample_rate, mono=True)
            bass_chroma, _ = compute_chroma(y_bass, sr_bass)
            bass_progression = estimate_bass_progression(
                bass_chroma,
                beat_times,
                key,
                mode,
                max_segments=max_segments,
            )

        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        sections = self._estimate_structure(beat_times, duration, onset_env, sr)
        loudness = float(np.sqrt(np.mean(y**2)))

        return self._build_result(
            song_id=context.song_id,
            duration=duration,
            bpm=bpm,
            beat_times=beat_times,
            key=key,
            mode=mode,
            relative_key=relative_key,
            parallel_key=parallel_key,
            sections=sections,
            chord_progression=chord_progression,
            bass_progression=bass_progression,
            loudness=loudness,
            separation=separation,
            options={
                **context.options,
                "_source_metadata": context.source_metadata or {},
                "_compute_backend": device_info.backend,
                "_chroma_backend": chroma_backend,
            },
        )

    def _separate_stems(
        self,
        context: PipelineContext,
        start_ms: int,
        end_ms: int,
    ) -> SeparationResult | None:
        if not context.enable_stem_separation:
            return None
        if context.options.get("skip_stem_separation"):
            return None

        stems_dir = context.working_dir / "stems"
        try:
            separation_input = self._prepare_separation_input(context, start_ms, end_ms)
            separator = DemucsSeparator(context.demucs_model, context.models_cache_dir)
            return separator.separate(separation_input, stems_dir)
        except Exception as exc:
            logger.warning("stem_separation_failed", song_id=context.song_id, error=str(exc))
            return None

    def _prepare_separation_input(
        self,
        context: PipelineContext,
        start_ms: int,
        end_ms: int,
    ) -> Path:
        """Gera o áudio de entrada da separação em qualidade máxima.

        Mantém o sample rate original (o Demucs reamostra para 44.1kHz internamente
        quando necessário) e o estéreo, ao contrário do áudio de análise que é
        rebaixado para mono/22kHz. Isso preserva a banda completa de frequências e as
        pistas estéreo, resultando em stems bem mais definidos.
        """
        target = context.working_dir / "separation_input.wav"
        audio = AudioSegment.from_file(context.source_path)
        if audio.channels != 2:
            audio = audio.set_channels(2)
        if end_ms > start_ms:
            audio = audio[start_ms:end_ms]
        audio.export(target, format="wav")
        return target

    def _load_harmony_signal(self, stem_paths: dict[str, Path], fallback: Path) -> np.ndarray:
        """Combina os stems harmônicos (other/guitar/piano) para estimar acordes.

        Com o modelo de 6 fontes, o conteúdo harmônico se divide entre ``guitar``,
        ``piano`` e o residual ``other``; somá-los recompõe a informação harmônica
        completa para a análise de acordes.
        """
        harmonic_keys = ("other", "guitar", "piano")
        sources = [stem_paths[key] for key in harmonic_keys if key in stem_paths]
        if not sources:
            signal, _ = librosa.load(fallback, sr=self.sample_rate, mono=True)
            return signal

        combined: np.ndarray | None = None
        for path in sources:
            signal, _ = librosa.load(path, sr=self.sample_rate, mono=True)
            if combined is None:
                combined = signal
                continue
            length = min(len(combined), len(signal))
            combined = combined[:length] + signal[:length]
        return combined if combined is not None else np.zeros(1, dtype=np.float32)

    def _convert_to_wav(self, context: PipelineContext) -> Path:
        target = context.working_dir / "normalized.wav"
        audio = AudioSegment.from_file(context.source_path)
        audio = audio.set_channels(1).set_frame_rate(self.sample_rate)
        audio = audio.normalize()
        audio.export(target, format="wav")
        return target

    def _detect_trim_bounds(self, wav_path: Path) -> tuple[int, int]:
        audio = AudioSegment.from_file(wav_path)
        nonsilent = detect_nonsilent(audio, min_silence_len=500, silence_thresh=audio.dBFS - 16)
        if not nonsilent:
            return 0, len(audio)
        return int(nonsilent[0][0]), int(nonsilent[-1][1])

    def _apply_trim(self, wav_path: Path, start_ms: int, end_ms: int, target: Path) -> Path:
        if end_ms <= start_ms:
            return wav_path
        audio = AudioSegment.from_file(wav_path)
        trimmed = audio[start_ms:end_ms]
        trimmed.export(target, format="wav")
        return target

    def _estimate_key(self, chroma: np.ndarray) -> tuple[str, str]:
        profile = chroma.mean(axis=1)
        major_scores = [np.corrcoef(np.roll(MAJOR_PROFILE, i), profile)[0, 1] for i in range(12)]
        minor_scores = [np.corrcoef(np.roll(MINOR_PROFILE, i), profile)[0, 1] for i in range(12)]
        major_idx = int(np.argmax(major_scores))
        minor_idx = int(np.argmax(minor_scores))
        if major_scores[major_idx] >= minor_scores[minor_idx]:
            return KEY_NAMES[major_idx], "major"
        return KEY_NAMES[minor_idx], "minor"

    def _related_keys(self, key: str, mode: str) -> tuple[str, str]:
        idx = KEY_NAMES.index(key.replace("m", ""))
        if mode == "major":
            relative = KEY_NAMES[(idx + 9) % 12]
            parallel = KEY_NAMES[idx] + "m"
            return f"{relative} minor", parallel
        relative = KEY_NAMES[(idx + 3) % 12]
        parallel = KEY_NAMES[idx]
        return f"{relative} major", parallel

    def _estimate_structure(
        self,
        beat_times: list[float],
        duration: float,
        onset_env: np.ndarray,
        sr: int,
    ) -> list[dict[str, Any]]:
        if len(beat_times) < 8:
            return [
                {
                    "type": "verse",
                    "start_seconds": 0.0,
                    "end_seconds": duration,
                    "confidence": 0.5,
                }
            ]

        boundaries = [0.0]
        window = max(4, len(beat_times) // 8)
        for index in range(window, len(beat_times), window):
            boundaries.append(float(beat_times[index]))
        boundaries.append(duration)

        labels = ["intro", "verse", "pre_chorus", "chorus", "verse", "bridge", "chorus", "outro"]
        sections: list[dict[str, Any]] = []
        for index in range(len(boundaries) - 1):
            label = labels[min(index, len(labels) - 1)]
            sections.append(
                {
                    "type": label,
                    "start_seconds": boundaries[index],
                    "end_seconds": boundaries[index + 1],
                    "confidence": round(min(0.95, 0.55 + index * 0.05), 2),
                }
            )
        return sections

    def _build_result(
        self,
        song_id: str,
        duration: float,
        bpm: float,
        beat_times: list[float],
        key: str,
        mode: str,
        relative_key: str,
        parallel_key: str,
        sections: list[dict[str, Any]],
        chord_progression: list[dict[str, Any]],
        bass_progression: list[dict[str, Any]],
        loudness: float,
        separation: SeparationResult | None,
        options: dict[str, Any],
    ) -> dict[str, Any]:
        level = options.get("educational_level", "intermediate")
        downbeats = beat_times[::4] if beat_times else []
        source_meta = options.get("_source_metadata") or {}
        metadata = {
            "title": source_meta.get("title"),
            "artist": source_meta.get("artist"),
            "album": source_meta.get("album"),
            "duration_seconds": round(duration, 3),
            "genre": None,
            "mood": "energetic" if bpm >= 120 else "moderate",
            "language": source_meta.get("language"),
            "release_year": source_meta.get("release_year"),
            "isrc": None,
        }
        if source_meta.get("duration_seconds") and not metadata["duration_seconds"]:
            metadata["duration_seconds"] = round(float(source_meta["duration_seconds"]), 3)

        stem_names = {stem.name: stem.path.name for stem in separation.stems} if separation else {}
        guitar_stem = stem_names.get("guitar") or stem_names.get("other")
        instruments = [
            {
                "name": "drums",
                "confidence": 0.9 if "drums" in stem_names else 0.72,
                "stem": stem_names.get("drums"),
            },
            {
                "name": "bass",
                "confidence": 0.88 if "bass" in stem_names else 0.68,
                "stem": stem_names.get("bass"),
            },
            {
                "name": "guitar",
                "confidence": 0.84 if guitar_stem else 0.55,
                "stem": guitar_stem,
            },
            {
                "name": "vocals",
                "confidence": 0.86 if "vocals" in stem_names else 0.61,
                "stem": stem_names.get("vocals"),
            },
        ]
        if "piano" in stem_names:
            instruments.append(
                {
                    "name": "keys",
                    "confidence": 0.8,
                    "stem": stem_names.get("piano"),
                }
            )
        if "guitar" in stem_names and "other" in stem_names:
            # No modelo de 6 fontes o stem "other" é o residual (cordas, sopros, sintetizadores).
            instruments.append(
                {
                    "name": "other",
                    "confidence": 0.5,
                    "stem": stem_names.get("other"),
                }
            )

        has_guitar_stem = "guitar" in stem_names
        guitar_payload = None
        if chord_progression:
            guitar_payload = {
                "source_stem": "guitar" if has_guitar_stem else ("other" if separation else "mix"),
                "separated": separation is not None,
                "chord_progression": chord_progression,
                "bass_progression": bass_progression or None,
            }

        piano_payload = None
        if "piano" in stem_names:
            piano_payload = {
                "source_stem": "piano",
                "separated": True,
                "chord_progression": chord_progression or None,
            }

        summary_extra = ""
        if separation:
            summary_extra = " Stems separados com Demucs para análise por instrumento."

        return {
            "version": "1.0.0",
            "song_id": song_id,
            "generated_at": datetime.now(UTC).isoformat(),
            "metadata": metadata,
            "harmony": {
                "key": key,
                "mode": mode if mode in {"major", "minor"} else "other",
                "relative_key": relative_key,
                "parallel_key": parallel_key,
                "tempo_bpm": round(bpm, 2),
                "meter": "4/4",
                "scale": self._scale_notes(key, mode),
                "chord_progression": chord_progression,
                "cadences": self._detect_cadences(chord_progression),
                "modulations": [],
                "harmonic_rhythm": round(len(chord_progression) / max(duration, 1), 3),
            },
            "rhythm": {
                "bpm": round(bpm, 2),
                "beat_times": [round(value, 3) for value in beat_times[:128]],
                "downbeat_times": [round(value, 3) for value in downbeats[:32]],
                "subdivision": "16th",
                "swing": 0.0,
                "syncopation": round(min(1.0, len(beat_times) / max(duration, 1) / 4), 3),
                "groove": "straight",
                "complexity": round(min(1.0, len(beat_times) / 100), 3),
                "pulse_stability": 0.85,
            },
            "structure": {"sections": sections},
            "instruments": instruments,
            "performance": {
                "dynamics": round(min(1.0, loudness * 4), 3),
                "energy": round(min(1.0, bpm / 180), 3),
                "density": round(min(1.0, len(chord_progression) / 20), 3),
                "intensity": round(min(1.0, loudness * 3), 3),
                "loudness_lufs": round(20 * np.log10(max(loudness, 1e-9)), 2),
                "compression_estimate": 0.35,
            },
            "educational": [
                {
                    "level": level,
                    "summary": (
                        f"A música está em {key} {mode} aproximadamente {round(bpm)} BPM, "
                        f"com {len(sections)} seções detectadas.{summary_extra}"
                    ),
                    "harmony_notes": [
                        f"O tom {key} {mode} organiza a paleta harmônica principal.",
                        "Acordes estimados a partir dos stems harmônicos (guitarra/teclado) quando disponíveis.",
                    ],
                    "emotional_tension": [
                        "Maior densidade rítmica aumenta percepção de energia.",
                        "Cadências autênticas liberam tensão harmônica.",
                    ],
                }
            ],
            "worship": None,
            "guitar": guitar_payload,
            "piano": piano_payload,
            "improvisation": {
                "stem_separation": {
                    "enabled": separation is not None,
                    "model": separation.model if separation else None,
                    "backend": separation.backend if separation else None,
                    "stems": [stem.name for stem in separation.stems] if separation else [],
                }
            },
        }

    def _scale_notes(self, key: str, mode: str) -> list[str]:
        idx = KEY_NAMES.index(key.replace("m", ""))
        major_intervals = [0, 2, 4, 5, 7, 9, 11]
        minor_intervals = [0, 2, 3, 5, 7, 8, 10]
        intervals = major_intervals if mode == "major" else minor_intervals
        return [KEY_NAMES[(idx + step) % 12] for step in intervals]

    def _detect_cadences(self, progression: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(progression) < 2:
            return []
        last = progression[-1]
        prev = progression[-2]
        if str(last["roman_numeral"]).upper().startswith("I"):
            return [
                {
                    "start_seconds": prev["start_seconds"],
                    "type": "authentic",
                    "chords": [prev["chord"], last["chord"]],
                }
            ]
        return []


def write_waveform_peaks(audio_path: Path, peaks: int = 512) -> list[float]:
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    bucket_size = max(1, len(y) // peaks)
    values = []
    for index in range(0, len(y), bucket_size):
        chunk = y[index : index + bucket_size]
        if len(chunk) == 0:
            continue
        values.append(float(np.max(np.abs(chunk))))
    return [round(value, 4) for value in values[:peaks]]
