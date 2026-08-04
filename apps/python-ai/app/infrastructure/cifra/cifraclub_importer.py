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
# Formato clássico: <b>G</b>. Formato atual: <b data-chord-name="G" ...>G</b>.
CHORD_TAG_PATTERN = re.compile(r"<b>(.*?)</b>", re.IGNORECASE)
RAW_B_TAG_PATTERN = re.compile(r"<b(\s[^>]*)?>(.*?)</b>", re.IGNORECASE | re.DOTALL)
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
TAB_BLOCK_PATTERN = re.compile(r"<span class=\"tablatura\">.*?</span>", re.IGNORECASE | re.DOTALL)
# Wrappers do layout novo do Cifra Club (não fazem parte da cifra).
CIFRA_WRAPPER_PATTERN = re.compile(
    r"</?div\b[^>]*>|</?span\b(?![^>]*tablatura)[^>]*>",
    re.IGNORECASE,
)


def _normalize_chord_tags(html: str) -> str:
    """Normaliza ``<b data-chord-name="D" ...>D</b>`` → ``<b>D</b>`` (parser legado)."""

    def repl(match: re.Match[str]) -> str:
        attrs = match.group(1) or ""
        inner = match.group(2) or ""
        name_match = re.search(r'data-chord-name=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
        chord = unescape(name_match.group(1) if name_match else inner).strip()
        if not chord:
            return ""
        return f"<b>{chord}</b>"

    return RAW_B_TAG_PATTERN.sub(repl, html)


def _preprocess_cifra_html(html: str) -> str:
    """Remove wrappers e normaliza tags de acorde do markup atual do Cifra Club."""
    without_wrappers = CIFRA_WRAPPER_PATTERN.sub("", html)
    return _normalize_chord_tags(without_wrappers)


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


def _visual_text(raw_line: str, *, trim: bool = False) -> str:
    """Texto visível monoespaçado; por padrão preserva espaços (alinhamento da cifra)."""
    without_tabs = TAB_BLOCK_PATTERN.sub("", raw_line)
    without_tags = HTML_TAG_PATTERN.sub("", without_tabs)
    text = unescape(without_tags).replace("\xa0", " ")
    return text.strip() if trim else text


def _strip_html(raw_line: str) -> str:
    return _visual_text(raw_line, trim=True)


def _is_chord_only_line(raw_line: str) -> bool:
    chords = _extract_chords(raw_line)
    if not chords:
        return False
    remainder = CHORD_TAG_PATTERN.sub("", raw_line)
    remainder = HTML_TAG_PATTERN.sub("", remainder)
    return not remainder.strip()


def _chord_line_to_placements(chord_raw: str, lyrics: str = "") -> list[dict[str, Any]]:
    """Converte linha de acordes em placements com ``offset`` = coluna monoespaçada.

    No ``<pre>`` do Cifra Club o texto do acorde é visível e ocupa colunas; o gap
    entre ``</b>`` e o próximo ``<b>`` é só o espaço *entre* nomes. Por isso o
    cursor avança com ``len(chord)`` + gaps — igual ao que o browser mostra.

    Não limita o offset ao tamanho da letra (Intro/Solo e acordes além do fim).
    """
    del lyrics  # API mantida; alinhamento vem só da linha de acordes.
    placements: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    cursor = 0
    last_index = 0
    for match in CHORD_TAG_PATTERN.finditer(chord_raw):
        cursor += len(_visual_text(chord_raw[last_index : match.start()]))
        chord = unescape(match.group(1)).strip()
        if chord:
            placement_id = f"p-{cursor}-{chord}"
            if placement_id in used_ids:
                placement_id = f"p-{cursor}-{chord}-{len(used_ids)}"
            used_ids.add(placement_id)
            placements.append(
                {
                    "id": placement_id,
                    "chord": chord,
                    "offset": cursor,
                }
            )
            cursor += len(chord)
        last_index = match.end()
    return placements


def _inline_line_to_placements(raw_line: str) -> tuple[str, list[dict[str, Any]]]:
    placements: list[dict[str, Any]] = []
    lyrics_parts: list[str] = []
    cursor = 0
    last_index = 0

    for match in CHORD_TAG_PATTERN.finditer(raw_line):
        # Preserva espaços entre acordes/sílabas — sem .strip() no meio.
        before = _visual_text(raw_line[last_index : match.start()])
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

    lyrics_parts.append(_visual_text(raw_line[last_index:]))
    lyrics = "".join(lyrics_parts)
    return lyrics, placements


def _section_trailing_chord_placements(raw_line: str) -> list[dict[str, Any]]:
    """Acordes na mesma linha do cabeçalho ``[Intro] D Bm …`` — só a região após ``]``."""
    bracket = raw_line.find("]")
    if bracket < 0:
        return []
    region = raw_line[bracket + 1 :]
    if not _extract_chords(region):
        return []
    # Remove só o espaço logo após ``]``; mantém gaps entre acordes.
    return _chord_line_to_placements(region.lstrip(" \t"))


def parse_cifra_pre_content(pre_html: str) -> list[dict[str, Any]]:
    pre_html = _preprocess_cifra_html(pre_html)
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
        # rstrip: NÃO remover espaços à esquerda — eles definem a coluna do acorde.
        stripped = raw_line.rstrip("\r\n")
        if not stripped.strip():
            continue
        if "tablatura" in stripped.lower():
            continue

        plain = _strip_html(stripped)
        section_match = SECTION_PATTERN.match(plain)
        if section_match:
            # Flush acordes instrumentais pendentes antes de trocar de seção
            # (ex.: 2ª linha do Solo antes de ``[Tab - Solo]``).
            if pending_chord_line and current_section:
                append_line("", _chord_line_to_placements(pending_chord_line))
            label = section_match.group(1).strip()
            ensure_section(label)
            trailing_placements = _section_trailing_chord_placements(stripped)
            if trailing_placements:
                append_line("", trailing_placements)
            continue

        if _is_chord_only_line(stripped):
            pending_chord_line = stripped
            continue

        inline_chords = _extract_chords(stripped)
        if inline_chords and plain and CHORD_TAG_PATTERN.search(stripped):
            lyrics, placements = _inline_line_to_placements(stripped)
            # Só trata como inline se sobrou letra além dos acordes.
            if lyrics.strip():
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
        lower = stripped.lower()
        has_chords = (
            "<b>" in lower
            or "data-chord-name=" in lower
            or RAW_B_TAG_PATTERN.search(stripped) is not None
        )
        first_plain = _strip_html(_preprocess_cifra_html(stripped.splitlines()[0].strip()))
        if has_chords or SECTION_PATTERN.match(first_plain):
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
    # Layout atual: botão de tom com data-anchor="--chord-tone".
    match = re.search(
        r'data-anchor=["\']--chord-tone["\'][^>]*>\s*([A-G](?:#|b)?m?)\s*<',
        html,
        re.IGNORECASE,
    )
    if match:
        return match.group(1).strip()

    match = re.search(r'id=["\']cifra_tom["\'][^>]*>\s*([A-G](?:#|b)?m?)\s*<', html, re.IGNORECASE)
    if match:
        return match.group(1).strip()

    # "Tom: <button>D</button>"
    match = re.search(r"Tom:\s*<[^>]*>\s*([A-G](?:#|b)?m?)\s*<", html)
    if match:
        return match.group(1).strip()

    # Texto "Tom: D" — case-sensitive para NÃO casar CSS tipo ``tom:calc(...)``.
    match = re.search(r"(?:^|>|\s)Tom:\s*([A-G](?:#|b)?m?)\b", html)
    if match:
        return match.group(1).strip()

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
