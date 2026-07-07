from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.admin_service import AdminService
from app.application.services.analysis_service import AnalysisService
from app.application.services.auth_service import AuthService
from app.application.services.band_service import BandService
from app.application.services.billing_service import BillingService
from app.application.services.email_service import EmailService
from app.config import get_settings
from app.infrastructure.database.models import User
from app.infrastructure.database.session import get_session
from app.presentation.api.deps import get_band_id, get_current_admin, get_current_user

router = APIRouter(prefix="/internal", tags=["saas"])


class RegisterBody(BaseModel):
    full_name: str
    cpf: str
    birth_date: str
    email: str
    phone: str
    address_street: str
    address_number: str
    address_complement: str | None = None
    address_neighborhood: str
    address_city: str
    address_state: str
    address_zip: str
    password: str = Field(min_length=8)


class LoginBody(BaseModel):
    login: str
    password: str = Field(min_length=8)


class RefreshBody(BaseModel):
    refresh_token: str


class CreateBandBody(BaseModel):
    name: str
    plan_code: str


class InviteBody(BaseModel):
    email: str
    can_analyze_songs: bool = False


class AcceptInviteBody(BaseModel):
    token: str


class MemberPermissionBody(BaseModel):
    can_analyze_songs: bool


class AdminLoginBody(BaseModel):
    email: str
    password: str


class BlockSongBody(BaseModel):
    song_id: str | None = None
    youtube_video_id: str | None = None
    reason: str


class MarketingBody(BaseModel):
    subject: str
    body: str
    audience: str = "all"


class ExemptBody(BaseModel):
    exempt: bool
    reason: str | None = None


class ResetPasswordBody(BaseModel):
    password: str = Field(min_length=8)


@router.post("/auth/register")
async def register(body: RegisterBody, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    try:
        return await AuthService(session).register(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/auth/login")
async def login(body: LoginBody, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    try:
        return await AuthService(session).login(body.login, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/auth/refresh")
async def refresh(body: RefreshBody, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    try:
        return await AuthService(session).refresh(body.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/auth/logout")
async def logout(body: RefreshBody, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    await AuthService(session).logout(body.refresh_token)
    return {"status": "ok"}


@router.get("/auth/me")
async def me(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return AuthService(session).serialize_user(user)


@router.get("/bands")
async def list_bands(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    items = await BandService(session).list_user_bands(user.id)
    return {"items": items}


@router.post("/bands")
async def create_band(
    body: CreateBandBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).create_band(user, body.name, body.plan_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/bands/{band_id}/invites")
async def invite_member(
    band_id: str,
    body: InviteBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        invite = await BandService(session).invite_member(
            band_id, user.id, body.email, body.can_analyze_songs
        )
        settings = get_settings()
        invite_url = f"{settings.web_origin}/convite?token={invite['token']}"
        EmailService().invite_member(body.email, band_id, invite_url)
        return {"invite_id": invite["invite_id"], "email": invite["email"]}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/invites/accept")
async def accept_invite(
    body: AcceptInviteBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).accept_invite(body.token, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/bands/{band_id}/members/{member_id}")
async def update_member(
    band_id: str,
    member_id: str,
    body: MemberPermissionBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).update_member_permissions(
            band_id, user.id, member_id, body.can_analyze_songs
        )
    except (PermissionError, ValueError) as exc:
        status = 403 if isinstance(exc, PermissionError) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.get("/billing/invoices")
async def list_invoices(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    items = await BillingService(session).list_invoices(user.id)
    return {"items": items}


@router.get("/billing/status")
async def billing_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return await BillingService(session).get_billing_status(user.id)


class CreditCardBody(BaseModel):
    holder_name: str
    number: str
    expiry_month: str
    expiry_year: str
    ccv: str


class CheckoutBody(BaseModel):
    payment_method: Literal["pix", "credit_card"]
    credit_card: CreditCardBody | None = None
    holder_info: dict[str, Any] | None = None


@router.post("/billing/checkout")
async def billing_checkout(
    body: CheckoutBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BillingService(session).create_checkout(
            user.id,
            body.payment_method,
            body.credit_card.model_dump() if body.credit_card else None,
            body.holder_info,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/webhooks/asaas")
async def asaas_webhook(
    payload: dict[str, Any],
    asaas_access_token: str | None = Header(default=None, alias="asaas-access-token"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    settings = get_settings()
    if settings.asaas_webhook_token and asaas_access_token != settings.asaas_webhook_token:
        raise HTTPException(status_code=401, detail="Webhook não autorizado")
    event = payload.get("event")
    payment = payload.get("payment") or {}
    billing = BillingService(session)
    if event == "PAYMENT_CONFIRMED":
        await billing.handle_payment_confirmed(payment)
    elif event == "PAYMENT_OVERDUE":
        await billing.handle_payment_overdue(payment)
    return {"status": "ok"}


@router.post("/admin/auth/login")
async def admin_login(body: AdminLoginBody, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    try:
        return await AdminService(session).login(body.email, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/admin/dashboard/stats")
async def admin_dashboard_stats(
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _ = admin
    return await AnalysisService(session).get_dashboard_stats()


@router.get("/admin/users")
async def admin_users(
    q: str | None = None,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return {"items": await AdminService(session).list_users(q)}


@router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str,
    body: ResetPasswordBody,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).reset_user_password(user_id, body.password)
    await AdminService(session).audit(admin.id, "reset_password", "user", user_id, None)
    return {"status": "ok"}


@router.get("/admin/bands")
async def admin_bands(admin=Depends(get_current_admin), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return {"items": await AdminService(session).list_bands()}


@router.patch("/admin/bands/{band_id}/exempt")
async def admin_exempt(
    band_id: str,
    body: ExemptBody,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).set_band_exempt(band_id, body.exempt, body.reason)
    await AdminService(session).audit(admin.id, "set_exempt", "band", band_id, body.model_dump())
    return {"status": "ok"}


@router.post("/admin/bands/{band_id}/suspend")
async def admin_suspend(
    band_id: str,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).suspend_band(band_id)
    await AdminService(session).audit(admin.id, "suspend", "band", band_id, None)
    return {"status": "ok"}


@router.post("/admin/songs/block")
async def admin_block_song(
    body: BlockSongBody,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).block_song(admin.id, body.song_id, body.youtube_video_id, body.reason)
    await AdminService(session).audit(admin.id, "block_song", "song", body.song_id, body.model_dump())
    return {"status": "ok"}


@router.post("/admin/marketing/send")
async def admin_marketing(
    body: MarketingBody,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    result = await AdminService(session).send_marketing(body.subject, body.body, body.audience)
    await AdminService(session).audit(admin.id, "marketing_send", "campaign", None, result)
    return result


@router.post("/admin/billing/suspend-overdue")
async def admin_suspend_overdue(
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    count = await BillingService(session).suspend_overdue_accounts()
    await AdminService(session).audit(admin.id, "suspend_overdue", "billing", None, {"count": count})
    return {"suspended": count}
