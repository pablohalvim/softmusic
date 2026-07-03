import numpy as np

from app.infrastructure.ml.stem_harmony import (
    chord_label_for_pitch,
    estimate_chord_progression,
    roman_and_function,
)


def test_roman_for_A_major_tonic() -> None:
    pitch = 9  # A
    roman, function = roman_and_function(pitch, "A", "major")
    assert roman == "I"
    assert function == "tonic"


def test_chord_label_F_sharp_minor_in_A_major() -> None:
    pitch = 6  # F#
    assert chord_label_for_pitch(pitch, "A", "major") == "F#m"


def test_progression_covers_multiple_segments() -> None:
    chroma = np.zeros((12, 32))
    chroma[9, :] = 1.0
    chroma[6, 8:16] = 1.0
    chroma[4, 16:24] = 1.0
    beat_times = [float(index) for index in range(17)]
    progression = estimate_chord_progression(chroma, beat_times, "A", "major", max_segments=8)
    assert len(progression) >= 3
    assert progression[0]["chord"] == "A"
