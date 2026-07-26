"""Autocomplete de endereços via Photon (OpenStreetMap) — sem Google/billing."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

PHOTON_BASE = "https://photon.komoot.io"
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


def _format_address(props: dict[str, Any]) -> str:
    parts: list[str] = []
    street = props.get("street") or props.get("name")
    housenumber = props.get("housenumber")
    if street and housenumber:
        parts.append(f"{street}, {housenumber}")
    elif street:
        parts.append(str(street))
    elif props.get("name"):
        parts.append(str(props["name"]))

    for key in ("locality", "district", "neighbourhood", "suburb", "city", "county", "state", "postcode"):
        value = props.get(key)
        if value and str(value) not in parts:
            parts.append(str(value))

    country = props.get("country")
    if country and str(country) not in parts:
        parts.append(str(country))

    return ", ".join(parts) if parts else str(props.get("name") or "Endereço")


def _place_id(props: dict[str, Any]) -> str | None:
    osm_type = props.get("osm_type")
    osm_id = props.get("osm_id")
    if osm_type and osm_id is not None:
        prefix = str(osm_type)[0].upper()
        return f"{prefix}{osm_id}"
    return None


def _feature_to_item(feature: dict[str, Any]) -> dict[str, Any] | None:
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

    formatted = _format_address(props)
    place_id = _place_id(props)
    return {
        "description": formatted,
        "formatted_address": formatted,
        "lat": lat,
        "lng": lng,
        "place_id": place_id,
    }


async def autocomplete_places(query: str, *, limit: int = 8) -> list[dict[str, Any]]:
    q = query.strip()
    if len(q) < 3:
        return []

    cache_key = q.casefold()
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL_SEC:
        return cached[1]

    global _last_request_at
    async with _lock:
        # Respeita o uso razoável da instância pública do Photon.
        wait = _MIN_INTERVAL_SEC - (time.monotonic() - _last_request_at)
        if wait > 0:
            await asyncio.sleep(wait)

        params = {
            "q": q,
            # Instância pública do Photon: default/en/de/fr (sem pt).
            "lang": "default",
            "limit": str(max(1, min(limit, 12))),
            "lat": str(BRAZIL_LAT),
            "lon": str(BRAZIL_LON),
            "countrycode": "br",
        }
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    f"{PHOTON_BASE}/api/",
                    params=params,
                    headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                )
            _last_request_at = time.monotonic()
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            logger.warning("photon_autocomplete_failed", query=q, error=str(exc))
            raise ValueError("Não foi possível buscar endereços agora. Tente novamente.") from exc

    features = payload.get("features") if isinstance(payload, dict) else None
    items: list[dict[str, Any]] = []
    if isinstance(features, list):
        for feature in features:
            if not isinstance(feature, dict):
                continue
            item = _feature_to_item(feature)
            if item:
                items.append(item)

    _CACHE[cache_key] = (time.monotonic(), items)
    if len(_CACHE) > 256:
        # Evita crescimento indefinido: remove entradas mais antigas.
        oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[:64]
        for key, _ in oldest:
            _CACHE.pop(key, None)
    return items
