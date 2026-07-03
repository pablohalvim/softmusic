from unittest.mock import MagicMock, patch

import pytest

from app.domain.interfaces.source_downloader import is_youtube_url
from app.infrastructure.download.youtube_downloader import _extract_youtube_metadata


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ],
)
def test_is_youtube_url_accepts_valid_links(url: str) -> None:
    assert is_youtube_url(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/audio.mp3",
        "not-a-url",
        "https://www.youtube.com/playlist?list=abc",
    ],
)
def test_is_youtube_url_rejects_invalid_links(url: str) -> None:
    assert is_youtube_url(url) is False


def test_extract_youtube_metadata() -> None:
    metadata = _extract_youtube_metadata(
        {
            "title": "Test Song",
            "uploader": "Test Channel",
            "duration": 212,
            "upload_date": "20240115",
            "language": "pt",
        }
    )
    assert metadata.title == "Test Song"
    assert metadata.artist == "Test Channel"
    assert metadata.duration_seconds == 212.0
    assert metadata.release_year == 2024
    assert metadata.language == "pt"


@patch("yt_dlp.YoutubeDL")
@patch("app.infrastructure.download.youtube_downloader.ensure_ffmpeg_available", return_value="/usr/bin")
def test_youtube_downloader_returns_file_and_metadata(
    _mock_ffmpeg: MagicMock, mock_ytdl: MagicMock, tmp_path
) -> None:
    from app.infrastructure.download.youtube_downloader import YouTubeDownloader

    audio_file = tmp_path / "source.m4a"
    audio_file.write_bytes(b"fake-audio")

    mock_instance = MagicMock()
    mock_instance.extract_info.return_value = {
        "title": "Demo Track",
        "uploader": "Demo Artist",
        "duration": 180,
        "upload_date": "20230601",
    }
    mock_ytdl.return_value.__enter__.return_value = mock_instance

    downloader = YouTubeDownloader()

    import asyncio

    result = asyncio.run(
        downloader.download("https://www.youtube.com/watch?v=dQw4w9WgXcQ", tmp_path)
    )

    assert result.metadata.title == "Demo Track"
    assert result.metadata.artist == "Demo Artist"
    assert result.file_path.name.startswith("source.")
