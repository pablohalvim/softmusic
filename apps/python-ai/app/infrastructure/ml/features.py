from __future__ import annotations

import numpy as np


def compute_chroma_stft(y: np.ndarray, sr: int, device) -> np.ndarray:
    import torch

    n_fft = 4096
    hop_length = 512
    waveform = torch.from_numpy(y).float().to(device)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)

    window = torch.hann_window(n_fft, device=device)
    spec = torch.stft(
        waveform,
        n_fft,
        hop_length=hop_length,
        window=window,
        return_complex=True,
    )
    power = spec.abs().pow(2).squeeze(0)

    freqs = torch.fft.rfftfreq(n_fft, d=1.0 / sr).to(device)
    freqs[0] = 1e-6
    midi = 69 + 12 * torch.log2(freqs / 440.0)
    pitch_class = (midi.round().long() % 12)

    chroma = torch.zeros(12, power.shape[1], device=device)
    for pitch in range(12):
        mask = pitch_class == pitch
        if mask.any():
            chroma[pitch] = power[mask].sum(dim=0)

    chroma = chroma / (chroma.amax(dim=0, keepdim=True) + 1e-6)
    return chroma.cpu().numpy()


def compute_chroma(y: np.ndarray, sr: int) -> tuple[np.ndarray, str]:
    from app.infrastructure.ml.device import get_compute_device, get_compute_device_info

    info = get_compute_device_info()
    if info.available:
        device = get_compute_device()
        return compute_chroma_stft(y, sr, device), "cuda"

    import librosa

    return librosa.feature.chroma_cqt(y=y, sr=sr), "cpu"
