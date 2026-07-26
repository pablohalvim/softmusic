"""Autocomplete de endereços via Photon + Nominatim (OpenStreetMap) — sem Google/billing."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

PHOTON_BASE = "https://photon.komoot.io"
NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
# Centro aproximado do Brasil (bias de relevância).
BRAZIL_LAT = -14.235
BRAZIL_LON = -51.9253
USER_AGENT = "SoftMusic/1.0 (https://softmusic.com.br; contato@softmusic.com.br)"

# Cache simples em memória (processo) para reduzir chamadas repetidas.
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL_SEC = 120.0
_MIN_INTERVAL_SEC = 0.35
_last_request_at = 0.0
_lock = asyncio.Lock()

# Captura número do imóvel na digitação do usuário (evita CEP 8 dígitos).
_HOUSE_NUMBER_RE = re.compile(
    r"(?:,\s*|\s+)(?:n[º°o]\.?\s*|n[uú]mero\s+)?(\d{1,5}[A-Za-z]?)\b(?!\s*-?\d{3})",
    re.IGNORECASE,
)


def _extract_housenumber(query: str) -> str | None:
    matches = _HOUSE_NUMBER_RE.findall(query)
    if not matches:
        return None
    # Prefere o primeiro número “de rua” (geralmente após o logradouro).
    for candidate in matches:
        digits = re.sub(r"\D", "", candidate)
        # CEP brasileiro tem 8 dígitos; ignora.
        if len(digits) >= 7:
            continue
        return candidate.strip()
    return None


def _inject_housenumber(formatted: str, housenumber: str) -> str:
    """Garante que o número digitado apareça no endereço formatado."""
    if not housenumber:
        return formatted
    # Já contém o número (como token).
    if re.search(rf"(?<!\d){re.escape(housenumber)}(?!\d)", formatted, re.IGNORECASE):
        return formatted

    parts = [part.strip() for part in formatted.split(",") if part.strip()]
    if not parts:
        return f"{formatted}, {housenumber}"

    # Insere o número logo após o logradouro (1ª parte).
    street = parts[0]
    rest = parts[1:]
    return ", ".join([f"{street}, {housenumber}", *rest])


def _format_address(props: dict[str, Any], *, preferred_housenumber: str | None = None) -> str:
    parts: list[str] = []
    street = props.get("street") or props.get("name")
    housenumber = props.get("housenumber") or preferred_housenumber
    if street and housenumber:
        parts.append(f"{street}, {housenumber}")
    elif street:
        parts.append(str(street))
    elif props.get("name"):
        parts.append(str(props["name"]))

    for key in (
        "suburb",
        "neighbourhood",
        "district",
        "locality",
        "city",
        "town",
        "municipality",
        "county",
        "state",
        "postcode",
    ):
        value = props.get(key)
        if value and str(value) not in parts:
            # Evita repetir o número se veio sozinho em algum campo.
            if preferred_housenumber and str(value).strip() == preferred_housenumber:
                continue
            parts.append(str(value))

    country = props.get("country")
    if country and str(country) not in parts:
        parts.append(str(country))

    formatted = ", ".join(parts) if parts else str(props.get("name") or "Endereço")
    if preferred_housenumber and not props.get("housenumber"):
        formatted = _inject_housenumber(formatted, preferred_housenumber)
    return formatted


def _place_id(props: dict[str, Any], *, source: str = "photon") -> str | None:
    if source == "nominatim":
        osm_type = props.get("osm_type")
        osm_id = props.get("osm_id")
        if osm_type and osm_id is not None:
            prefix = {"node": "N", "way": "W", "relation": "R"}.get(str(osm_type), "X")
            return f"{prefix}{osm_id}"
        place_id = props.get("place_id")
        return f"N{place_id}" if place_id is not None else None

    osm_type = props.get("osm_type")
    osm_id = props.get("osm_id")
    if osm_type and osm_id is not None:
        prefix = str(osm_type)[0].upper()
        return f"{prefix}{osm_id}"
    return None


def _feature_to_item(
    feature: dict[str, Any],
    *,
    preferred_housenumber: str | None = None,
) -> dict[str, Any] | None:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates")
    props = feature.get("properties") or {}
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    try:
        lng = float(coords[0])
        lat = float(coords[1])
    except (TypeError, ValueError):
        return None

    countrycode = str(props.get("countrycode") or "").lower()
    country = str(props.get("country") or "").casefold()
    if countrycode and countrycode != "br":
        return None
    if not countrycode and country and country not in {"brasil", "brazil", "br"}:
        return None

    formatted = _format_address(props, preferred_housenumber=preferred_housenumber)
    place_id = _place_id(props)
    has_number = bool(props.get("housenumber"))
    return {
        "description": formatted,
        "formatted_address": formatted,
        "lat": lat,
        "lng": lng,
        "place_id": place_id,
        "housenumber": props.get("housenumber") or preferred_housenumber,
        "_has_osm_housenumber": has_number,
    }


def _nominatim_to_item(
    row: dict[str, Any],
    *,
    preferred_housenumber: str | None = None,
) -> dict[str, Any] | None:
    try:
        lat = float(row["lat"])
        lng = float(row["lon"])
    except (KeyError, TypeError, ValueError):
        return None

    address = row.get("address") if isinstance(row.get("address"), dict) else {}
    countrycode = str(address.get("country_code") or "").lower()
    if countrycode and countrycode != "br":
        return None

    props = {
        "street": address.get("road") or address.get("pedestrian") or address.get("residential"),
        "housenumber": address.get("house_number") or preferred_housenumber,
        "suburb": address.get("suburb") or address.get("neighbourhood"),
        "neighbourhood": address.get("neighbourhood"),
        "city": address.get("city")
        or address.get("town")
        or address.get("municipality")
        or address.get("village"),
        "state": address.get("state"),
        "postcode": address.get("postcode"),
        "country": address.get("country") or "Brasil",
        "name": row.get("name") or address.get("road"),
        "osm_type": row.get("osm_type"),
        "osm_id": row.get("osm_id"),
        "place_id": row.get("place_id"),
    }
    formatted = _format_address(props, preferred_housenumber=preferred_housenumber)
    # Fallback: display_name do Nominatim, ainda injetando número se faltar.
    if not props.get("street") and row.get("display_name"):
        formatted = str(row["display_name"])
        if preferred_housenumber:
            formatted = _inject_housenumber(formatted, preferred_housenumber)

    return {
        "description": formatted,
        "formatted_address": formatted,
        "lat": lat,
        "lng": lng,
        "place_id": _place_id(props, source="nominatim"),
        "housenumber": props.get("housenumber"),
        "_has_osm_housenumber": bool(address.get("house_number")),
    }


def _dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in items:
        key = item.get("place_id") or f"{item.get('formatted_address')}|{item.get('lat')}|{item.get('lng')}"
        if key in seen:
            continue
        seen.add(str(key))
        out.append(item)
    return out


def _rank_items(
    items: list[dict[str, Any]],
    *,
    preferred_housenumber: str | None,
) -> list[dict[str, Any]]:
    def score(item: dict[str, Any]) -> tuple[int, int, str]:
        has_osm_number = 1 if item.get("_has_osm_housenumber") else 0
        has_any_number = 1 if item.get("housenumber") else 0
        number_match = 0
        if preferred_housenumber and str(item.get("housenumber") or "").casefold() == preferred_housenumber.casefold():
            number_match = 1
        # Maior primeiro; desempate alfabético estável.
        return (-number_match, -has_osm_number, -has_any_number, str(item.get("formatted_address") or ""))

    ranked = sorted(items, key=score)
    for item in ranked:
        item.pop("_has_osm_housenumber", None)
        item.pop("housenumber", None)
    return ranked


async def _rate_limited_get(url: str, params: dict[str, str]) -> dict[str, Any] | list[Any]:
    global _last_request_at
    async with _lock:
        wait = _MIN_INTERVAL_SEC - (time.monotonic() - _last_request_at)
        if wait > 0:
            await asyncio.sleep(wait)
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                url,
                params=params,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
        _last_request_at = time.monotonic()
        response.raise_for_status()
        return response.json()


async def _photon_search(query: str, *, limit: int, housenumber: str | None) -> list[dict[str, Any]]:
    params = {
        "q": query,
        "lang": "default",
        "limit": str(max(1, min(limit, 12))),
        "lat": str(BRAZIL_LAT),
        "lon": str(BRAZIL_LON),
        "countrycode": "br",
    }
    try:
        payload = await _rate_limited_get(f"{PHOTON_BASE}/api/", params)
    except Exception as exc:
        logger.warning("photon_autocomplete_failed", query=query, error=str(exc))
        return []

    features = payload.get("features") if isinstance(payload, dict) else None
    items: list[dict[str, Any]] = []
    if isinstance(features, list):
        for feature in features:
            if not isinstance(feature, dict):
                continue
            item = _feature_to_item(feature, preferred_housenumber=housenumber)
            if item:
                items.append(item)
    return items


async def _nominatim_search(query: str, *, limit: int, housenumber: str | None) -> list[dict[str, Any]]:
    params = {
        "q": query,
        "format": "json",
        "addressdetails": "1",
        "limit": str(max(1, min(limit, 8))),
        "countrycodes": "br",
    }
    try:
        payload = await _rate_limited_get(f"{NOMINATIM_BASE}/search", params)
    except Exception as exc:
        logger.warning("nominatim_autocomplete_failed", query=query, error=str(exc))
        return []

    if not isinstance(payload, list):
        return []

    items: list[dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        item = _nominatim_to_item(row, preferred_housenumber=housenumber)
        if item:
            items.append(item)
    return items


async def autocomplete_places(query: str, *, limit: int = 8) -> list[dict[str, Any]]:
    q = query.strip()
    if len(q) < 3:
        return []

    cache_key = q.casefold()
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL_SEC:
        return cached[1]

    housenumber = _extract_housenumber(q)
    items: list[dict[str, Any]] = []

    # Com número do imóvel, Nominatim costuma acertar melhor lat/lng + house_number.
    if housenumber:
        items.extend(await _nominatim_search(q, limit=limit, housenumber=housenumber))

    photon_items = await _photon_search(q, limit=limit, housenumber=housenumber)
    items.extend(photon_items)

    if not items and housenumber:
        # Última tentativa sem o número (só rua/cidade), injetando o número na label.
        street_query = _HOUSE_NUMBER_RE.sub(" ", q)
        street_query = re.sub(r"\s+", " ", street_query).strip(" ,")
        if street_query and street_query.casefold() != q.casefold():
            items.extend(await _photon_search(street_query, limit=limit, housenumber=housenumber))

    if not items:
        ranked: list[dict[str, Any]] = []
    else:
        ranked = _rank_items(_dedupe_items(items), preferred_housenumber=housenumber)[:limit]
    _CACHE[cache_key] = (time.monotonic(), ranked)
    if len(_CACHE) > 256:
        oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:64]
        for key, _ in oldest:
            _CACHE.pop(key, None)
    return ranked
