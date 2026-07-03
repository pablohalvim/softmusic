from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database.models import (
    AdminUser,
    AuditLog,
    Band,
    BandStatus,
    BillingAccount,
    Song,
    SongBlock,
    User,
)
from app.infrastructure.security.jwt_tokens import create_access_token
from app.infrastructure.security.passwords import hash_password, verify_password


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


class AdminService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

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
        return {
            "access_token": create_access_token(admin.id, admin=True),
            "admin": {"id": admin.id, "email": admin.email, "full_name": admin.full_name, "role": admin.role},
        }

    async def list_users(self, query: str | None = None) -> list[dict[str, Any]]:
        stmt = select(User).where(User.deleted_at.is_(None))
        if query:
            like = f"%{query.strip()}%"
            stmt = stmt.where(or_(User.full_name.ilike(like), User.email.ilike(like)))
        result = await self.session.execute(stmt.order_by(User.created_at.desc()).limit(100))
        return [
            {
                "id": user.id,
                "full_name": user.full_name,
                "email": user.email,
                "cpf": user.cpf,
                "status": user.status,
                "created_at": user.created_at.isoformat(),
            }
            for user in result.scalars().all()
        ]

    async def reset_user_password(self, user_id: str, new_password: str) -> None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise ValueError("Usuário não encontrado")
        user.password_hash = hash_password(new_password)
        await self.session.commit()

    async def list_bands(self) -> list[dict[str, Any]]:
        result = await self.session.execute(select(Band).order_by(Band.created_at.desc()).limit(200))
        return [
            {
                "id": band.id,
                "name": band.name,
                "plan_code": band.plan_code,
                "status": band.status,
                "billing_exempt": band.billing_exempt,
                "owner_user_id": band.owner_user_id,
            }
            for band in result.scalars().all()
        ]

    async def set_band_exempt(self, band_id: str, exempt: bool, reason: str | None) -> None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        band = result.scalar_one_or_none()
        if band is None:
            raise ValueError("Banda não encontrada")
        band.billing_exempt = exempt
        band.exempt_reason = reason
        band.status = BandStatus.ACTIVE.value if exempt else band.status
        await self.session.commit()

    async def suspend_band(self, band_id: str) -> None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        band = result.scalar_one_or_none()
        if band is None:
            raise ValueError("Banda não encontrada")
        band.status = BandStatus.SUSPENDED.value
        await self.session.commit()

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

    async def audit(self, admin_id: str, action: str, entity_type: str, entity_id: str | None, payload: dict[str, Any] | None) -> None:
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
