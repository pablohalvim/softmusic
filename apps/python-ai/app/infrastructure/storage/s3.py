from __future__ import annotations

from pathlib import Path

from app.logging import logger


class R2Client:
    """Cliente S3-compatível (Cloudflare R2) para armazenamento durável.

    boto3 é importado de forma preguiçosa para não exigir a dependência quando o
    provider for "local". As chamadas são síncronas (boto3); a StorageService as
    executa em threadpool quando chamada de contexto async.
    """

    def __init__(
        self,
        *,
        endpoint_url: str,
        region: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
        prefix: str = "",
    ) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region or "auto",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    def _full_key(self, key: str) -> str:
        key = key.lstrip("/")
        return f"{self.prefix}/{key}" if self.prefix else key

    def upload_file(self, local_path: Path, key: str, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else None
        self._client.upload_file(
            str(local_path), self.bucket, self._full_key(key), ExtraArgs=extra or {}
        )

    def upload_bytes(self, content: bytes, key: str, content_type: str | None = None) -> None:
        kwargs = {"Bucket": self.bucket, "Key": self._full_key(key), "Body": content}
        if content_type:
            kwargs["ContentType"] = content_type
        self._client.put_object(**kwargs)

    def download_file(self, key: str, local_path: Path) -> bool:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._client.download_file(self.bucket, self._full_key(key), str(local_path))
            return True
        except Exception as exc:  # noqa: BLE001 - objeto ausente ou erro de rede
            logger.warning("r2_download_failed", key=key, error=str(exc))
            return False

    def read_bytes(self, key: str) -> bytes | None:
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=self._full_key(key))
            return resp["Body"].read()
        except Exception as exc:  # noqa: BLE001
            logger.warning("r2_read_failed", key=key, error=str(exc))
            return None

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=self._full_key(key))
            return True
        except Exception:  # noqa: BLE001 - 404/403 => tratamos como inexistente
            return False

    def presigned_get(self, key: str, expires: int = 3600, filename: str | None = None) -> str:
        params: dict[str, str] = {"Bucket": self.bucket, "Key": self._full_key(key)}
        if filename:
            params["ResponseContentDisposition"] = f'inline; filename="{filename}"'
        return self._client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires
        )

    def delete_prefix(self, prefix: str) -> int:
        full = self._full_key(prefix)
        if not full.endswith("/"):
            full = f"{full}/"
        deleted = 0
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=full):
            objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if not objects:
                continue
            self._client.delete_objects(Bucket=self.bucket, Delete={"Objects": objects})
            deleted += len(objects)
        return deleted
