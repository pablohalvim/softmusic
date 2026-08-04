"""Helpers for chromatic key transposition (same mode as original)."""

from __future__ import annotations

CHROMATIC_SHARP = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

_FLAT_TO_SHARP = {
    "Db": "C#",
    "Eb": "D#",
    "Gb": "F#",
    "Ab": "G#",
    "Bb": "A#",
    "Cb": "B",
    "Fb": "E",
}


def normalize_root(root: str) -> str:
    root = root.strip()
    if len(root) == 2 and root[1] == "b":
        return _FLAT_TO_SHARP.get(root, root)
    return root


def root_to_index(root: str) -> int:
    normalized = normalize_root(root)
    try:
        return CHROMATIC_SHARP.index(normalized)
    except ValueError as exc:
        raise ValueError(f"Tom inválido: {root}") from exc


def index_to_root(index: int) -> str:
    return CHROMATIC_SHARP[((index % 12) + 12) % 12]


def parse_key(key: str, mode: str | None = None) -> tuple[str, bool]:
    """Return (root, is_minor) from a key label like 'Em' or 'C'."""
    raw = (key or "").strip()
    is_minor = False
    if mode:
        is_minor = mode.strip().lower() in {"minor", "m"}
    lowered = raw.lower()
    if lowered.endswith(" minor"):
        raw = raw[: -len(" minor")]
        is_minor = True
    elif lowered.endswith(" major"):
        raw = raw[: -len(" major")]
        is_minor = False
    elif raw.endswith("m") and not raw.endswith("dim"):
        # Em, C#m — but not 'Am' false positive on single letter handled below
        if len(raw) >= 2:
            raw = raw[:-1]
            is_minor = True
    root = normalize_root(raw.strip())
    return root, is_minor


def format_key(root: str, is_minor: bool) -> str:
    return f"{normalize_root(root)}m" if is_minor else normalize_root(root)


def transpose_key(key: str, mode: str, semitones: int) -> str:
    root, is_minor = parse_key(key, mode)
    return format_key(index_to_root(root_to_index(root) + semitones), is_minor)


def semitones_between(source_key: str, target_key: str, mode: str) -> int:
    """Signed semitone distance (shortest path in ±6)."""
    source_root, source_minor = parse_key(source_key, mode)
    target_root, target_minor = parse_key(target_key, mode)
    if source_minor != target_minor:
        raise ValueError("O tom alvo deve estar no mesmo modo do original")
    delta = (root_to_index(target_root) - root_to_index(source_root)) % 12
    if delta > 6:
        delta -= 12
    return delta


def available_chromatic_targets(source_key: str, mode: str) -> list[str]:
    """11 chromatic keys in the same mode, excluding the original."""
    root, is_minor = parse_key(source_key, mode)
    source_label = format_key(root, is_minor)
    targets: list[str] = []
    for offset in range(1, 12):
        label = format_key(index_to_root(root_to_index(root) + offset), is_minor)
        if label != source_label:
            targets.append(label)
    return targets


def storage_key_segment(target_key: str) -> str:
    """Filesystem/R2-safe segment for a key label (C# → Cs)."""
    root, is_minor = parse_key(target_key)
    safe = normalize_root(root).replace("#", "s")
    return f"{safe}m" if is_minor else safe
