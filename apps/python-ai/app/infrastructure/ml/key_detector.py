"""Detecção de tom musical mais robusta que KS puro em chroma médio.

Combina:
1. Perfis Temperley + Krumhansl–Kessler (correlação com histograma de chroma)
2. Votação por raiz de acorde ao longo do tempo
3. Bônus de cadências V→I / iv→i / IV→I
4. Peso maior no início e no fim da música
5. Dica opcional (ex.: tom do Cifra Club) quando está entre as melhores hipóteses
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from app.infrastructure.ml.key_theory import parse_key

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl–Kessler (classic)
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], dtype=np.float64)
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], dtype=np.float64)

# Temperley (1999) — menos viés para menor
TEMPERLEY_MAJOR = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0], dtype=np.float64)
TEMPERLEY_MINOR = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0], dtype=np.float64)

# Albrecht & Shanahan (2013) — corpus contemporâneo
AS_MAJOR = np.array([0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081], dtype=np.float64)
AS_MINOR = np.array([0.220, 0.006, 0.104, 0.131, 0.010, 0.090, 0.008, 0.192, 0.101, 0.011, 0.059, 0.068], dtype=np.float64)

MAJOR_INTERVALS = (0, 2, 4, 5, 7, 9, 11)
MINOR_INTERVALS = (0, 2, 3, 5, 7, 8, 10)


@dataclass(frozen=True)
class KeyEstimate:
    key: str
    mode: str
    confidence: float
    scores: dict[str, float]
    method: str


def _safe_corr(a: np.ndarray, b: np.ndarray) -> float:
    if a.size != b.size or a.size == 0:
        return -1.0
    if float(np.std(a)) < 1e-9 or float(np.std(b)) < 1e-9:
        return -1.0
    value = float(np.corrcoef(a, b)[0, 1])
    if np.isnan(value):
        return -1.0
    return value


def _normalize_hint(key: str | None, mode: str | None) -> tuple[str | None, str | None]:
    if not key:
        return None, None
    try:
        root, is_minor = parse_key(key, mode)
    except Exception:
        return None, None
    if root not in KEY_NAMES:
        return None, None
    return root, ("minor" if is_minor else "major")


def _chroma_histogram(chroma: np.ndarray) -> np.ndarray:
    """Histograma de pitch-class ponderado; frames fracos entram menos."""
    if chroma.ndim != 2 or chroma.shape[0] != 12 or chroma.shape[1] == 0:
        return np.zeros(12, dtype=np.float64)
    strengths = chroma.sum(axis=0)
    if float(np.max(strengths)) <= 0:
        return np.zeros(12, dtype=np.float64)
    # Soft threshold: ignora frames quase silenciosos
    mask = strengths >= (0.15 * float(np.max(strengths)))
    if not np.any(mask):
        mask = strengths > 0
    weighted = chroma[:, mask] * strengths[mask]
    hist = weighted.sum(axis=1).astype(np.float64)
    total = float(hist.sum())
    if total > 0:
        hist /= total
    return hist


def _profile_scores(hist: np.ndarray) -> dict[tuple[str, str], float]:
    scores: dict[tuple[str, str], float] = {}
    profiles = (
        (KK_MAJOR, KK_MINOR, 0.25),
        (TEMPERLEY_MAJOR, TEMPERLEY_MINOR, 0.40),
        (AS_MAJOR, AS_MINOR, 0.35),
    )
    for major_profile, minor_profile, weight in profiles:
        for i in range(12):
            maj = _safe_corr(hist, np.roll(major_profile, i))
            minr = _safe_corr(hist, np.roll(minor_profile, i))
            key = KEY_NAMES[i]
            scores[(key, "major")] = scores.get((key, "major"), 0.0) + weight * maj
            scores[(key, "minor")] = scores.get((key, "minor"), 0.0) + weight * minr
    return scores


def _best_triad_root(frame: np.ndarray) -> int:
    """Escolhe a raiz do acorde (maior/menor) que melhor explica o frame."""
    best_root = int(np.argmax(frame))
    best_score = -1.0
    for root in range(12):
        for third in (3, 4):
            triad = (
                float(frame[root])
                + 0.85 * float(frame[(root + third) % 12])
                + 0.75 * float(frame[(root + 7) % 12])
            )
            if triad > best_score:
                best_score = triad
                best_root = root
    return best_root


def _root_sequence(chroma: np.ndarray, beat_times: list[float] | None) -> list[int]:
    if chroma.ndim != 2 or chroma.shape[1] == 0:
        return []
    n_frames = chroma.shape[1]
    if beat_times and len(beat_times) >= 2:
        roots: list[int] = []
        duration = max(beat_times[-1], 1e-6)
        for index in range(len(beat_times) - 1):
            t0 = beat_times[index] / duration
            t1 = beat_times[min(index + 1, len(beat_times) - 1)] / duration
            f0 = min(n_frames - 1, max(0, int(t0 * n_frames)))
            f1 = min(n_frames, max(f0 + 1, int(t1 * n_frames)))
            window = chroma[:, f0:f1].mean(axis=1)
            roots.append(_best_triad_root(window))
        return roots
    step = max(1, n_frames // 64)
    return [_best_triad_root(chroma[:, i]) for i in range(0, n_frames, step)]


def _diatonic_fit(roots: list[int], tonic: int, mode: str) -> float:
    if not roots:
        return 0.0
    intervals = MAJOR_INTERVALS if mode == "major" else MINOR_INTERVALS
    scale = {(tonic + step) % 12 for step in intervals}
    hits = sum(1 for root in roots if root in scale)
    return hits / len(roots)


def _cadence_score(roots: list[int], tonic: int, mode: str) -> float:
    """Bônus para V→I / IV→I; em menor também bVII→i (comum em pop/rock)."""
    if len(roots) < 2:
        return 0.0
    dominant = (tonic + 7) % 12
    subdominant = (tonic + 5) % 12
    flat_seventh = (tonic + 10) % 12
    score = 0.0
    n = len(roots)
    for i in range(1, n):
        prev_root, root = roots[i - 1], roots[i]
        weight = 1.0 + (1.5 if i >= int(n * 0.75) else 0.0)
        if prev_root == dominant and root == tonic:
            score += 3.0 * weight
        elif prev_root == subdominant and root == tonic:
            score += 1.5 * weight
        elif mode == "minor" and prev_root == flat_seventh and root == tonic:
            score += 2.5 * weight
        elif root == tonic:
            score += 0.2 * weight
    return score / max(n, 1)


def _tonic_prominence(roots: list[int], tonic: int) -> float:
    if not roots:
        return 0.0
    n = len(roots)
    # Início + fim + frequência global
    start = roots[: max(1, n // 8)]
    end = roots[max(0, n - max(1, n // 8)) :]
    start_hit = sum(1 for r in start if r == tonic) / len(start)
    end_hit = sum(1 for r in end if r == tonic) / len(end)
    global_hit = sum(1 for r in roots if r == tonic) / n
    # Evita confundir dominante frequente com tônica: penaliza se V >> I
    dominant = (tonic + 7) % 12
    v_hit = sum(1 for r in roots if r == dominant) / n
    penalty = 0.0
    if v_hit > global_hit + 0.08:
        penalty = min(0.35, (v_hit - global_hit) * 1.5)
    return (0.35 * start_hit + 0.45 * end_hit + 0.35 * global_hit) - penalty


def estimate_key(
    chroma: np.ndarray,
    *,
    beat_times: list[float] | None = None,
    hint_key: str | None = None,
    hint_mode: str | None = None,
) -> KeyEstimate:
    hist = _chroma_histogram(chroma)
    profile_scores = _profile_scores(hist)
    roots = _root_sequence(chroma, beat_times)

    combined: dict[tuple[str, str], float] = {}
    details: dict[str, float] = {}

    # Normaliza scores de perfil para 0..1 relativo
    if profile_scores:
        max_p = max(profile_scores.values())
        min_p = min(profile_scores.values())
        span = max(max_p - min_p, 1e-9)
    else:
        span = 1.0
        min_p = 0.0

    for (key, mode), raw in profile_scores.items():
        profile_norm = (raw - min_p) / span
        tonic = KEY_NAMES.index(key)
        diatonic = _diatonic_fit(roots, tonic, mode)
        cadence = _cadence_score(roots, tonic, mode)
        prominence = _tonic_prominence(roots, tonic)
        # Pesos: perfil + estrutura harmônica (cadência/tônica evitam A quando a música é D)
        total = (
            0.35 * profile_norm
            + 0.18 * diatonic
            + 0.27 * min(1.0, cadence)
            + 0.20 * max(0.0, prominence)
        )
        combined[(key, mode)] = total
        details[f"{key}:{mode}"] = round(total, 4)

    if not combined:
        return KeyEstimate(key="C", mode="major", confidence=0.0, scores={}, method="fallback")

    ranked = sorted(combined.items(), key=lambda item: item[1], reverse=True)
    (best_key, best_mode), best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    confidence = float(max(0.0, min(1.0, best_score - second_score + 0.5 * best_score)))

    hint_root, hint_m = _normalize_hint(hint_key, hint_mode)
    method = "ensemble"
    if hint_root and hint_m:
        hint_score = combined.get((hint_root, hint_m), -1.0)
        # Cifra Club: se a hipótese estiver entre as melhores, confia no tom escrito.
        top5 = {(k, m) for (k, m), _ in ranked[:5]}
        if (hint_root, hint_m) in top5 or hint_score >= best_score - 0.18:
            best_key, best_mode = hint_root, hint_m
            best_score = max(best_score, hint_score)
            method = "ensemble+hint"
            confidence = max(confidence, 0.75)

    return KeyEstimate(
        key=best_key,
        mode=best_mode,
        confidence=round(confidence, 3),
        scores=details,
        method=method,
    )


def estimate_key_simple(chroma: np.ndarray) -> tuple[str, str]:
    """Compat: retorna só (key, mode)."""
    result = estimate_key(chroma)
    return result.key, result.mode


def key_estimate_as_dict(result: KeyEstimate) -> dict[str, Any]:
    return {
        "key": result.key,
        "mode": result.mode,
        "confidence": result.confidence,
        "method": result.method,
        "top_scores": dict(sorted(result.scores.items(), key=lambda kv: kv[1], reverse=True)[:5]),
    }
