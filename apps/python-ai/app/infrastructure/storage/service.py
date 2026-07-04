from __future__ import annotations

import asyncio
import mimetypes
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings
from app.infrastructure.storage.local import LocalStorageAdapter
from app.logging import logger


@dataclass(frozen=True)
class PlaybackTarget:
    """Onde servir um áudio: 'remote' (URL pré-assinada) ou 'local' (Path)."""

    kind: str  # "remote" | "local"
    url: str | None = None
    path: Path | None = None


class StorageService:
    """Camada de storage que combina disco local (scratch/serving) com um bucket
    S3-compatível (Cloudflare R2) durável.

    Fluxo em produção (provider="s3"):
      - o pipeline processa em disco local (Demucs/torchaudio precisam de FS);
      - ao concluir, os artefatos sobem para o R2 em ``<song_id>/...``;
      - o serving usa URLs pré-assinadas (offload de banda/disco da VPS);
      - operações que leem arquivo local (waveform, cifra, reprocesso) restauram
        do R2 sob demanda.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._local = LocalStorageAdapter(settings.storage_local_path)
        self._presign_expires = settings.storage_presign_expires
        self._delete_local_after_upload = settings.storage_delete_local_after_upload
        self._remote = None

        if settings.storage_provider == "s3":
            if not (settings.s3_endpoint_url and settings.s3_access_key_id and settings.s3_secret_access_key):
                logger.warning("storage_s3_missing_config_fallback_local")
            else:
                from app.infrastructure.storage.s3 import R2Client

                self._remote = R2Client(
                    endpoint_url=settings.s3_endpoint_url,
                    region=settings.s3_region,
                    access_key_id=settings.s3_access_key_id,
                    secret_access_key=settings.s3_secret_access_key,
                    bucket=settings.storage_bucket,
                    prefix=settings.storage_prefix,
                )

    # -- básico (compatível com o uso atual de AnalysisService) ----------------

    @property
    def base_path(self) -> Path:
        return self._local.base_path

    @property
    def remote_enabled(self) -> bool:
        return self._remote is not None

    def song_dir(self, song_id: str) -> Path:
        return self.base_path / song_id

    async def save(self, key: str, content: bytes) -> str:
        # Staging local (o worker processa a partir daqui). O upload durável para
        # o R2 acontece em persist_song_artifacts, após a análise concluir.
        return await self._local.save(key, content)

    # -- persistência durável (upload) -----------------------------------------

    async def persist_song_artifacts(self, song_id: str) -> None:
        if self._remote is None:
            return
        song_dir = self.song_dir(song_id)
        if not song_dir.exists():
            return
        await asyncio.to_thread(self._upload_tree, song_id, song_dir)
        if self._delete_local_after_upload:
            shutil.rmtree(song_dir, ignore_errors=True)
            logger.info("storage_local_offloaded", song_id=song_id)

    def _upload_tree(self, song_id: str, song_dir: Path) -> None:
        count = 0
        for file_path in song_dir.rglob("*"):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(song_dir).as_posix()
            content_type, _ = mimetypes.guess_type(str(file_path))
            self._remote.upload_file(file_path, f"{song_id}/{rel}", content_type)
            count += 1
        logger.info("storage_uploaded", song_id=song_id, files=count)

    # -- restauração sob demanda (para leituras locais) ------------------------

    async def ensure_local_file(self, song_id: str, rel: str) -> Path | None:
        local = self.song_dir(song_id) / rel
        if local.exists() and local.is_file():
            return local
        if self._remote is None:
            return None
        ok = await asyncio.to_thread(self._remote.download_file, f"{song_id}/{rel}", local)
        return local if ok else None

    async def ensure_source_local(self, song_id: str, file_path: str | None) -> Path | None:
        if file_path:
            local = Path(file_path)
            if local.exists() and local.is_file():
                return local
            # tenta restaurar pelo basename dentro do prefixo da música
            restored = await self.ensure_local_file(song_id, local.name)
            if restored is not None:
                return restored
        return None

    # -- serving ---------------------------------------------------------------

    async def playback_target(self, song_id: str, file_path: str | None) -> PlaybackTarget | None:
        candidates = ["trimmed.wav", "normalized.wav"]
        if file_path:
            candidates.append(Path(file_path).name)

        if self._remote is not None:
            for rel in candidates:
                if await asyncio.to_thread(self._remote.exists, f"{song_id}/{rel}"):
                    url = self._remote.presigned_get(
                        f"{song_id}/{rel}", self._presign_expires, filename=rel
                    )
                    return PlaybackTarget(kind="remote", url=url)

        song_dir = self.song_dir(song_id)
        local_candidates = [song_dir / "trimmed.wav", song_dir / "normalized.wav"]
        if file_path:
            local_candidates.append(Path(file_path))
        for path in local_candidates:
            if path.exists() and path.is_file():
                return PlaybackTarget(kind="local", path=path)
        return None

    async def stem_target(self, song_id: str, stem_file: str) -> PlaybackTarget | None:
        rel = f"stems/{stem_file}"
        if self._remote is not None and await asyncio.to_thread(
            self._remote.exists, f"{song_id}/{rel}"
        ):
            url = self._remote.presigned_get(
                f"{song_id}/{rel}", self._presign_expires, filename=stem_file
            )
            return PlaybackTarget(kind="remote", url=url)
        local = self.song_dir(song_id) / rel
        if local.exists() and local.is_file():
            return PlaybackTarget(kind="local", path=local)
        return None

    async def stem_available(self, song_id: str, stem_file: str) -> bool:
        local = self.song_dir(song_id) / "stems" / stem_file
        if local.exists():
            return True
        if self._remote is None:
            return False
        return await asyncio.to_thread(self._remote.exists, f"{song_id}/stems/{stem_file}")

    # -- exclusão --------------------------------------------------------------

    async def delete_song(self, song_id: str) -> None:
        song_dir = self.song_dir(song_id)
        if song_dir.exists():
            shutil.rmtree(song_dir, ignore_errors=True)
        if self._remote is not None:
            await asyncio.to_thread(self._remote.delete_prefix, song_id)
