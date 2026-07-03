from __future__ import annotations

import os
import shutil
from pathlib import Path


def resolve_ffmpeg_location(explicit_path: str | None = None) -> str | None:
    if explicit_path:
        path = Path(explicit_path)
        if path.is_dir():
            return str(path)
        if path.is_file():
            return str(path.parent)

    env_path = os.getenv("FFMPEG_LOCATION") or os.getenv("FFMPEG_PATH")
    if env_path:
        path = Path(env_path)
        if path.is_dir():
            return str(path)
        if path.is_file():
            return str(path.parent)

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return str(Path(ffmpeg).parent)

    return None


def ensure_ffmpeg_available(explicit_path: str | None = None) -> str:
    location = resolve_ffmpeg_location(explicit_path)
    if location:
        return location

    raise RuntimeError(
        "ffmpeg/ffprobe não encontrados. No Docker isso já vem instalado; "
        "no Windows instale ffmpeg (ex.: winget install Gyan.FFmpeg) ou pare o worker local "
        "e use apenas o container softmusic-worker."
    )
