from app.application.services.analysis_service import AnalysisService
from app.infrastructure.database.models import Song


def test_resolve_playback_path_prefers_trimmed(tmp_path) -> None:
    song_id = "song_test123"
    song_dir = tmp_path / song_id
    song_dir.mkdir()
    trimmed = song_dir / "trimmed.wav"
    trimmed.write_bytes(b"RIFF")
    original = song_dir / "source.m4a"
    original.write_bytes(b"fake")

    class FakeStorage:
        base_path = tmp_path

    service = AnalysisService.__new__(AnalysisService)
    service.storage = FakeStorage()
    song = Song(id=song_id, file_path=str(original))

    path = service.resolve_playback_path(song_id, song)
    assert path == trimmed


def test_resolve_playback_path_falls_back_to_original(tmp_path) -> None:
    song_id = "song_test456"
    song_dir = tmp_path / song_id
    song_dir.mkdir()
    original = song_dir / "source.m4a"
    original.write_bytes(b"fake")

    class FakeStorage:
        base_path = tmp_path

    service = AnalysisService.__new__(AnalysisService)
    service.storage = FakeStorage()
    song = Song(id=song_id, file_path=str(original))

    path = service.resolve_playback_path(song_id, song)
    assert path == original


def test_resolve_playback_path_returns_none_when_missing(tmp_path) -> None:
    class FakeStorage:
        base_path = tmp_path

    service = AnalysisService.__new__(AnalysisService)
    service.storage = FakeStorage()
    song = Song(id="song_missing", file_path=None)

    assert service.resolve_playback_path("song_missing", song) is None
