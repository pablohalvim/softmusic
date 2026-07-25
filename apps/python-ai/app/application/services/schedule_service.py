from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.band_service import BandService
from app.infrastructure.database.models import (
    Band,
    BandMember,
    BandSavedAddress,
    BandSchedule,
    BandScheduleMember,
    BandScheduleOccurrence,
    User,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _parse_dt(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


class ScheduleService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.bands = BandService(session)

    async def list_addresses(self, band_id: str, user_id: str) -> list[dict[str, Any]]:
        await self.bands.require_view_access(band_id, user_id)
        result = await self.session.execute(
            select(BandSavedAddress)
            .where(BandSavedAddress.band_id == band_id)
            .order_by(BandSavedAddress.label.asc())
        )
        return [self._serialize_address(row) for row in result.scalars().all()]

    async def create_address(
        self,
        band_id: str,
        user_id: str,
        *,
        label: str,
        formatted_address: str,
        lat: float,
        lng: float,
        place_id: str | None = None,
    ) -> dict[str, Any]:
        await self.bands.require_manage_access(band_id, user_id)
        label_clean = label.strip()
        if not label_clean:
            raise ValueError("Informe um nome para o endereço")
        addr = BandSavedAddress(
            id=_new_id("adr"),
            band_id=band_id,
            label=label_clean,
            formatted_address=formatted_address.strip(),
            lat=lat,
            lng=lng,
            place_id=place_id,
        )
        self.session.add(addr)
        await self.session.commit()
        return self._serialize_address(addr)

    async def delete_address(self, band_id: str, user_id: str, address_id: str) -> dict[str, str]:
        await self.bands.require_manage_access(band_id, user_id)
        result = await self.session.execute(
            select(BandSavedAddress).where(
                BandSavedAddress.id == address_id,
                BandSavedAddress.band_id == band_id,
            )
        )
        addr = result.scalar_one_or_none()
        if addr is None:
            raise ValueError("Endereço não encontrado")
        await self.session.delete(addr)
        await self.session.commit()
        return {"status": "deleted", "id": address_id}

    async def list_schedules(self, band_id: str, user_id: str) -> list[dict[str, Any]]:
        await self.bands.require_view_access(band_id, user_id)
        result = await self.session.execute(
            select(BandSchedule)
            .where(BandSchedule.band_id == band_id)
            .order_by(BandSchedule.created_at.desc())
        )
        items: list[dict[str, Any]] = []
        for schedule in result.scalars().all():
            items.append(await self._serialize_schedule(schedule))
        return items

    async def create_schedule(
        self,
        band_id: str,
        user: User,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        await self.bands.require_manage_access(band_id, user.id)

        member_ids: list[str] = list(payload.get("member_ids") or [])
        if not member_ids:
            raise ValueError("Selecione ao menos um integrante")

        members_result = await self.session.execute(
            select(BandMember).where(
                BandMember.band_id == band_id,
                BandMember.status == "active",
                BandMember.id.in_(member_ids),
            )
        )
        members = list(members_result.scalars().all())
        if len(members) != len(set(member_ids)):
            raise ValueError("Integrante inválido na escala")

        event = payload.get("event") or {}
        rehearsal = payload.get("rehearsal") or {}
        event_addr = await self._resolve_address(band_id, event)
        if payload.get("rehearsal_same_as_event_address"):
            rehearsal_addr = event_addr
        else:
            rehearsal_addr = await self._resolve_address(band_id, rehearsal)

        event_start = _parse_dt(str(event.get("starts_at", "")))
        event_end = _parse_dt(str(event.get("ends_at", "")))
        reh_start = _parse_dt(str(rehearsal.get("starts_at", "")))
        reh_end = _parse_dt(str(rehearsal.get("ends_at", "")))
        if event_end <= event_start or reh_end <= reh_start:
            raise ValueError("Horário de fim deve ser após o início")

        schedule = BandSchedule(
            id=_new_id("sch"),
            band_id=band_id,
            title=(payload.get("title") or "").strip() or None,
            created_by_user_id=user.id,
        )
        self.session.add(schedule)
        await self.session.flush()

        self.session.add(
            BandScheduleOccurrence(
                id=_new_id("occ"),
                schedule_id=schedule.id,
                kind="event",
                starts_at=event_start,
                ends_at=event_end,
                formatted_address=event_addr["formatted_address"],
                lat=event_addr["lat"],
                lng=event_addr["lng"],
                place_id=event_addr.get("place_id"),
                saved_address_id=event_addr.get("saved_address_id"),
            )
        )
        self.session.add(
            BandScheduleOccurrence(
                id=_new_id("occ"),
                schedule_id=schedule.id,
                kind="rehearsal",
                starts_at=reh_start,
                ends_at=reh_end,
                formatted_address=rehearsal_addr["formatted_address"],
                lat=rehearsal_addr["lat"],
                lng=rehearsal_addr["lng"],
                place_id=rehearsal_addr.get("place_id"),
                saved_address_id=rehearsal_addr.get("saved_address_id"),
            )
        )
        for member in members:
            self.session.add(
                BandScheduleMember(
                    id=_new_id("scm"),
                    schedule_id=schedule.id,
                    member_id=member.id,
                )
            )

        save_event = bool(payload.get("save_event_address"))
        save_label = (payload.get("save_event_address_label") or "").strip()
        if save_event and save_label and not event_addr.get("saved_address_id"):
            saved = BandSavedAddress(
                id=_new_id("adr"),
                band_id=band_id,
                label=save_label,
                formatted_address=event_addr["formatted_address"],
                lat=event_addr["lat"],
                lng=event_addr["lng"],
                place_id=event_addr.get("place_id"),
            )
            self.session.add(saved)

        await self.session.commit()
        return await self._serialize_schedule(schedule)

    async def upcoming_for_user(self, user: User) -> dict[str, Any]:
        member_result = await self.session.execute(
            select(BandMember).where(
                BandMember.user_id == user.id,
                BandMember.status == "active",
            )
        )
        members = list(member_result.scalars().all())
        if not members:
            return {"next_rehearsal": None, "next_event": None}

        member_ids = [m.id for m in members]
        now = datetime.now(UTC)

        link_result = await self.session.execute(
            select(BandScheduleMember, BandScheduleOccurrence, BandSchedule, Band)
            .join(BandSchedule, BandSchedule.id == BandScheduleMember.schedule_id)
            .join(
                BandScheduleOccurrence,
                BandScheduleOccurrence.schedule_id == BandSchedule.id,
            )
            .join(Band, Band.id == BandSchedule.band_id)
            .where(
                BandScheduleMember.member_id.in_(member_ids),
                BandScheduleOccurrence.starts_at >= now,
            )
            .order_by(BandScheduleOccurrence.starts_at.asc())
        )

        next_rehearsal: dict[str, Any] | None = None
        next_event: dict[str, Any] | None = None
        for link, occurrence, schedule, band in link_result.all():
            item = {
                "id": occurrence.id,
                "schedule_id": schedule.id,
                "kind": occurrence.kind,
                "title": schedule.title,
                "band_id": band.id,
                "band_name": band.name,
                "starts_at": occurrence.starts_at.isoformat(),
                "ends_at": occurrence.ends_at.isoformat(),
                "formatted_address": occurrence.formatted_address,
                "lat": occurrence.lat,
                "lng": occurrence.lng,
                "maps_url": self._maps_url(occurrence.lat, occurrence.lng),
            }
            if occurrence.kind == "rehearsal" and next_rehearsal is None:
                next_rehearsal = item
            elif occurrence.kind == "event" and next_event is None:
                next_event = item
            if next_rehearsal and next_event:
                break

        return {"next_rehearsal": next_rehearsal, "next_event": next_event}

    async def _resolve_address(self, band_id: str, block: dict[str, Any]) -> dict[str, Any]:
        saved_id = block.get("saved_address_id")
        if saved_id:
            result = await self.session.execute(
                select(BandSavedAddress).where(
                    BandSavedAddress.id == saved_id,
                    BandSavedAddress.band_id == band_id,
                )
            )
            saved = result.scalar_one_or_none()
            if saved is None:
                raise ValueError("Endereço salvo inválido")
            return {
                "formatted_address": saved.formatted_address,
                "lat": saved.lat,
                "lng": saved.lng,
                "place_id": saved.place_id,
                "saved_address_id": saved.id,
            }

        formatted = (block.get("formatted_address") or "").strip()
        lat = block.get("lat")
        lng = block.get("lng")
        if not formatted or lat is None or lng is None:
            raise ValueError("Informe o endereço com localização")
        return {
            "formatted_address": formatted,
            "lat": float(lat),
            "lng": float(lng),
            "place_id": block.get("place_id"),
            "saved_address_id": None,
        }

    async def _serialize_schedule(self, schedule: BandSchedule) -> dict[str, Any]:
        occ_result = await self.session.execute(
            select(BandScheduleOccurrence)
            .where(BandScheduleOccurrence.schedule_id == schedule.id)
            .order_by(BandScheduleOccurrence.starts_at.asc())
        )
        mem_result = await self.session.execute(
            select(BandScheduleMember, BandMember, User)
            .join(BandMember, BandMember.id == BandScheduleMember.member_id)
            .join(User, User.id == BandMember.user_id)
            .where(BandScheduleMember.schedule_id == schedule.id)
        )
        occurrences = [
            {
                "id": occ.id,
                "kind": occ.kind,
                "starts_at": occ.starts_at.isoformat(),
                "ends_at": occ.ends_at.isoformat(),
                "formatted_address": occ.formatted_address,
                "lat": occ.lat,
                "lng": occ.lng,
                "place_id": occ.place_id,
                "maps_url": self._maps_url(occ.lat, occ.lng),
            }
            for occ in occ_result.scalars().all()
        ]
        members = [
            {"member_id": member.id, "full_name": user.full_name}
            for _, member, user in mem_result.all()
        ]
        return {
            "id": schedule.id,
            "band_id": schedule.band_id,
            "title": schedule.title,
            "created_at": schedule.created_at.isoformat(),
            "occurrences": occurrences,
            "members": members,
        }

    @staticmethod
    def _serialize_address(addr: BandSavedAddress) -> dict[str, Any]:
        return {
            "id": addr.id,
            "band_id": addr.band_id,
            "label": addr.label,
            "formatted_address": addr.formatted_address,
            "lat": addr.lat,
            "lng": addr.lng,
            "place_id": addr.place_id,
            "maps_url": ScheduleService._maps_url(addr.lat, addr.lng),
        }

    @staticmethod
    def _maps_url(lat: float, lng: float) -> str:
        return f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"
