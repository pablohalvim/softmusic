from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from app.logging import logger


@dataclass(frozen=True)
class ComputeDeviceInfo:
    backend: str
    available: bool
    device_name: str | None
    device_count: int
    cuda_version: str | None
    torch_version: str | None


def _configure_cuda_visibility() -> None:
    cuda_devices = os.getenv("CUDA_VISIBLE_DEVICES")
    if cuda_devices is not None and cuda_devices.strip() == "":
        os.environ["CUDA_VISIBLE_DEVICES"] = "0"


def get_compute_device_info() -> ComputeDeviceInfo:
    _configure_cuda_visibility()
    try:
        import torch
    except ImportError:
        return ComputeDeviceInfo(
            backend="cpu",
            available=False,
            device_name=None,
            device_count=0,
            cuda_version=None,
            torch_version=None,
        )

    if torch.cuda.is_available():
        return ComputeDeviceInfo(
            backend="cuda",
            available=True,
            device_name=torch.cuda.get_device_name(0),
            device_count=torch.cuda.device_count(),
            cuda_version=torch.version.cuda,
            torch_version=torch.__version__,
        )

    return ComputeDeviceInfo(
        backend="cpu",
        available=False,
        device_name=None,
        device_count=0,
        cuda_version=torch.version.cuda,
        torch_version=torch.__version__,
    )


def get_compute_device() -> Any:
    import torch

    info = get_compute_device_info()
    if info.available:
        return torch.device("cuda:0")
    return torch.device("cpu")


def log_compute_device(context: str) -> ComputeDeviceInfo:
    info = get_compute_device_info()
    logger.info(
        "compute_device",
        context=context,
        backend=info.backend,
        available=info.available,
        device_name=info.device_name,
        device_count=info.device_count,
        cuda_version=info.cuda_version,
        torch_version=info.torch_version,
    )
    return info


def device_info_as_dict(info: ComputeDeviceInfo | None = None) -> dict[str, Any]:
    data = info or get_compute_device_info()
    return {
        "backend": data.backend,
        "available": data.available,
        "device_name": data.device_name,
        "device_count": data.device_count,
        "cuda_version": data.cuda_version,
        "torch_version": data.torch_version,
    }
