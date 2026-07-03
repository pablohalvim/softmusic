from abc import ABC, abstractmethod
from pathlib import Path


class StorageAdapter(ABC):
    @abstractmethod
    async def save(self, key: str, content: bytes) -> str:
        raise NotImplementedError

    @abstractmethod
    async def read(self, path: str) -> bytes:
        raise NotImplementedError

    @abstractmethod
    async def exists(self, path: str) -> bool:
        raise NotImplementedError


class LocalStorageAdapter(StorageAdapter):
    def __init__(self, base_path: str) -> None:
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    async def save(self, key: str, content: bytes) -> str:
        target = self.base_path / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return str(target)

    async def read(self, path: str) -> bytes:
        return Path(path).read_bytes()

    async def exists(self, path: str) -> bool:
        return Path(path).exists()
