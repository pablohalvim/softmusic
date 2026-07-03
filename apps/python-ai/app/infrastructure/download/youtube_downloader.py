from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import yt_dlp

from app.domain.interfaces.source_downloader import DownloadResult, SourceDownloader, SourceMetadata
from app.infrastructure.media.ffmpeg import ensure_ffmpeg_available


def _extract_youtube_metadata(info: dict) -> SourceMetadata:
    upload_date = info.get("upload_date")
    release_year = int(upload_date[:4]) if upload_date and len(upload_date) >= 4 else None
    artist = info.get("artist") or info.get("uploader") or info.get("channel")
    duration = info.get("duration")
    return SourceMetadata(
        title=info.get("title"),
        artist=artist,
        album=info.get("album"),
        duration_seconds=float(duration) if duration is not None else None,
        release_year=release_year,
        language=info.get("language"),
    )


def _download_youtube_sync(url: str, working_dir: Path) -> DownloadResult:
    working_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(working_dir / "source.%(ext)s")
    ydl_opts: dict = {
        # Baixa a melhor faixa de áudio disponível (maior bitrate/sample rate).
        "format": "bestaudio/best",
        # Ordena candidatos priorizando maior bitrate (abr) e sample rate (asr).
        "format_sort": ["abr", "asr"],
        "outtmpl": output_template,
        "ffmpeg_location": ensure_ffmpeg_available(),
        "postprocessors": [
            {
                # Extrai para FLAC (lossless) para preservar o máximo de detalhe do
                # áudio de origem para a análise/separação. "preferredquality": 0
                # instrui o ffmpeg a não reduzir a qualidade.
                "key": "FFmpegExtractAudio",
                "preferredcodec": "flac",
                "preferredquality": "0",
            }
        ],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if info is None:
            raise ValueError("Não foi possível extrair informações do vídeo do YouTube")

    candidates = sorted(working_dir.glob("source.*"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        raise ValueError("Download do YouTube concluído, mas arquivo de áudio não encontrado")

    return DownloadResult(file_path=candidates[0], metadata=_extract_youtube_metadata(info))


class YouTubeDownloader(SourceDownloader):
    async def download(self, source_ref: str, working_dir: Path) -> DownloadResult:
        return await asyncio.to_thread(_download_youtube_sync, source_ref, working_dir)


class HttpDownloader(SourceDownloader):
    async def download(self, source_ref: str, working_dir: Path) -> DownloadResult:
        working_dir.mkdir(parents=True, exist_ok=True)
        extension = _guess_extension(source_ref)
        target = working_dir / f"download{extension}"

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            response = await client.get(source_ref)
            response.raise_for_status()
            target.write_bytes(response.content)

        return DownloadResult(file_path=target)


def _guess_extension(url: str) -> str:
    filename = url.split("/")[-1].split("?")[0]
    if "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    return ".bin"
