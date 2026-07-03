from app.config import get_settings
from app.infrastructure.storage.local import LocalStorageAdapter, StorageAdapter


def get_storage() -> StorageAdapter:
    settings = get_settings()
    if settings.storage_provider == "local":
        return LocalStorageAdapter(settings.storage_local_path)
    raise ValueError(f"Unsupported storage provider: {settings.storage_provider}")
