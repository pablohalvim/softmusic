from datetime import datetime
from zoneinfo import ZoneInfo

from app.application.services.cifra_variation_builder import (
    build_cifra_variation_snapshot,
    import_variation_base_name,
    next_import_variation_name,
)
from app.domain.interfaces.source_downloader import extract_youtube_video_id


def test_extract_youtube_video_id_watch() -> None:
    assert extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_extract_youtube_video_id_short() -> None:
    assert extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_extract_youtube_video_id_shorts() -> None:
    assert extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_extract_youtube_video_id_invalid() -> None:
    assert extract_youtube_video_id("https://example.com") is None


def test_import_variation_base_name() -> None:
    fixed = datetime(2026, 7, 2, 15, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
    assert import_variation_base_name(fixed) == "Importado_02072026"


def test_build_cifra_variation_snapshot() -> None:
    payload = {
        "sections": [
            {
                "id": "verse-1",
                "label": "Verso",
                "lines": [
                    {
                        "id": "line-1",
                        "lyrics": "Hello",
                        "placements": [{"id": "p1", "chord": "C", "offset": 0}],
                    }
                ],
            }
        ]
    }
    snapshot = build_cifra_variation_snapshot(payload)
    assert snapshot["isImported"] is True
    assert snapshot["importedSheet"]["sections"][0]["lines"][0]["lyrics"] == "Hello"
