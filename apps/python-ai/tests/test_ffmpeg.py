from pathlib import Path

from app.infrastructure.media.ffmpeg import ensure_ffmpeg_available, resolve_ffmpeg_location


def test_resolve_ffmpeg_location_from_file_path(tmp_path: Path) -> None:
    ffmpeg = tmp_path / "ffmpeg.exe"
    ffmpeg.write_text("", encoding="utf-8")
    assert resolve_ffmpeg_location(str(ffmpeg)) == str(tmp_path)


def test_ensure_ffmpeg_available_raises_when_missing(monkeypatch) -> None:
    monkeypatch.delenv("FFMPEG_LOCATION", raising=False)
    monkeypatch.delenv("FFMPEG_PATH", raising=False)
    monkeypatch.setattr(
        "app.infrastructure.media.ffmpeg.shutil.which",
        lambda _: None,
    )

    try:
        ensure_ffmpeg_available()
        raised = False
    except RuntimeError as exc:
        raised = True
        assert "ffmpeg/ffprobe" in str(exc)

    assert raised
