from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.models import (
    AdminRole,
    AdminUser,
    AuditLog,
    Band,
    BandStatus,
    BillingAccount,
    Invoice,
    InvoiceLineItem,
    InvoiceStatus,
    Song,
    SongBlock,
    User,
)
from app.infrastructure.security.jwt_tokens import create_access_token
from app.infrastructure.security.passwords import hash_password, verify_password
from app.presentation.api.deps import is_full_admin, normalize_admin_role


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


VALID_ADMIN_ROLES = {AdminRole.FULL_ADMIN.value, AdminRole.SALESPERSON.value}


class AdminService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def serialize_admin(self, admin: AdminUser) -> dict[str, Any]:
        return {
            "id": admin.id,
            "email": admin.email,
            "full_name": admin.full_name,
            "role": normalize_admin_role(admin.role),
            "status": admin.status,
            "created_at": admin.created_at.isoformat() if admin.created_at else None,
        }

    async def login(self, email: str, password: str) -> dict[str, Any]:
        result = await self.session.execute(
            select(AdminUser).where(
                AdminUser.email == email.strip().lower(),
                AdminUser.status == "active",
            )
        )
        admin = result.scalar_one_or_none()
        if admin is None or not verify_password(password, admin.password_hash):
            raise ValueError("Credenciais inválidas")
        role = normalize_admin_role(admin.role)
        if admin.role != role:
            admin.role = role
            await self.session.commit()
        return {
            "access_token": create_access_token(admin.id, admin=True, role=role),
            "admin": self.serialize_admin(admin),
        }

    async def me(self, admin: AdminUser) -> dict[str, Any]:
        return self.serialize_admin(admin)

    async def list_admins(self) -> list[dict[str, Any]]:
        result = await self.session.execute(select(AdminUser).order_by(AdminUser.created_at.desc()))
        return [self.serialize_admin(item) for item in result.scalars().all()]

    async def create_admin(
        self,
        *,
        email: str,
        full_name: str,
        password: str,
        role: str,
    ) -> dict[str, Any]:
        if role not in VALID_ADMIN_ROLES:
            raise ValueError("Role inválida. Use full_admin ou salesperson")
        clean_email = email.strip().lower()
        existing = await self.session.execute(select(AdminUser).where(AdminUser.email == clean_email))
        if existing.scalar_one_or_none():
            raise ValueError("E-mail já cadastrado")
        admin = AdminUser(
            id=_new_id("adm"),
            email=clean_email,
            full_name=full_name.strip(),
            password_hash=hash_password(password),
            role=role,
            status="active",
        )
        self.session.add(admin)
        await self.session.commit()
        await self.session.refresh(admin)
        return self.serialize_admin(admin)

    async def update_admin(
        self,
        admin_id: str,
        *,
        full_name: str | None = None,
        role: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        result = await self.session.execute(select(AdminUser).where(AdminUser.id == admin_id))
        admin = result.scalar_one_or_none()
        if admin is None:
            raise ValueError("Admin não encontrado")

        previous_role = normalize_admin_role(admin.role)
        previous_status = admin.status

        if full_name is not None:
            admin.full_name = full_name.strip()
        if role is not None:
            if role not in VALID_ADMIN_ROLES:
                raise ValueError("Role inválida. Use full_admin ou salesperson")
            admin.role = role
        if status is not None:
            if status not in {"active", "inactive"}:
                raise ValueError("Status inválido")
            admin.status = status

        next_role = normalize_admin_role(admin.role)
        demoting_last = (
            previous_role == AdminRole.FULL_ADMIN.value
            and previous_status == "active"
            and (
                next_role != AdminRole.FULL_ADMIN.value
                or admin.status != "active"
            )
        )
        if demoting_last:
            count = await self._count_active_full_admins(exclude_id=admin.id)
            if count == 0:
                raise ValueError("Não é possível remover o último administrador ativo")

        await self.session.commit()
        await self.session.refresh(admin)
        return self.serialize_admin(admin)

    async def reset_admin_password(self, admin_id: str, new_password: str) -> None:
        result = await self.session.execute(select(AdminUser).where(AdminUser.id == admin_id))
        admin = result.scalar_one_or_none()
        if admin is None:
            raise ValueError("Admin não encontrado")
        admin.password_hash = hash_password(new_password)
        await self.session.commit()

    async def _count_active_full_admins(self, *, exclude_id: str | None = None) -> int:
        stmt = select(func.count()).select_from(AdminUser).where(
            AdminUser.status == "active",
            AdminUser.role == AdminRole.FULL_ADMIN.value,
        )
        if exclude_id:
            stmt = stmt.where(AdminUser.id != exclude_id)
        result = await self.session.execute(stmt)
        return int(result.scalar_one())

    async def list_users(
        self,
        query: str | None = None,
        *,
        admin: AdminUser | None = None,
    ) -> list[dict[str, Any]]:
        stmt = select(User).where(User.deleted_at.is_(None))
        if admin is not None and not is_full_admin(admin):
            stmt = stmt.where(User.registered_by_admin_id == admin.id)
        if query:
            like = f"%{query.strip()}%"
            stmt = stmt.where(or_(User.full_name.ilike(like), User.email.ilike(like)))
        result = await self.session.execute(stmt.order_by(User.created_at.desc()).limit(200))
        items = []
        for user in result.scalars().all():
            delinquent = await self._user_has_delinquency(user.id)
            items.append(
                {
                    "id": user.id,
                    "full_name": user.full_name,
                    "email": user.email,
                    "cpf": user.cpf,
                    "is_company": bool(user.is_company),
                    "status": user.status,
                    "registered_by_admin_id": user.registered_by_admin_id,
                    "is_delinquent": delinquent,
                    "created_at": user.created_at.isoformat(),
                }
            )
        return items

    async def reset_user_password(
        self,
        user_id: str,
        new_password: str,
        *,
        admin: AdminUser | None = None,
    ) -> None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise ValueError("Usuário não encontrado")
        if admin is not None and not is_full_admin(admin):
            if user.registered_by_admin_id != admin.id:
                raise PermissionError("Usuário fora do seu escopo")
        user.password_hash = hash_password(new_password)
        await self.session.commit()

    async def list_bands(self, *, admin: AdminUser | None = None) -> list[dict[str, Any]]:
        stmt = select(Band).order_by(Band.created_at.desc()).limit(200)
        if admin is not None and not is_full_admin(admin):
            stmt = select(Band).where(Band.registered_by_admin_id == admin.id).order_by(
                Band.created_at.desc()
            ).limit(200)
        result = await self.session.execute(stmt)
        items = []
        for band in result.scalars().all():
            delinquent = await self._band_is_delinquent(band)
            items.append(
                {
                    "id": band.id,
                    "name": band.name,
                    "plan_code": band.plan_code,
                    "status": band.status,
                    "billing_exempt": band.billing_exempt,
                    "owner_user_id": band.owner_user_id,
                    "registered_by_admin_id": band.registered_by_admin_id,
                    "is_delinquent": delinquent,
                }
            )
        return items

    async def _band_is_delinquent(self, band: Band) -> bool:
        # pending_payment = aguardando 1ª fatura (ainda no prazo) — NÃO é inadimplência.
        if band.status in {
            BandStatus.PAST_DUE.value,
            BandStatus.SUSPENDED.value,
        }:
            return True
        overdue = await self.session.execute(
            select(func.count())
            .select_from(InvoiceLineItem)
            .join(Invoice, Invoice.id == InvoiceLineItem.invoice_id)
            .where(
                InvoiceLineItem.band_id == band.id,
                Invoice.status == InvoiceStatus.OVERDUE.value,
            )
        )
        return int(overdue.scalar_one()) > 0

    async def _user_has_delinquency(self, user_id: str) -> bool:
        bands = await self.session.execute(select(Band).where(Band.owner_user_id == user_id))
        for band in bands.scalars().all():
            if await self._band_is_delinquent(band):
                return True
        return False

    async def ensure_band_in_scope(self, band_id: str, admin: AdminUser) -> Band:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        band = result.scalar_one_or_none()
        if band is None:
            raise ValueError("Banda não encontrada")
        if not is_full_admin(admin) and band.registered_by_admin_id != admin.id:
            raise PermissionError("Banda fora do seu escopo")
        return band

    async def set_band_exempt(self, band_id: str, exempt: bool, reason: str | None) -> None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        band = result.scalar_one_or_none()
        if band is None:
            raise ValueError("Banda não encontrada")
        if exempt:
            from app.application.services.billing_service import BillingService

            await BillingService(self.session).exempt_band_charges(band_id, reason)
            return
        band.billing_exempt = False
        band.exempt_reason = reason
        await self.session.commit()

    async def suspend_band(self, band_id: str) -> None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        band = result.scalar_one_or_none()
        if band is None:
            raise ValueError("Banda não encontrada")
        band.status = BandStatus.SUSPENDED.value
        await self.session.commit()

    async def delete_band(self, band_id: str) -> None:
        from sqlalchemy import delete, update

        from app.application.services.billing_service import BillingService
        from app.infrastructure.database.models import (
            BandInvite,
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
            CifraVariation,
        )

        result = await self.session.execute(select(Band).where(Band.id == band_id))
        if result.scalar_one_or_none() is None:
            raise ValueError("Banda não encontrada")

        await BillingService(self.session).purge_band_charges(band_id)

        schedule_ids = list(
            (
                await self.session.execute(select(BandSchedule.id).where(BandSchedule.band_id == band_id))
            )
            .scalars()
            .all()
        )
        if schedule_ids:
            await self.session.execute(
                delete(BandScheduleMemberRole).where(BandScheduleMemberRole.schedule_id.in_(schedule_ids))
            )
            await self.session.execute(
                delete(BandScheduleMember).where(BandScheduleMember.schedule_id.in_(schedule_ids))
            )
            await self.session.execute(
                delete(BandScheduleSong).where(BandScheduleSong.schedule_id.in_(schedule_ids))
            )
            await self.session.execute(
                delete(BandScheduleOccurrence).where(BandScheduleOccurrence.schedule_id.in_(schedule_ids))
            )
            await self.session.execute(delete(BandSchedule).where(BandSchedule.id.in_(schedule_ids)))

        member_ids = list(
            (await self.session.execute(select(BandMember.id).where(BandMember.band_id == band_id)))
            .scalars()
            .all()
        )
        if member_ids:
            await self.session.execute(delete(BandMemberRole).where(BandMemberRole.member_id.in_(member_ids)))
        await self.session.execute(delete(BandMember).where(BandMember.band_id == band_id))
        await self.session.execute(delete(BandRole).where(BandRole.band_id == band_id))
        await self.session.execute(delete(BandInvite).where(BandInvite.band_id == band_id))
        await self.session.execute(delete(BandSavedAddress).where(BandSavedAddress.band_id == band_id))
        await self.session.execute(delete(BandSong).where(BandSong.band_id == band_id))
        await self.session.execute(
            update(CifraVariation).where(CifraVariation.band_id == band_id).values(band_id=None)
        )

        band_result = await self.session.execute(select(Band).where(Band.id == band_id))
        band = band_result.scalar_one_or_none()
        if band is not None:
            await self.session.delete(band)
        await self.session.commit()

    async def register_sale(self, admin: AdminUser, payload: dict[str, Any]) -> dict[str, Any]:
        from app.application.services.auth_service import AuthService
        from app.application.services.band_service import BandService

        band_name = str(payload.get("band_name") or "").strip()
        plan_code = str(payload.get("plan_code") or "").strip()
        if not band_name:
            raise ValueError("Nome da banda é obrigatório")
        if not plan_code:
            raise ValueError("Plano é obrigatório")

        password = str(payload.get("password") or "").strip()
        if not password:
            password = secrets.token_urlsafe(10)

        register_payload = {
            **payload,
            "password": password,
            "registered_by_admin_id": admin.id,
            "issue_tokens": False,
        }
        created = await AuthService(self.session).register(register_payload)
        user_id = created["user"]["id"]
        user_result = await self.session.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one()
        band = await BandService(self.session).create_band(
            user,
            band_name,
            plan_code,
            registered_by_admin_id=admin.id,
        )
        return {
            "user": created["user"],
            "band": band,
            "temporary_password": password if not payload.get("password") else None,
        }

    async def sales_dashboard_stats(self, admin: AdminUser) -> dict[str, Any]:
        users = await self.list_users(admin=admin)
        bands = await self.list_bands(admin=admin)
        overdue_bands = sum(1 for band in bands if band.get("is_delinquent"))
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "scope": "salesperson",
            "users_total": len(users),
            "bands_total": len(bands),
            "delinquent_bands": overdue_bands,
            "delinquent_users": sum(1 for user in users if user.get("is_delinquent")),
        }

    async def block_song(self, admin_id: str, song_id: str | None, youtube_video_id: str | None, reason: str) -> None:
        if song_id:
            result = await self.session.execute(select(Song).where(Song.id == song_id))
            song = result.scalar_one_or_none()
            if song:
                song.moderation_status = "blocked"
                song.blocked_reason = reason
                song.blocked_by_admin_id = admin_id
                song.blocked_at = datetime.now(UTC)
        self.session.add(
            SongBlock(
                id=_new_id("blk"),
                song_id=song_id,
                youtube_video_id=youtube_video_id,
                reason=reason,
                blocked_by_admin_id=admin_id,
            )
        )
        await self.session.commit()

    async def send_marketing(self, subject: str, body: str, audience: str) -> dict[str, Any]:
        from app.application.services.email_service import EmailService

        email_service = EmailService()
        if audience == "owners":
            result = await self.session.execute(select(BillingAccount))
            owner_ids = [account.owner_user_id for account in result.scalars().all()]
            users_result = await self.session.execute(select(User).where(User.id.in_(owner_ids)))
        else:
            users_result = await self.session.execute(select(User).where(User.deleted_at.is_(None)))
        recipients = [user.email for user in users_result.scalars().all()]
        sent = email_service.send_bulk(recipients, subject, body)
        return {"sent": sent, "total": len(recipients)}

    async def audit(
        self,
        admin_id: str,
        action: str,
        entity_type: str,
        entity_id: str | None,
        payload: dict[str, Any] | None,
    ) -> None:
        self.session.add(
            AuditLog(
                id=_new_id("aud"),
                actor_type="admin",
                actor_id=admin_id,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                payload_json=json.dumps(payload or {}),
            )
        )
        await self.session.commit()
