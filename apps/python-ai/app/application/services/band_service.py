from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.billing_service import BillingService
from app.logging import logger
from app.infrastructure.database.models import (
    DEFAULT_BAND_ROLE_NAMES,
    Band,
    BandInvite,
    BandMember,
    BandMemberRole,
    BandRole,
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
    BandStatus.PENDING_PAYMENT.value,
    BandStatus.SUSPENDED.value,
}

BLOCKED_STATUSES = {
    BandStatus.SUSPENDED.value,
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

    async def create_band(
        self,
        owner: User,
        name: str,
        plan_code: str,
        *,
        registered_by_admin_id: str | None = None,
    ) -> dict[str, Any]:
        if plan_code not in PLAN_LIMITS:
            raise ValueError("Plano inválido")
        cleaned_name = name.strip()
        if not cleaned_name:
            raise ValueError("Nome da banda é obrigatório")
        dup = await self.session.execute(
            select(Band).where(func.lower(Band.name) == cleaned_name.lower()).limit(1)
        )
        if dup.scalar_one_or_none():
            raise ValueError("Já existe uma banda com este nome")

        base_cents, member_limit, extra_cents = PLAN_LIMITS[plan_code]

        billing_result = await self.session.execute(
            select(BillingAccount).where(BillingAccount.owner_user_id == owner.id)
        )
        billing = billing_result.scalar_one_or_none()
        existing_bands = 0
        if billing is not None:
            count_result = await self.session.execute(
                select(func.count()).select_from(Band).where(Band.billing_account_id == billing.id)
            )
            existing_bands = int(count_result.scalar_one())

        with_trial = existing_bands == 0
        if billing is None:
            billing = BillingAccount(
                id=_new_id("bil"),
                owner_user_id=owner.id,
                status="pending",
                trial_ends_at=datetime.now(UTC) + timedelta(days=2) if with_trial else None,
            )
            self.session.add(billing)
            await self.session.flush()

        band = Band(
            id=_new_id("bnd"),
            name=cleaned_name,
            owner_user_id=owner.id,
            billing_account_id=billing.id,
            plan_code=plan_code,
            status=BandStatus.TRIAL.value if with_trial else BandStatus.PENDING_PAYMENT.value,
            member_limit=member_limit,
            extra_member_price_cents=extra_cents,
            trial_ends_at=datetime.now(UTC) + timedelta(days=2) if with_trial else None,
            registered_by_admin_id=registered_by_admin_id,
        )
        owner_member = BandMember(
            id=_new_id("mbr"),
            band_id=band.id,
            user_id=owner.id,
            role="owner",
            can_analyze_songs=True,
            can_invite_members=True,
            can_manage_members=True,
            can_delete_songs=True,
            status="active",
            joined_at=datetime.now(UTC),
        )
        self.session.add(band)
        self.session.add(owner_member)
        await self.session.flush()
        await self.seed_default_roles(band.id)
        await self.session.commit()
        await self.session.refresh(band)
        await self.session.refresh(owner_member)

        try:
            await BillingService(self.session).create_first_invoice_for_band(
                band, with_trial=with_trial
            )
        except Exception as exc:
            logger.warning("first_invoice_create_failed", band_id=band.id, error=str(exc))

        return self._serialize_band(band, owner_member, 1)

    async def seed_default_roles(self, band_id: str) -> None:
        existing = await self.session.execute(
            select(func.count()).select_from(BandRole).where(BandRole.band_id == band_id)
        )
        if int(existing.scalar_one()) > 0:
            return
        for idx, name in enumerate(DEFAULT_BAND_ROLE_NAMES):
            self.session.add(
                BandRole(
                    id=_new_id("rol"),
                    band_id=band_id,
                    name=name,
                    sort_order=idx,
                    is_default=True,
                )
            )

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
        if band.status in BLOCKED_STATUSES and not band.billing_exempt:
            raise PermissionError("Banda bloqueada por falta de pagamento. Não é possível enviar música para análise.")
        if band.status == BandStatus.TRIAL.value:
            raise PermissionError("No período de trial não é possível enviar músicas para análise")
        if band.status == BandStatus.PENDING_PAYMENT.value:
            raise PermissionError("Regularize o pagamento da banda para analisar músicas")
        if member.role != "owner" and not member.can_analyze_songs:
            raise PermissionError("Sem permissão para analisar músicas nesta banda")
        return band, member

    async def require_song_content_access(self, band_id: str, user_id: str) -> tuple[Band, BandMember]:
        """Acesso a detalhes/cifra — bloqueado se banda suspensa."""
        band, member = await self.require_view_access(band_id, user_id)
        if band.status in BLOCKED_STATUSES and not band.billing_exempt:
            raise PermissionError("Não é possível acessar este conteúdo. A banda está bloqueada por falta de pagamento.")
        return band, member

    def can_delete_songs(self, member: BandMember) -> bool:
        return member.role == "owner" or bool(member.can_delete_songs)

    async def require_invite_access(self, band_id: str, user_id: str) -> tuple[Band, BandMember]:
        band, member = await self.require_view_access(band_id, user_id)
        if member.role != "owner" and not member.can_invite_members:
            raise PermissionError("Sem permissão para convidar membros")
        return band, member

    async def require_manage_access(self, band_id: str, user_id: str) -> tuple[Band, BandMember]:
        band, member = await self.require_view_access(band_id, user_id)
        if member.role != "owner" and not member.can_manage_members:
            raise PermissionError("Sem permissão para gerenciar a banda")
        return band, member

    async def get_band(self, band_id: str) -> Band | None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        return result.scalar_one_or_none()

    async def link_song(
        self,
        band_id: str,
        song_id: str,
        user_id: str,
        *,
        link_source: str = "created",
    ) -> None:
        existing = await self.session.execute(
            select(BandSong).where(BandSong.band_id == band_id, BandSong.song_id == song_id)
        )
        if existing.scalar_one_or_none():
            return
        source = link_source if link_source in {"created", "imported_global"} else "created"
        self.session.add(
            BandSong(
                id=_new_id("bsg"),
                band_id=band_id,
                song_id=song_id,
                linked_by_user_id=user_id,
                link_source=source,
            )
        )
        await self.session.commit()

    async def get_band_song_link_sources(
        self, band_id: str, song_ids: list[str]
    ) -> dict[str, str]:
        if not song_ids:
            return {}
        result = await self.session.execute(
            select(BandSong.song_id, BandSong.link_source).where(
                BandSong.band_id == band_id,
                BandSong.song_id.in_(song_ids),
            )
        )
        return {song_id: (link_source or "created") for song_id, link_source in result.all()}

    async def band_owns_song_origin(self, band_id: str, song_id: str) -> bool:
        result = await self.session.execute(
            select(BandSong.link_source).where(
                BandSong.band_id == band_id,
                BandSong.song_id == song_id,
            )
        )
        link_source = result.scalar_one_or_none()
        return link_source == "created"

    async def unlink_song(self, band_id: str, song_id: str) -> None:
        result = await self.session.execute(
            select(BandSong).where(BandSong.band_id == band_id, BandSong.song_id == song_id)
        )
        link = result.scalar_one_or_none()
        if link is None:
            return
        await self.session.delete(link)
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
        # Compartilhada na biblioteca global do próprio usuário.
        owned = await self.session.execute(
            select(Song.id).where(
                Song.id == song_id,
                Song.created_by_user_id == user_id,
                Song.is_global.is_(True),
                Song.deleted_at.is_(None),
            ).limit(1)
        )
        if owned.scalar_one_or_none() is not None:
            return True

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

    async def set_song_global_share(
        self, song_id: str, user_id: str, *, is_global: bool
    ) -> Song:
        result = await self.session.execute(
            select(Song).where(Song.id == song_id, Song.deleted_at.is_(None))
        )
        song = result.scalar_one_or_none()
        if song is None:
            raise ValueError("Música não encontrada")
        if song.created_by_user_id and song.created_by_user_id != user_id:
            # Quem criou controla o compartilhamento; se órfã, assume o ator.
            raise PermissionError("Apenas quem cadastrou a música pode alterar o compartilhamento")
        if not song.created_by_user_id:
            song.created_by_user_id = user_id
        song.is_global = is_global
        song.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(song)
        return song

    async def list_global_library_songs(
        self, user_id: str, exclude_band_id: str, limit: int = 50, offset: int = 0
    ) -> tuple[list[Song], int]:
        user_band_ids = await self._user_band_ids(user_id)
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)

        in_current_band = exists(
            select(BandSong.id).where(
                BandSong.band_id == exclude_band_id,
                BandSong.song_id == Song.id,
            )
        )
        shared_by_user = and_(
            Song.is_global.is_(True),
            Song.created_by_user_id == user_id,
        )
        if user_band_ids:
            accessible_songs = (
                select(BandSong.song_id)
                .where(BandSong.band_id.in_(user_band_ids))
                .distinct()
                .scalar_subquery()
            )
            visibility = or_(Song.id.in_(accessible_songs), shared_by_user)
        else:
            visibility = shared_by_user

        filters = (
            visibility,
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
        self,
        band_id: str,
        actor_user_id: str,
        email: str,
        *,
        can_analyze_songs: bool = False,
        can_invite_members: bool = False,
        can_manage_members: bool = False,
        can_delete_songs: bool = False,
    ) -> dict[str, Any]:
        band, _actor = await self.require_invite_access(band_id, actor_user_id)
        email_norm = email.strip().lower()
        if not email_norm:
            raise ValueError("E-mail inválido")

        member_count = await self._active_member_count(band_id)
        if member_count >= band.member_limit:
            raise ValueError(
                f"Limite de membros atingido ({band.member_limit}). Faça upgrade do plano."
            )

        pending = await self.session.execute(
            select(BandInvite).where(
                BandInvite.band_id == band_id,
                BandInvite.email == email_norm,
                BandInvite.accepted_at.is_(None),
                BandInvite.expires_at > datetime.now(UTC),
            )
        )
        if pending.scalar_one_or_none():
            raise ValueError("Já existe um convite pendente para este e-mail")

        token = secrets.token_urlsafe(32)
        invite = BandInvite(
            id=_new_id("inv"),
            band_id=band_id,
            email=email_norm,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            can_analyze_songs=bool(can_analyze_songs),
            can_invite_members=bool(can_invite_members),
            can_manage_members=bool(can_manage_members),
            can_delete_songs=bool(can_delete_songs),
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
        self.session.add(invite)
        await self.session.commit()
        return {
            "invite_id": invite.id,
            "token": token,
            "email": invite.email,
            "band_name": band.name,
        }

    async def list_pending_invites_for_user(self, user: User) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(BandInvite, Band)
            .join(Band, Band.id == BandInvite.band_id)
            .where(
                BandInvite.email == user.email.lower(),
                BandInvite.accepted_at.is_(None),
                BandInvite.expires_at > datetime.now(UTC),
            )
            .order_by(BandInvite.created_at.desc())
        )
        items: list[dict[str, Any]] = []
        for invite, band in result.all():
            items.append(self._serialize_pending_invite(invite, band))
        return items

    async def get_pending_invite_by_token(self, token: str) -> BandInvite | None:
        token_clean = (token or "").strip()
        if not token_clean:
            return None
        token_hash = hashlib.sha256(token_clean.encode()).hexdigest()
        result = await self.session.execute(
            select(BandInvite).where(
                BandInvite.token_hash == token_hash,
                BandInvite.accepted_at.is_(None),
                BandInvite.expires_at > datetime.now(UTC),
            )
        )
        return result.scalar_one_or_none()

    async def preview_invite(self, token: str) -> dict[str, Any]:
        """Público: dados do convite pendente para pré-preencher o cadastro."""
        invite = await self.get_pending_invite_by_token(token)
        if invite is None:
            raise ValueError("Convite inválido ou expirado")
        band = await self.get_band(invite.band_id)
        if band is None:
            raise ValueError("Banda não encontrada")
        return {
            "email": invite.email,
            "band_id": band.id,
            "band_name": band.name,
            "expires_at": invite.expires_at.isoformat(),
            "can_analyze_songs": invite.can_analyze_songs,
            "can_invite_members": invite.can_invite_members,
            "can_manage_members": invite.can_manage_members,
            "can_delete_songs": invite.can_delete_songs,
        }

    async def accept_invite(
        self, user: User, *, token: str | None = None, invite_id: str | None = None
    ) -> dict[str, Any]:
        invite = await self._resolve_pending_invite(user, token=token, invite_id=invite_id)
        return await self._accept_resolved_invite(invite, user)

    async def decline_invite(self, user: User, invite_id: str) -> dict[str, str]:
        invite = await self._resolve_pending_invite(user, invite_id=invite_id)
        await self.session.delete(invite)
        await self.session.commit()
        return {"status": "declined", "invite_id": invite_id}

    async def _resolve_pending_invite(
        self,
        user: User,
        *,
        token: str | None = None,
        invite_id: str | None = None,
    ) -> BandInvite:
        now = datetime.now(UTC)
        if token:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            result = await self.session.execute(
                select(BandInvite).where(
                    BandInvite.token_hash == token_hash,
                    BandInvite.accepted_at.is_(None),
                    BandInvite.expires_at > now,
                )
            )
        elif invite_id:
            result = await self.session.execute(
                select(BandInvite).where(
                    BandInvite.id == invite_id,
                    BandInvite.accepted_at.is_(None),
                    BandInvite.expires_at > now,
                )
            )
        else:
            raise ValueError("Informe o token ou o id do convite")

        invite = result.scalar_one_or_none()
        if invite is None:
            raise ValueError("Convite inválido ou expirado")
        if invite.email != user.email.lower():
            raise ValueError("Este convite foi enviado para outro e-mail")
        return invite

    async def _accept_resolved_invite(self, invite: BandInvite, user: User) -> dict[str, Any]:
        existing = await self.get_member(invite.band_id, user.id)
        if existing:
            invite.accepted_at = datetime.now(UTC)
            await self.session.commit()
            band = await self.get_band(invite.band_id)
            if band is None:
                raise ValueError("Banda não encontrada")
            return self._serialize_band(band, existing, await self._active_member_count(band.id))

        member_count = await self._active_member_count(invite.band_id)
        band = await self.get_band(invite.band_id)
        if band is None:
            raise ValueError("Banda não encontrada")
        if member_count >= band.member_limit:
            raise ValueError("Esta banda atingiu o limite de membros")

        member = BandMember(
            id=_new_id("mbr"),
            band_id=invite.band_id,
            user_id=user.id,
            role="member",
            can_analyze_songs=invite.can_analyze_songs,
            can_invite_members=invite.can_invite_members,
            can_manage_members=invite.can_manage_members,
            can_delete_songs=invite.can_delete_songs,
            status="active",
            invited_at=invite.created_at,
            joined_at=datetime.now(UTC),
        )
        invite.accepted_at = datetime.now(UTC)
        self.session.add(member)
        await self.session.commit()

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

    def _serialize_pending_invite(self, invite: BandInvite, band: Band) -> dict[str, Any]:
        return {
            "id": invite.id,
            "band_id": band.id,
            "band_name": band.name,
            "email": invite.email,
            "can_analyze_songs": invite.can_analyze_songs,
            "can_invite_members": invite.can_invite_members,
            "can_manage_members": invite.can_manage_members,
            "can_delete_songs": invite.can_delete_songs,
            "expires_at": invite.expires_at.isoformat(),
            "created_at": invite.created_at.isoformat(),
        }

    async def update_member_permissions(
        self, band_id: str, owner_id: str, member_id: str, can_analyze: bool
    ) -> dict[str, Any]:
        """Compat: atualiza só can_analyze_songs."""
        return await self.update_member(
            band_id,
            owner_id,
            member_id,
            {"can_analyze_songs": can_analyze},
        )

    async def list_roles(self, band_id: str, user_id: str) -> list[dict[str, Any]]:
        await self.require_view_access(band_id, user_id)
        result = await self.session.execute(
            select(BandRole)
            .where(BandRole.band_id == band_id)
            .order_by(BandRole.sort_order.asc(), BandRole.name.asc())
        )
        return [self._serialize_role(role) for role in result.scalars().all()]

    async def create_role(self, band_id: str, user_id: str, name: str) -> dict[str, Any]:
        await self.require_manage_access(band_id, user_id)
        clean = name.strip()
        if not clean:
            raise ValueError("Nome da função é obrigatório")
        dup = await self.session.execute(
            select(BandRole).where(BandRole.band_id == band_id, BandRole.name == clean)
        )
        if dup.scalar_one_or_none():
            raise ValueError("Já existe uma função com este nome")
        max_order = await self.session.execute(
            select(func.coalesce(func.max(BandRole.sort_order), -1)).where(BandRole.band_id == band_id)
        )
        role = BandRole(
            id=_new_id("rol"),
            band_id=band_id,
            name=clean,
            sort_order=int(max_order.scalar_one()) + 1,
            is_default=False,
        )
        self.session.add(role)
        await self.session.commit()
        return self._serialize_role(role)

    async def update_role(
        self, band_id: str, user_id: str, role_id: str, name: str
    ) -> dict[str, Any]:
        await self.require_manage_access(band_id, user_id)
        role = await self._get_role(band_id, role_id)
        clean = name.strip()
        if not clean:
            raise ValueError("Nome da função é obrigatório")
        dup = await self.session.execute(
            select(BandRole).where(
                BandRole.band_id == band_id,
                BandRole.name == clean,
                BandRole.id != role_id,
            )
        )
        if dup.scalar_one_or_none():
            raise ValueError("Já existe uma função com este nome")
        role.name = clean
        await self.session.commit()
        return self._serialize_role(role)

    async def delete_role(self, band_id: str, user_id: str, role_id: str) -> dict[str, str]:
        await self.require_manage_access(band_id, user_id)
        role = await self._get_role(band_id, role_id)
        links = await self.session.execute(
            select(BandMemberRole).where(BandMemberRole.role_id == role_id)
        )
        for link in links.scalars().all():
            await self.session.delete(link)
        await self.session.delete(role)
        await self.session.commit()
        return {"status": "deleted", "id": role_id}

    async def list_members(self, band_id: str, user_id: str) -> list[dict[str, Any]]:
        await self.require_view_access(band_id, user_id)
        result = await self.session.execute(
            select(BandMember, User)
            .join(User, User.id == BandMember.user_id)
            .where(BandMember.band_id == band_id, BandMember.status == "active")
            .order_by(User.full_name.asc())
        )
        items: list[dict[str, Any]] = []
        for member, user in result.all():
            roles = await self._member_roles(member.id)
            items.append(self._serialize_member(member, user, roles))
        return items

    async def update_member(
        self,
        band_id: str,
        actor_user_id: str,
        member_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        await self.require_manage_access(band_id, actor_user_id)
        result = await self.session.execute(
            select(BandMember, User)
            .join(User, User.id == BandMember.user_id)
            .where(BandMember.id == member_id, BandMember.band_id == band_id)
        )
        row = result.one_or_none()
        if row is None:
            raise ValueError("Membro inválido")
        member, user = row
        if member.status != "active":
            raise ValueError("Membro inválido")

        if member.role == "owner":
            # Owner: só funções musicais
            if "role_ids" in payload:
                await self._set_member_roles(band_id, member.id, list(payload.get("role_ids") or []))
        else:
            if "can_analyze_songs" in payload and payload["can_analyze_songs"] is not None:
                member.can_analyze_songs = bool(payload["can_analyze_songs"])
            if "can_invite_members" in payload and payload["can_invite_members"] is not None:
                member.can_invite_members = bool(payload["can_invite_members"])
            if "can_manage_members" in payload and payload["can_manage_members"] is not None:
                member.can_manage_members = bool(payload["can_manage_members"])
            if "can_delete_songs" in payload and payload["can_delete_songs"] is not None:
                member.can_delete_songs = bool(payload["can_delete_songs"])
            if "role_ids" in payload:
                await self._set_member_roles(band_id, member.id, list(payload.get("role_ids") or []))

        await self.session.commit()
        roles = await self._member_roles(member.id)
        return self._serialize_member(member, user, roles)

    async def remove_member(
        self, band_id: str, actor_user_id: str, member_id: str
    ) -> dict[str, str]:
        await self.require_manage_access(band_id, actor_user_id)
        result = await self.session.execute(
            select(BandMember).where(BandMember.id == member_id, BandMember.band_id == band_id)
        )
        member = result.scalar_one_or_none()
        if member is None or member.status != "active":
            raise ValueError("Membro inválido")
        if member.role == "owner":
            raise ValueError("Não é possível remover o responsável da banda")
        member.status = "removed"
        member.removed_at = datetime.now(UTC)
        await self.session.commit()
        return {"status": "removed", "id": member_id}

    async def change_plan(
        self, band_id: str, user_id: str, plan_code: str
    ) -> dict[str, Any]:
        band, member = await self.require_view_access(band_id, user_id)
        if band.owner_user_id != user_id:
            raise PermissionError("Apenas o responsável pode alterar o plano")
        if band.billing_exempt:
            raise PermissionError("Banda isenta não altera plano por esta tela")
        if plan_code not in PLAN_LIMITS:
            raise ValueError("Plano inválido")
        _base, member_limit, extra_cents = PLAN_LIMITS[plan_code]
        count = await self._active_member_count(band_id)
        if count > member_limit:
            raise ValueError(
                f"A banda tem {count} membros; o plano escolhido permite no máximo {member_limit}"
            )
        band.plan_code = plan_code
        band.member_limit = member_limit
        band.extra_member_price_cents = extra_cents
        await self.session.commit()
        return self._serialize_band(band, member, count)

    async def _get_role(self, band_id: str, role_id: str) -> BandRole:
        result = await self.session.execute(
            select(BandRole).where(BandRole.id == role_id, BandRole.band_id == band_id)
        )
        role = result.scalar_one_or_none()
        if role is None:
            raise ValueError("Função não encontrada")
        return role

    async def _member_roles(self, member_id: str) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(BandRole)
            .join(BandMemberRole, BandMemberRole.role_id == BandRole.id)
            .where(BandMemberRole.member_id == member_id)
            .order_by(BandRole.sort_order.asc(), BandRole.name.asc())
        )
        return [self._serialize_role(role) for role in result.scalars().all()]

    async def _set_member_roles(self, band_id: str, member_id: str, role_ids: list[str]) -> None:
        unique_ids = list(dict.fromkeys(role_ids))
        if unique_ids:
            roles_result = await self.session.execute(
                select(BandRole).where(BandRole.band_id == band_id, BandRole.id.in_(unique_ids))
            )
            found = {r.id for r in roles_result.scalars().all()}
            if found != set(unique_ids):
                raise ValueError("Função inválida para esta banda")

        existing = await self.session.execute(
            select(BandMemberRole).where(BandMemberRole.member_id == member_id)
        )
        for link in existing.scalars().all():
            await self.session.delete(link)
        await self.session.flush()
        for role_id in unique_ids:
            self.session.add(
                BandMemberRole(
                    id=_new_id("mrl"),
                    member_id=member_id,
                    role_id=role_id,
                )
            )

    def _serialize_role(self, role: BandRole) -> dict[str, Any]:
        return {
            "id": role.id,
            "band_id": role.band_id,
            "name": role.name,
            "sort_order": role.sort_order,
            "is_default": role.is_default,
        }

    def _serialize_member(
        self, member: BandMember, user: User, roles: list[dict[str, Any]]
    ) -> dict[str, Any]:
        is_owner = member.role == "owner"
        return {
            "id": member.id,
            "user_id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "is_owner": is_owner,
            "joined_at": member.joined_at.isoformat() if member.joined_at else None,
            "roles": roles,
            "can_analyze_songs": is_owner or member.can_analyze_songs,
            "can_invite_members": is_owner or member.can_invite_members,
            "can_manage_members": is_owner or member.can_manage_members,
            "can_delete_songs": is_owner or member.can_delete_songs,
        }

    async def _active_member_count(self, band_id: str) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(BandMember)
            .where(BandMember.band_id == band_id, BandMember.status == "active")
        )
        return int(result.scalar_one())

    def _serialize_band(self, band: Band, member: BandMember, member_count: int) -> dict[str, Any]:
        is_owner = member.role == "owner"
        return {
            "id": band.id,
            "name": band.name,
            "plan_code": band.plan_code,
            "status": band.status,
            "member_count": member_count,
            "member_limit": band.member_limit,
            "billing_exempt": band.billing_exempt,
            "can_analyze_songs": is_owner or member.can_analyze_songs,
            "can_invite_members": is_owner or member.can_invite_members,
            "can_manage_members": is_owner or member.can_manage_members,
            "can_delete_songs": is_owner or member.can_delete_songs,
            "is_owner": is_owner,
            "is_blocked": (not band.billing_exempt) and band.status in BLOCKED_STATUSES,
            "trial_ends_at": band.trial_ends_at.isoformat() if band.trial_ends_at else None,
        }
