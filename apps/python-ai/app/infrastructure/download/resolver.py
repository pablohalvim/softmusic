from __future__ import annotations

from pathlib import Path

from app.domain.interfaces.source_downloader import DownloadResult, SourceDownloader
from app.infrastructure.download.youtube_downloader import HttpDownloader, YouTubeDownloader

HTTP_SOURCE_TYPES = frozenset({"http", "s3", "azure_blob", "gcs"})


class SourceDownloadResolver:
    def __init__(
        self,
        youtube_downloader: SourceDownloader | None = None,
        http_downloader: SourceDownloader | None = None,
    ) -> None:
        self._youtube = youtube_downloader or YouTubeDownloader()
        self._http = http_downloader or HttpDownloader()

    async def download(self, source_type: str, source_ref: str, working_dir: Path) -> DownloadResult:
        if source_type == "youtube":
            return await self._youtube.download(source_ref, working_dir)
        if source_type in HTTP_SOURCE_TYPES:
            return await self._http.download(source_ref, working_dir)
        raise ValueError(f"Tipo de origem não suportado para download: {source_type}")
