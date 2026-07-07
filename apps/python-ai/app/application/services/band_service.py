from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.billing_service import BillingService
from app.logging import logger
from app.infrastructure.database.models import (
    Band,
    BandInvite,
    BandMember,
    BandSong,
    BandStatus,
    BillingAccount,
    PLAN_LIMITS,
    Song,
    SongStatus,
    User,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


VIEWABLE_STATUSES = {
    BandStatus.TRIAL.value,
    BandStatus.ACTIVE.value,
    BandStatus.PAST_DUE.value,
}


class BandService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_user_bands(self, user_id: str) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(Band, BandMember)
            .join(BandMember, BandMember.band_id == Band.id)
            .where(
                BandMember.user_id == user_id,
                BandMember.status == "active",
            )
            .order_by(Band.name.asc())
        )
        items: list[dict[str, Any]] = []
        for band, member in result.all():
            count = await self._active_member_count(band.id)
            items.append(self._serialize_band(band, member, count))
        return items

    async def create_band(self, owner: User, name: str, plan_code: str) -> dict[str, Any]:
        if plan_code not in PLAN_LIMITS:
            raise ValueError("Plano inválido")
        base_cents, member_limit, extra_cents = PLAN_LIMITS[plan_code]

        billing_result = await self.session.execute(
            select(BillingAccount).where(BillingAccount.owner_user_id == owner.id)
        )
        billing = billing_result.scalar_one_or_none()
        if billing is None:
            billing = BillingAccount(
                id=_new_id("bil"),
                owner_user_id=owner.id,
                status="pending",
                trial_ends_at=datetime.now(UTC) + timedelta(days=2),
            )
            self.session.add(billing)
            await self.session.flush()

        band = Band(
            id=_new_id("bnd"),
            name=name.strip(),
            owner_user_id=owner.id,
            billing_account_id=billing.id,
            plan_code=plan_code,
            status=BandStatus.TRIAL.value,
            member_limit=member_limit,
            extra_member_price_cents=extra_cents,
            trial_ends_at=datetime.now(UTC) + timedelta(days=2),
        )
        owner_member = BandMember(
            id=_new_id("mbr"),
            band_id=band.id,
            user_id=owner.id,
            role="owner",
            can_analyze_songs=True,
            status="active",
            joined_at=datetime.now(UTC),
        )
        self.session.add(band)
        self.session.add(owner_member)
        await self.session.commit()
        await self.session.refresh(band)
        await self.session.refresh(owner_member)

        # Assinatura Asaas é sincronizada no checkout; no trial a banda já funciona.
        return self._serialize_band(band, owner_member, 1)

    async def get_member(self, band_id: str, user_id: str) -> BandMember | None:
        result = await self.session.execute(
            select(BandMember).where(
                BandMember.band_id == band_id,
                BandMember.user_id == user_id,
                BandMember.status == "active",
            )
        )
        return result.scalar_one_or_none()

    async def require_view_access(self, band_id: str, user_id: str) -> tuple[Band, BandMember]:
        band = await self.get_band(band_id)
        if band is None:
            raise PermissionError("Banda não encontrada")
        member = await self.get_member(band_id, user_id)
        if member is None:
            raise PermissionError("Você não pertence a esta banda")
        if not band.billing_exempt and band.status not in VIEWABLE_STATUSES:
            raise PermissionError("Assinatura inativa. Regularize o pagamento.")
        return band, member

    async def require_analyze_access(self, band_id: str, user_id: str) -> tuple[Band, BandMember]:
        band, member = await self.require_view_access(band_id, user_id)
        if band.status == BandStatus.TRIAL.value:
            raise PermissionError("No período de trial não é possível enviar músicas para análise")
        if member.role != "owner" and not member.can_analyze_songs:
            raise PermissionError("Sem permissão para analisar músicas nesta banda")
        return band, member

    async def get_band(self, band_id: str) -> Band | None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        return result.scalar_one_or_none()

    async def link_song(self, band_id: str, song_id: str, user_id: str) -> None:
        existing = await self.session.execute(
            select(BandSong).where(BandSong.band_id == band_id, BandSong.song_id == song_id)
        )
        if existing.scalar_one_or_none():
            return
        self.session.add(
            BandSong(
                id=_new_id("bsg"),
                band_id=band_id,
                song_id=song_id,
                linked_by_user_id=user_id,
            )
        )
        await self.session.commit()

    async def song_linked_to_band(self, band_id: str, song_id: str) -> bool:
        result = await self.session.execute(
            select(BandSong).where(BandSong.band_id == band_id, BandSong.song_id == song_id)
        )
        return result.scalar_one_or_none() is not None

    async def list_band_songs(
        self, band_id: str, limit: int = 50, offset: int = 0
    ) -> tuple[list[Song], int]:
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        count_result = await self.session.execute(
            select(func.count())
            .select_from(BandSong)
            .join(Song, Song.id == BandSong.song_id)
            .where(BandSong.band_id == band_id, Song.deleted_at.is_(None))
        )
        total = int(count_result.scalar_one())
        result = await self.session.execute(
            select(Song)
            .join(BandSong, BandSong.song_id == Song.id)
            .where(BandSong.band_id == band_id, Song.deleted_at.is_(None))
            .order_by(Song.created_at.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )
        return list(result.scalars().all()), total

    async def _user_band_ids(self, user_id: str) -> list[str]:
        result = await self.session.execute(
            select(BandMember.band_id).where(
                BandMember.user_id == user_id,
                BandMember.status == "active",
            )
        )
        return [row[0] for row in result.all()]

    async def user_can_access_song(self, user_id: str, song_id: str) -> bool:
        user_band_ids = await self._user_band_ids(user_id)
        if not user_band_ids:
            return False
        result = await self.session.execute(
            select(BandSong.id)
            .where(
                BandSong.band_id.in_(user_band_ids),
                BandSong.song_id == song_id,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def list_global_library_songs(
        self, user_id: str, exclude_band_id: str, limit: int = 50, offset: int = 0
    ) -> tuple[list[Song], int]:
        user_band_ids = await self._user_band_ids(user_id)
        if not user_band_ids:
            return [], 0

        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        accessible_songs = (
            select(BandSong.song_id)
            .where(BandSong.band_id.in_(user_band_ids))
            .distinct()
            .scalar_subquery()
        )
        in_current_band = exists(
            select(BandSong.id).where(
                BandSong.band_id == exclude_band_id,
                BandSong.song_id == Song.id,
            )
        )
        filters = (
            Song.id.in_(accessible_songs),
            Song.status == SongStatus.COMPLETED.value,
            Song.deleted_at.is_(None),
            Song.moderation_status != "blocked",
            ~in_current_band,
        )

        count_result = await self.session.execute(select(func.count()).select_from(Song).where(*filters))
        total = int(count_result.scalar_one())
        result = await self.session.execute(
            select(Song)
            .where(*filters)
            .order_by(Song.updated_at.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )
        return list(result.scalars().all()), total

    async def invite_member(
        self, band_id: str, owner_id: str, email: str, can_analyze: bool
    ) -> dict[str, Any]:
        band = await self.get_band(band_id)
        if band is None or band.owner_user_id != owner_id:
            raise PermissionError("Apenas o responsável pode convidar membros")
        token = secrets.token_urlsafe(32)
        invite = BandInvite(
            id=_new_id("inv"),
            band_id=band_id,
            email=email.strip().lower(),
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            can_analyze_songs=can_analyze,
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
        self.session.add(invite)
        await self.session.commit()
        return {"invite_id": invite.id, "token": token, "email": invite.email}

    async def accept_invite(self, token: str, user: User) -> dict[str, Any]:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        result = await self.session.execute(
            select(BandInvite).where(
                BandInvite.token_hash == token_hash,
                BandInvite.accepted_at.is_(None),
                BandInvite.expires_at > datetime.now(UTC),
            )
        )
        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError("Convite inválido ou expirado")
        if invite.email != user.email.lower():
            raise ValueError("Este convite foi enviado para outro e-mail")

        existing = await self.get_member(invite.band_id, user.id)
        if existing:
            invite.accepted_at = datetime.now(UTC)
            await self.session.commit()
            band = await self.get_band(invite.band_id)
            if band is None:
                raise ValueError("Banda não encontrada")
            return self._serialize_band(band, existing, await self._active_member_count(band.id))

        member = BandMember(
            id=_new_id("mbr"),
            band_id=invite.band_id,
            user_id=user.id,
            role="member",
            can_analyze_songs=invite.can_analyze_songs,
            status="active",
            invited_at=invite.created_at,
            joined_at=datetime.now(UTC),
        )
        invite.accepted_at = datetime.now(UTC)
        self.session.add(member)
        await self.session.commit()

        band = await self.get_band(invite.band_id)
        if band is None:
            raise ValueError("Banda não encontrada")
        billing_service = BillingService(self.session)
        try:
            await billing_service.sync_subscription(band.billing_account_id)
        except Exception as exc:
            logger.warning(
                "billing_sync_failed_after_invite",
                band_id=band.id,
                error=str(exc),
            )
        return self._serialize_band(band, member, await self._active_member_count(band.id))

    async def update_member_permissions(
        self, band_id: str, owner_id: str, member_id: str, can_analyze: bool
    ) -> dict[str, Any]:
        band = await self.get_band(band_id)
        if band is None or band.owner_user_id != owner_id:
            raise PermissionError("Apenas o responsável pode alterar permissões")
        result = await self.session.execute(
            select(BandMember).where(BandMember.id == member_id, BandMember.band_id == band_id)
        )
        member = result.scalar_one_or_none()
        if member is None or member.role == "owner":
            raise ValueError("Membro inválido")
        member.can_analyze_songs = can_analyze
        await self.session.commit()
        return {"id": member.id, "can_analyze_songs": member.can_analyze_songs}

    async def _active_member_count(self, band_id: str) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(BandMember)
            .where(BandMember.band_id == band_id, BandMember.status == "active")
        )
        return int(result.scalar_one())

    def _serialize_band(self, band: Band, member: BandMember, member_count: int) -> dict[str, Any]:
        return {
            "id": band.id,
            "name": band.name,
            "plan_code": band.plan_code,
            "status": band.status,
            "member_count": member_count,
            "member_limit": band.member_limit,
            "billing_exempt": band.billing_exempt,
            "can_analyze_songs": member.role == "owner" or member.can_analyze_songs,
            "is_owner": member.role == "owner",
            "trial_ends_at": band.trial_ends_at.isoformat() if band.trial_ends_at else None,
        }
