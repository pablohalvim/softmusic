"""Testes do detector de tom (ensemble + dica da cifra)."""

from __future__ import annotations

import numpy as np

from app.infrastructure.ml.key_detector import KEY_NAMES, estimate_key


def _synth_key_chroma(tonic: int, mode: str = "major", frames: int = 64) -> np.ndarray:
    """Gera chroma sintético com tônica, dominante e progressão I–V–vi–IV / i–VII–VI–VII."""
    chroma = np.zeros((12, frames), dtype=np.float64)
    if mode == "major":
        # I V vi IV I (padrão pop com retorno à tônica)
        pattern = [
            tonic,
            (tonic + 7) % 12,
            (tonic + 9) % 12,
            (tonic + 5) % 12,
            tonic,
        ]
        thirds = [4, 4, 3, 4, 4]
    else:
        # i bVII bVI i — comum em pop/rock menor, com retorno à tônica
        pattern = [
            tonic,
            (tonic + 10) % 12,
            (tonic + 8) % 12,
            tonic,
        ]
        thirds = [3, 3, 3, 3]

    segment = frames // len(pattern)
    for index, root in enumerate(pattern):
        start = index * segment
        end = frames if index == len(pattern) - 1 else (index + 1) * segment
        third = (root + thirds[index]) % 12
        fifth = (root + 7) % 12
        chroma[root, start:end] = 1.0
        chroma[third, start:end] = 0.7
        chroma[fifth, start:end] = 0.8

    # Reforça tônica no início e no fim (cadência)
    chroma[tonic, : max(2, frames // 16)] += 0.5
    chroma[tonic, -max(2, frames // 16) :] += 0.6
    chroma[(tonic + 7) % 12, -max(4, frames // 8) : -max(2, frames // 16)] += 0.4
    return chroma


def test_detects_d_major_not_dominant_a() -> None:
    """Caso clássico: muita presença de A (V) não deve virar tom A."""
    chroma = _synth_key_chroma(KEY_NAMES.index("D"), "major", frames=96)
    # Injeta frames extras de dominante (como no áudio real)
    chroma[KEY_NAMES.index("A"), 20:40] += 0.9
    beat_times = [float(i) for i in range(33)]
    result = estimate_key(chroma, beat_times=beat_times)
    assert result.key == "D"
    assert result.mode == "major"


def test_detects_a_major_when_truly_a() -> None:
    chroma = _synth_key_chroma(KEY_NAMES.index("A"), "major")
    result = estimate_key(chroma, beat_times=[float(i) for i in range(17)])
    assert result.key == "A"
    assert result.mode == "major"


def test_detects_e_minor() -> None:
    chroma = _synth_key_chroma(KEY_NAMES.index("E"), "minor")
    result = estimate_key(chroma, beat_times=[float(i) for i in range(17)])
    assert result.key == "E"
    assert result.mode == "minor"


def test_cifra_hint_resolves_close_candidates() -> None:
    """Quando D e A ficam próximos, a dica da cifra (D) prevalece se estiver no top."""
    chroma = _synth_key_chroma(KEY_NAMES.index("D"), "major", frames=80)
    # Empurra o perfil um pouco na direção de A
    chroma[KEY_NAMES.index("A"), :] += 0.35
    chroma[KEY_NAMES.index("C#"), :] += 0.2
    result = estimate_key(
        chroma,
        beat_times=[float(i) for i in range(25)],
        hint_key="D",
        hint_mode="major",
    )
    assert result.key == "D"
    assert result.mode == "major"
    assert result.method == "ensemble+hint"


def test_hint_flat_key_normalized() -> None:
    chroma = _synth_key_chroma(KEY_NAMES.index("A#"), "major")
    result = estimate_key(chroma, hint_key="Bb")
    assert result.key == "A#"
    assert result.mode == "major"


def test_hint_minor_suffix() -> None:
    chroma = _synth_key_chroma(KEY_NAMES.index("A"), "minor")
    result = estimate_key(chroma, hint_key="Am")
    assert result.key == "A"
    assert result.mode == "minor"
