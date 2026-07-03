from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


YOUTUBE_URL_PATTERN = re.compile(
    r"^https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w-]+",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SourceMetadata:
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration_seconds: float | None = None
    release_year: int | None = None
    language: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "duration_seconds": self.duration_seconds,
            "release_year": self.release_year,
            "language": self.language,
        }


@dataclass(frozen=True)
class DownloadResult:
    file_path: Path
    metadata: SourceMetadata = field(default_factory=SourceMetadata)


class SourceDownloader(ABC):
    @abstractmethod
    async def download(self, source_ref: str, working_dir: Path) -> DownloadResult:
        raise NotImplementedError


def is_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_URL_PATTERN.match(url.strip()))


YOUTUBE_VIDEO_ID_PATTERN = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([\w-]{11})",
    re.IGNORECASE,
)


def extract_youtube_video_id(url: str) -> str | None:
    match = YOUTUBE_VIDEO_ID_PATTERN.search(url.strip())
    return match.group(1) if match else None
