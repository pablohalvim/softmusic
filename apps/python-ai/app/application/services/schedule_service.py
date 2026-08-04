from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.band_service import BandService
from app.application.services.email_service import EmailService
from app.infrastructure.database.models import (
    Band,
    BandMember,
    BandMemberRole,
    BandRole,
    BandSavedAddress,
    BandSchedule,
    BandScheduleMember,
    BandScheduleMemberRole,
    BandScheduleOccurrence,
    BandScheduleSong,
    BandSong,
    Song,
    User,
)
from app.logging import logger


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _calendar_uid(occurrence_id: str) -> str:
    return f"softmusic-{occurrence_id}-{secrets.token_hex(6)}@softmusic.com.br"


def _parse_dt(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _iso_utc(value: datetime | None) -> str | None:
    """Serialize datetimes as UTC ISO with Z so clients don't treat naive values as local."""
    if value is None:
        return None
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def format_member_with_roles(full_name: str, role_names: list[str]) -> str:
    if role_names:
        return f"{full_name} ({', '.join(role_names)})"
    return full_name


def _normalize_members_payload(payload: dict[str, Any]) -> list[tuple[str, list[str]]]:
    """Aceita `members[{member_id,role_ids}]` ou legado `member_ids`."""
    raw_members = payload.get("members")
    if isinstance(raw_members, list) and len(raw_members) > 0:
        out: list[tuple[str, list[str]]] = []
        seen: set[str] = set()
        for entry in raw_members:
            if not isinstance(entry, dict):
                continue
            member_id = str(entry.get("member_id") or "").strip()
            if not member_id or member_id in seen:
                continue
            seen.add(member_id)
            role_ids = [
                str(role_id).strip()
                for role_id in (entry.get("role_ids") or [])
                if str(role_id).strip()
            ]
            out.append((member_id, role_ids))
        return out

    member_ids = [str(mid).strip() for mid in (payload.get("member_ids") or []) if str(mid).strip()]
    # role_ids vazios = fallback para todas as funções do perfil
    return [(member_id, []) for member_id in dict.fromkeys(member_ids)]


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
        """Grid achatado: uma linha por occurrence ativa."""
        await self.bands.require_view_access(band_id, user_id)
        result = await self.session.execute(
            select(BandScheduleOccurrence, BandSchedule)
            .join(BandSchedule, BandSchedule.id == BandScheduleOccurrence.schedule_id)
            .where(
                BandSchedule.band_id == band_id,
                BandScheduleOccurrence.removed_at.is_(None),
            )
            .order_by(BandScheduleOccurrence.starts_at.asc())
        )
        items: list[dict[str, Any]] = []
        roster_cache: dict[str, list[dict[str, Any]]] = {}
        for occ, schedule in result.all():
            if schedule.id not in roster_cache:
                roster_cache[schedule.id] = await self._roster_for_schedule(schedule.id)
            roster = roster_cache[schedule.id]
            items.append(self._serialize_grid_row(occ, schedule, roster))
        return items

    async def get_schedule(self, band_id: str, user_id: str, schedule_id: str) -> dict[str, Any]:
        await self.bands.require_view_access(band_id, user_id)
        schedule = await self._get_schedule(band_id, schedule_id)
        return await self._serialize_schedule(schedule)

    async def create_schedule(
        self,
        band_id: str,
        user: User,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        await self.bands.require_manage_access(band_id, user.id)

        title = (payload.get("title") or "").strip()
        if not title:
            raise ValueError("Informe o título da escala")

        member_selections = _normalize_members_payload(payload)
        if not member_selections:
            raise ValueError("Selecione ao menos um integrante")
        members = await self._load_active_members(
            band_id, [member_id for member_id, _ in member_selections]
        )
        role_ids_by_member = await self._validate_member_role_selection(band_id, member_selections)
        event = payload.get("event") or {}
        event_addr = await self._resolve_address(band_id, event)
        event_start = _parse_dt(str(event.get("starts_at", "")))
        event_end = _parse_dt(str(event.get("ends_at", "")))
        if event_end <= event_start:
            raise ValueError("Horário de fim do evento deve ser após o início")

        rehearsals_raw = list(payload.get("rehearsals") or [])
        # Compat: payload antigo com um único rehearsal
        if not rehearsals_raw and payload.get("rehearsal"):
            block = dict(payload["rehearsal"])
            block["same_as_event_address"] = bool(payload.get("rehearsal_same_as_event_address"))
            rehearsals_raw = [block]

        schedule = BandSchedule(
            id=_new_id("sch"),
            band_id=band_id,
            title=title,
            created_by_user_id=user.id,
        )
        self.session.add(schedule)
        await self.session.flush()

        created_occurrences: list[BandScheduleOccurrence] = []
        event_occ = self._build_occurrence(
            schedule_id=schedule.id,
            kind="event",
            title=title,
            starts_at=event_start,
            ends_at=event_end,
            address=event_addr,
        )
        self.session.add(event_occ)
        created_occurrences.append(event_occ)

        for reh in rehearsals_raw:
            if reh.get("same_as_event_address") or reh.get("same_as_event"):
                reh_addr = event_addr
            else:
                reh_addr = await self._resolve_address(band_id, reh)
            reh_start = _parse_dt(str(reh.get("starts_at", "")))
            reh_end = _parse_dt(str(reh.get("ends_at", "")))
            if reh_end <= reh_start:
                raise ValueError("Horário de fim do ensaio deve ser após o início")
            reh_occ = self._build_occurrence(
                schedule_id=schedule.id,
                kind="rehearsal",
                title=f"Ensaio {title}",
                starts_at=reh_start,
                ends_at=reh_end,
                address=reh_addr,
            )
            self.session.add(reh_occ)
            created_occurrences.append(reh_occ)

            if bool(reh.get("save_address")) and (reh.get("save_address_label") or "").strip():
                if not reh_addr.get("saved_address_id"):
                    self.session.add(
                        BandSavedAddress(
                            id=_new_id("adr"),
                            band_id=band_id,
                            label=str(reh.get("save_address_label")).strip(),
                            formatted_address=reh_addr["formatted_address"],
                            lat=reh_addr["lat"],
                            lng=reh_addr["lng"],
                            place_id=reh_addr.get("place_id"),
                        )
                    )

        await self._replace_schedule_members(schedule.id, members, role_ids_by_member)
        await self._replace_schedule_songs(band_id, schedule.id, payload.get("songs") or [])

        if bool(payload.get("save_event_address")) and (payload.get("save_event_address_label") or "").strip():
            if not event_addr.get("saved_address_id"):
                self.session.add(
                    BandSavedAddress(
                        id=_new_id("adr"),
                        band_id=band_id,
                        label=str(payload.get("save_event_address_label")).strip(),
                        formatted_address=event_addr["formatted_address"],
                        lat=event_addr["lat"],
                        lng=event_addr["lng"],
                        place_id=event_addr.get("place_id"),
                    )
                )

        await self.session.commit()

        band = await self.bands.get_band(band_id)
        if band is not None:
            roster = await self._roster_for_schedule(schedule.id)
            await self._notify_occurrences(
                band=band,
                occurrences=created_occurrences,
                members=members,
                roster=roster,
                action="create",
            )

        return await self._serialize_schedule(schedule)

    async def update_occurrence(
        self,
        band_id: str,
        user: User,
        occurrence_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        await self.bands.require_manage_access(band_id, user.id)
        occ, schedule = await self._get_occurrence(band_id, occurrence_id)
        if occ.removed_at is not None:
            raise ValueError("Esta ocorrência já foi cancelada")

        previous_member_ids = {
            row.member_id
            for row in (
                await self.session.execute(
                    select(BandScheduleMember).where(BandScheduleMember.schedule_id == schedule.id)
                )
            ).scalars().all()
        }

        if payload.get("starts_at"):
            occ.starts_at = _parse_dt(str(payload["starts_at"]))
        if payload.get("ends_at"):
            occ.ends_at = _parse_dt(str(payload["ends_at"]))
        if occ.ends_at <= occ.starts_at:
            raise ValueError("Horário de fim deve ser após o início")

        if any(k in payload for k in ("formatted_address", "lat", "lng", "saved_address_id", "place_id")):
            addr = await self._resolve_address(band_id, payload)
            occ.formatted_address = addr["formatted_address"]
            occ.lat = addr["lat"]
            occ.lng = addr["lng"]
            occ.place_id = addr.get("place_id")
            occ.saved_address_id = addr.get("saved_address_id")

        if occ.kind == "event" and payload.get("title") is not None:
            new_title = str(payload.get("title") or "").strip()
            if not new_title:
                raise ValueError("Informe o título")
            schedule.title = new_title
            occ.title = new_title
            # Atualiza títulos derivados dos ensaios ativos
            reh_result = await self.session.execute(
                select(BandScheduleOccurrence).where(
                    BandScheduleOccurrence.schedule_id == schedule.id,
                    BandScheduleOccurrence.kind == "rehearsal",
                    BandScheduleOccurrence.removed_at.is_(None),
                )
            )
            for reh in reh_result.scalars().all():
                reh.title = f"Ensaio {new_title}"
                reh.updated_at = datetime.now(UTC)

        if not occ.calendar_uid:
            occ.calendar_uid = _calendar_uid(occ.id)
        occ.calendar_sequence = int(occ.calendar_sequence or 0) + 1
        occ.updated_at = datetime.now(UTC)

        removed_members: list[BandMember] = []
        current_members: list[BandMember] = []
        members_touched = "members" in payload or "member_ids" in payload
        if members_touched:
            member_selections = _normalize_members_payload(payload)
            if not member_selections:
                raise ValueError("Selecione ao menos um integrante")
            current_members = await self._load_active_members(
                band_id, [member_id for member_id, _ in member_selections]
            )
            role_ids_by_member = await self._validate_member_role_selection(band_id, member_selections)
            new_ids = {m.id for m in current_members}
            left_ids = previous_member_ids - new_ids
            if left_ids:
                left_result = await self.session.execute(
                    select(BandMember).where(BandMember.id.in_(list(left_ids)))
                )
                removed_members = list(left_result.scalars().all())

            await self._replace_schedule_members(schedule.id, current_members, role_ids_by_member)
        else:
            current_members = await self._members_for_schedule(schedule.id)

        if "songs" in payload:
            await self._replace_schedule_songs(band_id, schedule.id, payload.get("songs") or [])

        await self.session.commit()
        await self.session.refresh(occ)

        band = await self.bands.get_band(band_id)
        if band is not None:
            roster = await self._roster_for_schedule(schedule.id)
            if removed_members:
                await self._notify_occurrences(
                    band=band,
                    occurrences=[occ],
                    members=removed_members,
                    roster=roster,
                    action="cancel",
                )
            await self._notify_occurrences(
                band=band,
                occurrences=[occ],
                members=current_members,
                roster=roster,
                action="update",
            )

        return await self._serialize_schedule(schedule)

    async def cancel_occurrence(
        self,
        band_id: str,
        user: User,
        occurrence_id: str,
    ) -> dict[str, str]:
        await self.bands.require_manage_access(band_id, user.id)
        occ, schedule = await self._get_occurrence(band_id, occurrence_id)
        if occ.removed_at is not None:
            return {"status": "cancelled", "occurrence_id": occurrence_id}

        if not occ.calendar_uid:
            occ.calendar_uid = _calendar_uid(occ.id)
        occ.calendar_sequence = int(occ.calendar_sequence or 0) + 1
        occ.removed_at = datetime.now(UTC)
        occ.updated_at = datetime.now(UTC)
        await self.session.commit()

        members = await self._members_for_schedule(schedule.id)
        band = await self.bands.get_band(band_id)
        if band is not None and members:
            roster = await self._roster_for_schedule(schedule.id)
            await self._notify_occurrences(
                band=band,
                occurrences=[occ],
                members=members,
                roster=roster,
                action="cancel",
            )
        return {"status": "cancelled", "occurrence_id": occurrence_id}

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
                BandScheduleOccurrence.removed_at.is_(None),
            )
            .order_by(BandScheduleOccurrence.starts_at.asc())
        )

        next_rehearsal: dict[str, Any] | None = None
        next_event: dict[str, Any] | None = None
        roster_cache: dict[str, list[dict[str, Any]]] = {}
        for _link, occurrence, schedule, band in link_result.all():
            if schedule.id not in roster_cache:
                roster_cache[schedule.id] = await self._roster_for_schedule(schedule.id)
            item = {
                "id": occurrence.id,
                "schedule_id": schedule.id,
                "kind": occurrence.kind,
                "title": occurrence.title or schedule.title,
                "band_id": band.id,
                "band_name": band.name,
                "starts_at": _iso_utc(occurrence.starts_at),
                "ends_at": _iso_utc(occurrence.ends_at),
                "formatted_address": occurrence.formatted_address,
                "lat": occurrence.lat,
                "lng": occurrence.lng,
                "maps_url": self._maps_url(occurrence.lat, occurrence.lng),
                "members": roster_cache[schedule.id],
            }
            if occurrence.kind == "rehearsal" and next_rehearsal is None:
                next_rehearsal = item
            elif occurrence.kind == "event" and next_event is None:
                next_event = item
            if next_rehearsal and next_event:
                break

        return {"next_rehearsal": next_rehearsal, "next_event": next_event}

    async def list_mine_for_user(self, user: User) -> list[dict[str, Any]]:
        """Ocorrências futuras em que o usuário está escalado (todas as bandas)."""
        member_result = await self.session.execute(
            select(BandMember).where(
                BandMember.user_id == user.id,
                BandMember.status == "active",
            )
        )
        members = list(member_result.scalars().all())
        if not members:
            return []

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
                BandScheduleOccurrence.removed_at.is_(None),
            )
            .order_by(BandScheduleOccurrence.starts_at.asc())
        )

        roster_cache: dict[str, list[dict[str, Any]]] = {}
        songs_cache: dict[str, list[dict[str, Any]]] = {}
        items: list[dict[str, Any]] = []
        for _link, occurrence, schedule, band in link_result.all():
            if schedule.id not in roster_cache:
                roster_cache[schedule.id] = await self._roster_for_schedule(schedule.id)
            if schedule.id not in songs_cache:
                songs_cache[schedule.id] = await self._serialize_schedule_songs(schedule.id)
            roster = roster_cache[schedule.id]
            songs = songs_cache[schedule.id]
            items.append(
                {
                    "id": occurrence.id,
                    "occurrence_id": occurrence.id,
                    "schedule_id": schedule.id,
                    "kind": occurrence.kind,
                    "title": occurrence.title or schedule.title,
                    "band_id": band.id,
                    "band_name": band.name,
                    "starts_at": _iso_utc(occurrence.starts_at),
                    "ends_at": _iso_utc(occurrence.ends_at),
                    "formatted_address": occurrence.formatted_address,
                    "lat": occurrence.lat,
                    "lng": occurrence.lng,
                    "maps_url": self._maps_url(occurrence.lat, occurrence.lng),
                    "member_count": len(roster),
                    "members": roster,
                    "songs": songs,
                }
            )
        return items

    def _build_occurrence(
        self,
        *,
        schedule_id: str,
        kind: str,
        title: str,
        starts_at: datetime,
        ends_at: datetime,
        address: dict[str, Any],
    ) -> BandScheduleOccurrence:
        occ_id = _new_id("occ")
        return BandScheduleOccurrence(
            id=occ_id,
            schedule_id=schedule_id,
            kind=kind,
            title=title,
            starts_at=starts_at,
            ends_at=ends_at,
            formatted_address=address["formatted_address"],
            lat=address["lat"],
            lng=address["lng"],
            place_id=address.get("place_id"),
            saved_address_id=address.get("saved_address_id"),
            calendar_uid=_calendar_uid(occ_id),
            calendar_sequence=0,
            updated_at=datetime.now(UTC),
        )

    async def _notify_occurrences(
        self,
        *,
        band: Band,
        occurrences: list[BandScheduleOccurrence],
        members: list[BandMember],
        roster: list[dict[str, Any]],
        action: str,
    ) -> None:
        if not occurrences or not members:
            return
        user_ids = [m.user_id for m in members]
        users_result = await self.session.execute(select(User).where(User.id.in_(user_ids)))
        recipients = [u.email for u in users_result.scalars().all() if u.email]
        if not recipients:
            return

        members_lines = [
            format_member_with_roles(item["full_name"], item["role_names"]) for item in roster
        ]
        schedule_id = occurrences[0].schedule_id
        songs = await self._serialize_schedule_songs(schedule_id)
        songs_lines = [self._format_song_line(item) for item in songs]
        email = EmailService()
        try:
            for occ in occurrences:
                email.schedule_occurrence(
                    recipients=recipients,
                    kind=occ.kind,
                    band_name=band.name,
                    title=occ.title or band.name,
                    starts_at=occ.starts_at,
                    ends_at=occ.ends_at,
                    address=occ.formatted_address,
                    lat=float(occ.lat),
                    lng=float(occ.lng),
                    calendar_uid=occ.calendar_uid,
                    calendar_sequence=int(occ.calendar_sequence or 0),
                    members_lines=members_lines,
                    songs_lines=songs_lines,
                    action=action,
                )
        except Exception as exc:
            logger.warning("schedule_email_failed", band_id=band.id, error=str(exc))

    @staticmethod
    def _format_song_line(item: dict[str, Any]) -> str:
        title = str(item.get("title") or "").strip() or "Sem título"
        artist = str(item.get("artist") or "").strip()
        key = str(item.get("musical_key") or "").strip()
        label = f"{title} — {artist}" if artist else title
        if key:
            label = f"{label} (Tom: {key})"
        return label

    async def _load_active_members(self, band_id: str, member_ids: list[str]) -> list[BandMember]:
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
        return members

    async def _members_for_schedule(self, schedule_id: str) -> list[BandMember]:
        result = await self.session.execute(
            select(BandMember)
            .join(BandScheduleMember, BandScheduleMember.member_id == BandMember.id)
            .where(BandScheduleMember.schedule_id == schedule_id)
        )
        return list(result.scalars().all())

    async def _get_schedule(self, band_id: str, schedule_id: str) -> BandSchedule:
        result = await self.session.execute(
            select(BandSchedule).where(
                BandSchedule.id == schedule_id,
                BandSchedule.band_id == band_id,
            )
        )
        schedule = result.scalar_one_or_none()
        if schedule is None:
            raise ValueError("Escala não encontrada")
        return schedule

    async def _get_occurrence(
        self, band_id: str, occurrence_id: str
    ) -> tuple[BandScheduleOccurrence, BandSchedule]:
        result = await self.session.execute(
            select(BandScheduleOccurrence, BandSchedule)
            .join(BandSchedule, BandSchedule.id == BandScheduleOccurrence.schedule_id)
            .where(
                BandScheduleOccurrence.id == occurrence_id,
                BandSchedule.band_id == band_id,
            )
        )
        row = result.one_or_none()
        if row is None:
            raise ValueError("Ocorrência não encontrada")
        return row[0], row[1]

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

    def _serialize_grid_row(
        self,
        occ: BandScheduleOccurrence,
        schedule: BandSchedule,
        roster: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "occurrence_id": occ.id,
            "schedule_id": schedule.id,
            "title": occ.title or schedule.title,
            "kind": occ.kind,
            "starts_at": _iso_utc(occ.starts_at),
            "ends_at": _iso_utc(occ.ends_at),
            "formatted_address": occ.formatted_address,
            "lat": occ.lat,
            "lng": occ.lng,
            "place_id": occ.place_id,
            "maps_url": self._maps_url(occ.lat, occ.lng),
            "member_count": len(roster),
            "members": roster,
        }

    async def _serialize_schedule(self, schedule: BandSchedule) -> dict[str, Any]:
        occ_result = await self.session.execute(
            select(BandScheduleOccurrence)
            .where(
                BandScheduleOccurrence.schedule_id == schedule.id,
                BandScheduleOccurrence.removed_at.is_(None),
            )
            .order_by(BandScheduleOccurrence.starts_at.asc())
        )
        occurrences = [
            {
                "id": occ.id,
                "kind": occ.kind,
                "title": occ.title,
                "starts_at": _iso_utc(occ.starts_at),
                "ends_at": _iso_utc(occ.ends_at),
                "formatted_address": occ.formatted_address,
                "lat": occ.lat,
                "lng": occ.lng,
                "place_id": occ.place_id,
                "saved_address_id": occ.saved_address_id,
                "maps_url": self._maps_url(occ.lat, occ.lng),
            }
            for occ in occ_result.scalars().all()
        ]
        members = await self._roster_for_schedule(schedule.id)
        songs = await self._serialize_schedule_songs(schedule.id)
        return {
            "id": schedule.id,
            "band_id": schedule.band_id,
            "title": schedule.title,
            "created_at": _iso_utc(schedule.created_at),
            "occurrences": occurrences,
            "members": members,
            "songs": songs,
        }

    async def _serialize_schedule_songs(self, schedule_id: str) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(BandScheduleSong, Song)
            .join(Song, Song.id == BandScheduleSong.song_id)
            .where(BandScheduleSong.schedule_id == schedule_id)
            .order_by(BandScheduleSong.sort_order.asc(), BandScheduleSong.created_at.asc())
        )
        items: list[dict[str, Any]] = []
        for link, song in result.all():
            items.append(
                {
                    "id": link.id,
                    "song_id": song.id,
                    "title": song.title,
                    "artist": song.artist,
                    "musical_key": link.musical_key or "",
                    "sort_order": link.sort_order,
                }
            )
        return items

    async def _replace_schedule_songs(
        self,
        band_id: str,
        schedule_id: str,
        songs_payload: list[Any],
    ) -> None:
        existing = await self.session.execute(
            select(BandScheduleSong).where(BandScheduleSong.schedule_id == schedule_id)
        )
        for link in existing.scalars().all():
            await self.session.delete(link)

        cleaned: list[tuple[str, str]] = []
        seen: set[str] = set()
        for raw in songs_payload:
            if not isinstance(raw, dict):
                continue
            song_id = str(raw.get("song_id") or "").strip()
            if not song_id or song_id in seen:
                continue
            musical_key = str(raw.get("musical_key") or "").strip()[:16]
            cleaned.append((song_id, musical_key))
            seen.add(song_id)

        if not cleaned:
            return

        song_ids = [song_id for song_id, _ in cleaned]
        linked = await self.session.execute(
            select(BandSong.song_id).where(
                BandSong.band_id == band_id,
                BandSong.song_id.in_(song_ids),
            )
        )
        allowed = {row[0] for row in linked.all()}
        missing = [song_id for song_id in song_ids if song_id not in allowed]
        if missing:
            raise ValueError("Selecione apenas músicas vinculadas à banda")

        for index, (song_id, musical_key) in enumerate(cleaned):
            self.session.add(
                BandScheduleSong(
                    id=_new_id("scs"),
                    schedule_id=schedule_id,
                    song_id=song_id,
                    musical_key=musical_key,
                    sort_order=index,
                )
            )

    async def _roster_for_schedule(self, schedule_id: str) -> list[dict[str, Any]]:
        mem_result = await self.session.execute(
            select(BandMember, User)
            .join(BandScheduleMember, BandScheduleMember.member_id == BandMember.id)
            .join(User, User.id == BandMember.user_id)
            .where(BandScheduleMember.schedule_id == schedule_id)
            .order_by(User.full_name.asc())
        )
        pairs = list(mem_result.all())
        return await self._schedule_member_roster(
            [member for member, _ in pairs],
            users={member.id: user for member, user in pairs},
            schedule_id=schedule_id,
        )

    async def _schedule_member_roster(
        self,
        members: list[BandMember],
        users: dict[str, User] | None = None,
        *,
        schedule_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if not members:
            return []

        if users is None:
            user_ids = [m.user_id for m in members]
            users_result = await self.session.execute(select(User).where(User.id.in_(user_ids)))
            by_user_id = {u.id: u for u in users_result.scalars().all()}
            users = {m.id: by_user_id[m.user_id] for m in members if m.user_id in by_user_id}

        member_ids = [m.id for m in members]
        profile_roles = await self._roles_by_member_ids(member_ids)
        schedule_roles = (
            await self._schedule_roles_by_member_ids(schedule_id, member_ids)
            if schedule_id
            else {}
        )

        roster: list[dict[str, Any]] = []
        for member in members:
            user = users.get(member.id)
            if user is None:
                continue
            selected = schedule_roles.get(member.id) or []
            profile = profile_roles.get(member.id) or []
            # Escala com funções explícitas → só essas; senão fallback do perfil.
            roles = selected if selected else profile
            role_ids = [role_id for role_id, _ in roles]
            role_names = [name for _, name in roles]
            roster.append(
                {
                    "member_id": member.id,
                    "full_name": user.full_name,
                    "role_ids": role_ids,
                    "role_names": role_names,
                    "label": format_member_with_roles(user.full_name, role_names),
                }
            )
        roster.sort(key=lambda item: item["full_name"].casefold())
        return roster

    async def _replace_schedule_members(
        self,
        schedule_id: str,
        members: list[BandMember],
        role_ids_by_member: dict[str, list[str]],
    ) -> None:
        existing_members = await self.session.execute(
            select(BandScheduleMember).where(BandScheduleMember.schedule_id == schedule_id)
        )
        for link in existing_members.scalars().all():
            await self.session.delete(link)

        existing_roles = await self.session.execute(
            select(BandScheduleMemberRole).where(BandScheduleMemberRole.schedule_id == schedule_id)
        )
        for link in existing_roles.scalars().all():
            await self.session.delete(link)
        await self.session.flush()

        for member in members:
            self.session.add(
                BandScheduleMember(
                    id=_new_id("scm"),
                    schedule_id=schedule_id,
                    member_id=member.id,
                )
            )
            for role_id in role_ids_by_member.get(member.id, []):
                self.session.add(
                    BandScheduleMemberRole(
                        id=_new_id("smr"),
                        schedule_id=schedule_id,
                        member_id=member.id,
                        role_id=role_id,
                    )
                )

    async def _validate_member_role_selection(
        self,
        band_id: str,
        selections: list[tuple[str, list[str]]],
    ) -> dict[str, list[str]]:
        member_ids = [member_id for member_id, _ in selections]
        allowed = await self._roles_by_member_ids(member_ids, band_id=band_id)

        out: dict[str, list[str]] = {}
        for member_id, selected_role_ids in selections:
            allowed_ids = {role_id for role_id, _ in allowed.get(member_id, [])}
            # Se o membro tem funções no perfil, exige ao menos uma na escala.
            if allowed_ids and not selected_role_ids:
                raise ValueError("Escolha a função de cada integrante marcado na escala")
            unknown = [role_id for role_id in selected_role_ids if role_id not in allowed_ids]
            if unknown:
                raise ValueError("Função inválida para um dos integrantes da escala")
            out[member_id] = list(dict.fromkeys(selected_role_ids))
        return out

    async def _roles_by_member_ids(
        self,
        member_ids: list[str],
        *,
        band_id: str | None = None,
    ) -> dict[str, list[tuple[str, str]]]:
        if not member_ids:
            return {}
        query = (
            select(BandMemberRole.member_id, BandRole.id, BandRole.name)
            .join(BandRole, BandRole.id == BandMemberRole.role_id)
            .where(BandMemberRole.member_id.in_(member_ids))
            .order_by(BandRole.sort_order.asc(), BandRole.name.asc())
        )
        if band_id:
            query = query.where(BandRole.band_id == band_id)
        result = await self.session.execute(query)
        out: dict[str, list[tuple[str, str]]] = {mid: [] for mid in member_ids}
        for member_id, role_id, name in result.all():
            out.setdefault(member_id, []).append((role_id, name))
        return out

    async def _schedule_roles_by_member_ids(
        self, schedule_id: str, member_ids: list[str]
    ) -> dict[str, list[tuple[str, str]]]:
        if not member_ids:
            return {}
        result = await self.session.execute(
            select(BandScheduleMemberRole.member_id, BandRole.id, BandRole.name)
            .join(BandRole, BandRole.id == BandScheduleMemberRole.role_id)
            .where(
                BandScheduleMemberRole.schedule_id == schedule_id,
                BandScheduleMemberRole.member_id.in_(member_ids),
            )
            .order_by(BandRole.sort_order.asc(), BandRole.name.asc())
        )
        out: dict[str, list[tuple[str, str]]] = {mid: [] for mid in member_ids}
        for member_id, role_id, name in result.all():
            out.setdefault(member_id, []).append((role_id, name))
        return out

    async def _role_names_by_member_ids(self, member_ids: list[str]) -> dict[str, list[str]]:
        roles = await self._roles_by_member_ids(member_ids)
        return {member_id: [name for _, name in items] for member_id, items in roles.items()}

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
