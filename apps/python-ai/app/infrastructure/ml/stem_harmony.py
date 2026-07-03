from __future__ import annotations

from typing import Any

import numpy as np

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"]
MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]


def _scale_pitch_classes(key: str, mode: str) -> list[int]:
    root = key.replace("m", "")
    if root not in KEY_NAMES:
        root = "C"
    idx = KEY_NAMES.index(root)
    intervals = MAJOR_INTERVALS if mode == "major" else MINOR_INTERVALS
    return [(idx + step) % 12 for step in intervals]


def roman_and_function(pitch_class: int, key: str, mode: str) -> tuple[str, str | None]:
    scale = _scale_pitch_classes(key, mode)
    romans = ROMAN_MAJOR if mode == "major" else ROMAN_MINOR
    try:
        degree_index = scale.index(pitch_class)
    except ValueError:
        return "?", None

    roman = romans[degree_index]
    if mode == "major":
        if degree_index in {0, 5}:
            function = "tonic"
        elif degree_index in {1, 3}:
            function = "subdominant"
        elif degree_index in {4, 6}:
            function = "dominant"
        else:
            function = "other"
    elif degree_index == 0:
        function = "tonic"
    elif degree_index == 3:
        function = "subdominant"
    elif degree_index == 4:
        function = "dominant"
    else:
        function = "other"
    return roman, function


def chord_label_for_pitch(pitch_class: int, key: str, mode: str) -> str:
    root = KEY_NAMES[pitch_class]
    scale = _scale_pitch_classes(key, mode)
    if pitch_class not in scale:
        return root

    degree_index = scale.index(pitch_class)
    if mode == "major":
        suffixes = ["", "m", "m", "", "", "m", "°"]
    else:
        suffixes = ["m", "°", "", "m", "m", "", ""]
    return f"{root}{suffixes[degree_index]}"


def estimate_chord_progression(
    chroma: np.ndarray,
    beat_times: list[float],
    key: str,
    mode: str,
    *,
    max_segments: int = 64,
) -> list[dict[str, Any]]:
    if not beat_times or chroma.size == 0:
        return []

    segment_count = min(len(beat_times) - 1, max_segments)
    step = max(1, (len(beat_times) - 1) // max(segment_count, 1))
    progression: list[dict[str, Any]] = []

    index = 0
    produced = 0
    while index < len(beat_times) - 1 and produced < max_segments:
        start = float(beat_times[index])
        end_index = min(index + step, len(beat_times) - 1)
        end = float(beat_times[end_index])
        frame = min(chroma.shape[1] - 1, int(index * chroma.shape[1] / max(len(beat_times) - 1, 1)))
        pitch_class = int(np.argmax(chroma[:, frame]))
        chord = chord_label_for_pitch(pitch_class, key, mode)
        roman, function = roman_and_function(pitch_class, key, mode)
        progression.append(
            {
                "start_seconds": start,
                "end_seconds": end,
                "chord": chord,
                "roman_numeral": roman,
                "function": function,
            }
        )
        index += step
        produced += 1

    return progression


def estimate_bass_progression(
    chroma: np.ndarray,
    beat_times: list[float],
    key: str,
    mode: str,
    *,
    max_segments: int = 64,
) -> list[dict[str, Any]]:
    progression = estimate_chord_progression(
        chroma,
        beat_times,
        key,
        mode,
        max_segments=max_segments,
    )
    for item in progression:
        root = item["chord"].replace("m", "").replace("°", "")
        item["note"] = root
        item["chord"] = root
    return progression
