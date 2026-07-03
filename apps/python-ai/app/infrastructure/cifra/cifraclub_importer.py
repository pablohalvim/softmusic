from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app.logging import logger

CIFRA_CLUB_HOSTS = {"www.cifraclub.com.br", "cifraclub.com.br"}
SECTION_PATTERN = re.compile(r"^\[(.+?)\]\s*(.*)$")
CHORD_TAG_PATTERN = re.compile(r"<b>(.*?)</b>", re.IGNORECASE)
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
TAB_BLOCK_PATTERN = re.compile(r"<span class=\"tablatura\">.*?</span>", re.IGNORECASE | re.DOTALL)


@dataclass(frozen=True)
class CifraClubImportResult:
    url: str
    title: str | None
    artist: str | None
    key: str | None
    mode: str
    sections: list[dict[str, Any]]


def is_cifra_club_url(url: str) -> bool:
    parsed = urlparse(url.strip())
    return parsed.netloc.lower() in CIFRA_CLUB_HOSTS and parsed.path.count("/") >= 2


def _extract_chords(raw_line: str) -> list[str]:
    chords = [unescape(match).strip() for match in CHORD_TAG_PATTERN.findall(raw_line)]
    return [chord for chord in chords if chord]


def _strip_html(raw_line: str) -> str:
    without_tabs = TAB_BLOCK_PATTERN.sub("", raw_line)
    without_tags = HTML_TAG_PATTERN.sub("", without_tabs)
    return unescape(without_tags).replace("\xa0", " ").strip()


def _is_chord_only_line(raw_line: str) -> bool:
    chords = _extract_chords(raw_line)
    if not chords:
        return False
    remainder = CHORD_TAG_PATTERN.sub("", raw_line)
    remainder = HTML_TAG_PATTERN.sub("", remainder)
    return not remainder.strip()


def _chord_line_to_placements(chord_raw: str, lyrics: str) -> list[dict[str, Any]]:
    placements: list[dict[str, Any]] = []
    for match in CHORD_TAG_PATTERN.finditer(chord_raw):
        chord = unescape(match.group(1)).strip()
        if not chord:
            continue
        prefix = chord_raw[: match.start()]
        prefix_visual = unescape(HTML_TAG_PATTERN.sub("", prefix))
        offset = min(len(prefix_visual), max(0, len(lyrics)))
        placements.append(
            {
                "id": f"p-{offset}-{chord}",
                "chord": chord,
                "offset": offset,
            }
        )
    return placements


def _inline_line_to_placements(raw_line: str) -> tuple[str, list[dict[str, Any]]]:
    placements: list[dict[str, Any]] = []
    lyrics_parts: list[str] = []
    cursor = 0
    last_index = 0

    for match in CHORD_TAG_PATTERN.finditer(raw_line):
        before = _strip_html(raw_line[last_index : match.start()])
        lyrics_parts.append(before)
        cursor += len(before)
        chord = unescape(match.group(1)).strip()
        if chord:
            placements.append(
                {
                    "id": f"p-{cursor}-{chord}",
                    "chord": chord,
                    "offset": cursor,
                }
            )
        last_index = match.end()

    lyrics_parts.append(_strip_html(raw_line[last_index:]))
    lyrics = "".join(lyrics_parts)
    return lyrics, placements


def parse_cifra_pre_content(pre_html: str) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    current_section: dict[str, Any] | None = None
    pending_chord_line: str | None = None
    line_index = 0

    def ensure_section(label: str) -> dict[str, Any]:
        nonlocal current_section, line_index
        if current_section is None or current_section["label"] != label:
            current_section = {
                "id": f"section-{len(sections)}",
                "label": label,
                "lines": [],
            }
            sections.append(current_section)
        return current_section

    def append_line(
        lyrics: str,
        placements: list[dict[str, Any]],
        chords: list[str] | None = None,
    ) -> None:
        nonlocal line_index, pending_chord_line
        if not current_section:
            current_section_ref = ensure_section("Cifra")
        else:
            current_section_ref = current_section
        if not placements and not lyrics:
            pending_chord_line = None
            return
        current_section_ref["lines"].append(
            {
                "id": f"{current_section_ref['id']}-line-{line_index}",
                "lyrics": lyrics,
                "placements": placements,
                "chords": chords or [item["chord"] for item in placements],
            }
        )
        line_index += 1
        pending_chord_line = None

    for raw_line in pre_html.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        if "tablatura" in stripped.lower():
            continue

        plain = _strip_html(stripped)
        section_match = SECTION_PATTERN.match(plain)
        if section_match:
            label = section_match.group(1).strip()
            trailing = section_match.group(2).strip()
            ensure_section(label)
            if trailing:
                inline_lyrics, inline_placements = _inline_line_to_placements(stripped)
                if inline_placements:
                    append_line(inline_lyrics, inline_placements)
                else:
                    chords = _extract_chords(stripped)
                    if chords:
                        append_line("", _chord_line_to_placements(stripped, ""), chords)
            continue

        if _is_chord_only_line(stripped):
            pending_chord_line = stripped
            continue

        inline_chords = _extract_chords(stripped)
        if inline_chords and plain and any(f"<b>{chord}" in stripped for chord in inline_chords):
            lyrics, placements = _inline_line_to_placements(stripped)
            append_line(lyrics, placements)
            continue

        lyrics = plain
        if pending_chord_line:
            placements = _chord_line_to_placements(pending_chord_line, lyrics)
            append_line(lyrics, placements)
            continue

        append_line(lyrics, [], [])

    if pending_chord_line and current_section:
        placements = _chord_line_to_placements(pending_chord_line, "")
        append_line("", placements)

    return sections


def _extract_pre_html(html: str) -> str:
    matches = re.findall(r"<pre[^>]*>(.+?)</pre>", html, re.IGNORECASE | re.DOTALL)
    if not matches:
        raise ValueError("Cifra não encontrada na página do Cifra Club")

    for content in matches:
        stripped = content.strip()
        if not stripped:
            continue
        if "<b>" in stripped.lower() or SECTION_PATTERN.match(_strip_html(stripped.splitlines()[0].strip())):
            return stripped

    return matches[0].strip()


def _extract_title(html: str) -> str | None:
    match = re.search(r"<h1[^>]*class=\"[^\"]*t1[^\"]*\"[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
    if not match:
        match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = _strip_html(match.group(1))
    title = re.sub(r"\s*-\s*Cifra Club.*$", "", title, flags=re.IGNORECASE).strip()
    return title or None


def _extract_artist(html: str, page_args: dict[str, Any]) -> str | None:
    artist_slug = page_args.get("artista")
    if isinstance(artist_slug, str):
        return artist_slug.replace("-", " ").title()
    match = re.search(r"class=\"[^\"]*artist[^\"]*\"[^>]*>(.*?)</", html, re.IGNORECASE | re.DOTALL)
    if match:
        return _strip_html(match.group(1)) or None
    return None


def _extract_key(html: str) -> str | None:
    match = re.search(r'id=\"cifra_tom\"[^>]*>\s*([A-G](?:#|b)?m?)\s*<', html, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"Tom:\s*([A-G](?:#|b)?m?)", html, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def _extract_page_args(html: str) -> dict[str, Any]:
    match = re.search(r"window\.__pageArgs\s*=\s*(\{.*?\});\s*</script>", html, re.DOTALL)
    if not match:
        return {}
    return json.loads(match.group(1))


class CifraClubImporter:
    def __init__(self, timeout: float = 30.0) -> None:
        self.timeout = timeout

    def fetch(self, url: str) -> CifraClubImportResult:
        if not is_cifra_club_url(url):
            raise ValueError("URL do Cifra Club inválida")

        response = httpx.get(
            url.strip(),
            headers={"User-Agent": "SoftMusic/0.1 (+https://github.com/softmusic)"},
            follow_redirects=True,
            timeout=self.timeout,
        )
        response.raise_for_status()

        html = response.text
        page_args = _extract_page_args(html)
        pre_html = _extract_pre_html(html)
        sections = parse_cifra_pre_content(pre_html)
        if not sections:
            raise ValueError("Não foi possível interpretar a cifra do Cifra Club")

        key = _extract_key(html)
        if key:
            key = key[0].upper() + key[1:]
        mode = "minor" if key and key.lower().endswith("m") else "major"
        if key and key.lower().endswith("m"):
            key = key[:-1]

        title = _extract_title(html)
        artist = _extract_artist(html, page_args)

        logger.info(
            "cifra_club_imported",
            url=url,
            sections=len(sections),
            lines=sum(len(section["lines"]) for section in sections),
        )

        return CifraClubImportResult(
            url=url.strip(),
            title=title,
            artist=artist,
            key=key,
            mode=mode,
            sections=sections,
        )

    @staticmethod
    def to_payload(result: CifraClubImportResult) -> dict[str, Any]:
        return {
            "source": "cifra_club",
            "url": result.url,
            "title": result.title,
            "artist": result.artist,
            "key": result.key,
            "mode": result.mode,
            "sections": result.sections,
        }

    @staticmethod
    def save(result: CifraClubImportResult, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(CifraClubImporter.to_payload(result), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return output_path

    @staticmethod
    def load(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
