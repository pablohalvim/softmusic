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


def configure_compute_threads(context: str = "default") -> int:
    """Limita threads de CPU do PyTorch/BLAS para não saturar o host compartilhado.

    Mesmo com CUDA, o PyTorch/Demucs ainda usa CPU (I/O, resample, librosa).
    Sem limite, esses threads engolem API/MySQL no mesmo host.
    """
    cpu_count = os.cpu_count() or 2
    raw = os.environ.get("TORCH_NUM_THREADS", "").strip()
    if not raw:
        try:
            from app.config import get_settings

            raw = str(get_settings().torch_num_threads)
        except Exception:
            raw = "2"
    try:
        threads = int(raw)
    except ValueError:
        threads = 2

    # Com GPU, manter poucas threads de CPU evita spin do runtime + deixa
    # cabeça para o uvicorn/MySQL. Em CPU-only, 2 já evita matar o host.
    try:
        import torch

        if torch.cuda.is_available():
            threads = min(threads, 2)
    except Exception:
        pass

    threads = max(1, min(threads, max(1, cpu_count - 1)))

    for key in (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        os.environ[key] = str(threads)

    import torch

    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(max(1, min(2, threads)))
    except RuntimeError:
        # Já definido após o primeiro uso do runtime.
        pass

    logger.info(
        "compute_threads",
        context=context,
        threads=threads,
        cpu_count=cpu_count,
        cuda=bool(torch.cuda.is_available()),
    )
    return threads


def get_compute_device_info() -> ComputeDeviceInfo:
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
    expects_gpu = os.environ.get("NVIDIA_VISIBLE_DEVICES", "").strip() not in {"", "void", "none"}
    if expects_gpu and not info.available:
        logger.warning(
            "compute_device_cpu_fallback",
            context=context,
            message=(
                "NVIDIA_VISIBLE_DEVICES está definido, mas torch.cuda.is_available()=False. "
                "Demucs vai rodar em CPU e pode travar API/MySQL no mesmo host."
            ),
            nvidia_visible_devices=os.environ.get("NVIDIA_VISIBLE_DEVICES"),
            cuda_visible_devices=os.environ.get("CUDA_VISIBLE_DEVICES"),
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
