from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.models import CifraVariation

SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def build_cifra_variation_snapshot(import_payload: dict[str, Any]) -> dict[str, Any]:
    sections = import_payload.get("sections", [])
    imported_sheet = {
        "sections": [
            {
                "id": section["id"],
                "label": section["label"],
                "lines": [
                    {
                        "id": line["id"],
                        "lyrics": line.get("lyrics", ""),
                        "placements": line.get("placements") or [],
                    }
                    for line in section.get("lines", [])
                ],
            }
            for section in sections
        ],
    }
    return {
        "transposeSemitones": 0,
        "capo": 0,
        "sectionChords": {},
        "isImported": True,
        "importedSheet": imported_sheet,
        "keyOverride": None,
    }


def import_variation_base_name(now: datetime | None = None) -> str:
    current = now or datetime.now(SAO_PAULO)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SAO_PAULO)
    else:
        current = current.astimezone(SAO_PAULO)
    return f"Importado_{current.day:02d}{current.month:02d}{current.year}"


async def next_import_variation_name(
    session: AsyncSession, song_id: str, band_id: str | None = None
) -> str:
    base = import_variation_base_name()
    query = select(CifraVariation.name).where(
        CifraVariation.song_id == song_id,
        CifraVariation.name.like(f"{base}%"),
    )
    if band_id is not None:
        query = query.where(CifraVariation.band_id == band_id)
    result = await session.execute(query)
    existing = {name for name in result.scalars().all()}
    if base not in existing:
        return base
    suffix = 2
    while f"{base}_{suffix}" in existing:
        suffix += 1
    return f"{base}_{suffix}"


def serialize_cifra_variation(variation: CifraVariation) -> dict[str, Any]:
    import json

    return {
        "id": variation.id,
        "name": variation.name,
        "createdAt": variation.created_at.isoformat(),
        "updatedAt": variation.updated_at.isoformat(),
        "snapshot": json.loads(variation.snapshot_json),
        "cifra_club_url": variation.cifra_club_url,
    }
