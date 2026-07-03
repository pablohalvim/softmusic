from pathlib import Path

import numpy as np
import pytest

from app.application.services.audio_pipeline import AudioPipeline, PipelineContext


@pytest.fixture
def sample_wav(tmp_path: Path) -> Path:
    import soundfile as sf

    sr = 22050
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    signal = 0.2 * np.sin(2 * np.pi * 440 * t)
    path = tmp_path / "sample.wav"
    sf.write(path, signal, sr)
    return path


def test_pipeline_generates_analysis(sample_wav: Path, tmp_path: Path) -> None:
    pipeline = AudioPipeline()
    context = PipelineContext(
        song_id="song_test",
        source_path=sample_wav,
        working_dir=tmp_path / "work",
        options={"educational_level": "beginner", "skip_stem_separation": True},
        enable_stem_separation=False,
    )
    (tmp_path / "work").mkdir()
    result = pipeline.run(context)
    assert result["version"] == "1.0.0"
    assert result["song_id"] == "song_test"
    assert result["harmony"]["tempo_bpm"] > 0
    assert len(result["structure"]["sections"]) >= 1
