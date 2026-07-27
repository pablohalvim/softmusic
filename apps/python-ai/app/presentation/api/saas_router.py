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
from app.application.services.geocoding_service import autocomplete_places
from app.application.services.schedule_service import ScheduleService
from app.config import get_settings
from app.infrastructure.database.models import User
from app.infrastructure.database.session import get_session
from app.presentation.api.deps import (
    get_band_id,
    get_current_admin,
    get_current_user,
    is_full_admin,
    require_full_admin,
)

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
    invite_token: str | None = None


class LoginBody(BaseModel):
    login: str
    password: str = Field(min_length=8)


class ForgotPasswordBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class VerifyResetCodeBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(min_length=6, max_length=12)


class ResetPasswordWithCodeBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(min_length=6, max_length=12)
    password: str = Field(min_length=8, max_length=128)


class RefreshBody(BaseModel):
    refresh_token: str


class CreateBandBody(BaseModel):
    name: str
    plan_code: str


class InviteBody(BaseModel):
    email: str
    can_analyze_songs: bool = False
    can_invite_members: bool = False
    can_manage_members: bool = False
    can_delete_songs: bool = False


class AcceptInviteBody(BaseModel):
    token: str | None = None
    invite_id: str | None = None


class DeclineInviteBody(BaseModel):
    invite_id: str


class MemberPermissionBody(BaseModel):
    can_analyze_songs: bool | None = None
    can_invite_members: bool | None = None
    can_manage_members: bool | None = None
    can_delete_songs: bool | None = None
    role_ids: list[str] | None = None


class AsaasSettingsBody(BaseModel):
    asaas_api_key: str | None = None
    asaas_environment: Literal["sandbox", "production"] | None = None
    asaas_webhook_token: str | None = None


class RoleBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ChangePlanBody(BaseModel):
    plan_code: str


class SavedAddressBody(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    formatted_address: str = Field(min_length=1, max_length=500)
    lat: float
    lng: float
    place_id: str | None = None


class ScheduleOccurrenceBody(BaseModel):
    starts_at: str
    ends_at: str
    formatted_address: str | None = None
    lat: float | None = None
    lng: float | None = None
    place_id: str | None = None
    saved_address_id: str | None = None
    same_as_event_address: bool = False
    save_address: bool = False
    save_address_label: str | None = None


class ScheduleMemberSelectionBody(BaseModel):
    member_id: str
    role_ids: list[str] = Field(default_factory=list)


class ScheduleSongBody(BaseModel):
    song_id: str
    musical_key: str = ""


class CreateScheduleBody(BaseModel):
    title: str
    member_ids: list[str] = Field(default_factory=list)
    members: list[ScheduleMemberSelectionBody] = Field(default_factory=list)
    event: ScheduleOccurrenceBody
    rehearsals: list[ScheduleOccurrenceBody] = Field(default_factory=list)
    songs: list[ScheduleSongBody] = Field(default_factory=list)
    # Compat payloads antigos
    rehearsal: ScheduleOccurrenceBody | None = None
    rehearsal_same_as_event_address: bool = False
    save_event_address: bool = False
    save_event_address_label: str | None = None


class UpdateOccurrenceBody(BaseModel):
    title: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    formatted_address: str | None = None
    lat: float | None = None
    lng: float | None = None
    place_id: str | None = None
    saved_address_id: str | None = None
    member_ids: list[str] | None = None
    members: list[ScheduleMemberSelectionBody] | None = None
    songs: list[ScheduleSongBody] | None = None


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


class CreateAdminBody(BaseModel):
    email: str
    full_name: str
    password: str = Field(min_length=8)
    role: Literal["full_admin", "salesperson"] = "salesperson"


class UpdateAdminBody(BaseModel):
    full_name: str | None = None
    role: Literal["full_admin", "salesperson"] | None = None
    status: Literal["active", "inactive"] | None = None


class SalesRegisterBody(BaseModel):
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
    password: str | None = Field(default=None, min_length=8)
    band_name: str
    plan_code: str


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


@router.post("/auth/forgot-password")
async def forgot_password(
    body: ForgotPasswordBody,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await AuthService(session).request_password_reset(body.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/auth/verify-reset-code")
async def verify_reset_code(
    body: VerifyResetCodeBody,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await AuthService(session).verify_password_reset_code(body.email, body.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/auth/reset-password")
async def reset_password_with_code(
    body: ResetPasswordWithCodeBody,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await AuthService(session).reset_password(body.email, body.code, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
            band_id,
            user.id,
            body.email,
            can_analyze_songs=body.can_analyze_songs,
            can_invite_members=body.can_invite_members,
            can_manage_members=body.can_manage_members,
            can_delete_songs=body.can_delete_songs,
        )
        settings = get_settings()
        # Cadastro com auto-vínculo; quem já tem conta usa /convite ou login+aceite.
        invite_url = f"{settings.web_origin}/cadastro?token={invite['token']}"
        EmailService().invite_member(body.email, invite["band_name"], invite_url)
        return {"invite_id": invite["invite_id"], "email": invite["email"]}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/invites/preview")
async def preview_invite(
    token: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).preview_invite(token)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/invites/pending")
async def list_pending_invites(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    items = await BandService(session).list_pending_invites_for_user(user)
    return {"items": items}


@router.post("/invites/accept")
async def accept_invite(
    body: AcceptInviteBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).accept_invite(
            user, token=body.token, invite_id=body.invite_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/invites/decline")
async def decline_invite(
    body: DeclineInviteBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).decline_invite(user, body.invite_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/bands/{band_id}/roles")
async def list_roles(
    band_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        items = await BandService(session).list_roles(band_id, user.id)
        return {"items": items}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/bands/{band_id}/roles")
async def create_role(
    band_id: str,
    body: RoleBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).create_role(band_id, user.id, body.name)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/bands/{band_id}/roles/{role_id}")
async def update_role(
    band_id: str,
    role_id: str,
    body: RoleBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).update_role(band_id, user.id, role_id, body.name)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/bands/{band_id}/roles/{role_id}")
async def delete_role(
    band_id: str,
    role_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await BandService(session).delete_role(band_id, user.id, role_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/bands/{band_id}/members")
async def list_members(
    band_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        items = await BandService(session).list_members(band_id, user.id)
        return {"items": items}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.patch("/bands/{band_id}/members/{member_id}")
async def update_member(
    band_id: str,
    member_id: str,
    body: MemberPermissionBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).update_member(
            band_id, user.id, member_id, body.model_dump(exclude_unset=True)
        )
    except (PermissionError, ValueError) as exc:
        status = 403 if isinstance(exc, PermissionError) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.delete("/bands/{band_id}/members/{member_id}")
async def remove_member(
    band_id: str,
    member_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await BandService(session).remove_member(band_id, user.id, member_id)
    except (PermissionError, ValueError) as exc:
        status = 403 if isinstance(exc, PermissionError) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.patch("/bands/{band_id}/plan")
async def change_plan(
    band_id: str,
    body: ChangePlanBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BandService(session).change_plan(band_id, user.id, body.plan_code)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/bands/{band_id}/addresses")
async def list_addresses(
    band_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        items = await ScheduleService(session).list_addresses(band_id, user.id)
        return {"items": items}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/bands/{band_id}/addresses")
async def create_address(
    band_id: str,
    body: SavedAddressBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await ScheduleService(session).create_address(
            band_id,
            user.id,
            label=body.label,
            formatted_address=body.formatted_address,
            lat=body.lat,
            lng=body.lng,
            place_id=body.place_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/bands/{band_id}/addresses/{address_id}")
async def delete_address(
    band_id: str,
    address_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await ScheduleService(session).delete_address(band_id, user.id, address_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/bands/{band_id}/schedules")
async def list_schedules(
    band_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        items = await ScheduleService(session).list_schedules(band_id, user.id)
        return {"items": items}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/bands/{band_id}/schedules")
async def create_schedule(
    band_id: str,
    body: CreateScheduleBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await ScheduleService(session).create_schedule(
            band_id, user, body.model_dump()
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/bands/{band_id}/schedules/{schedule_id}")
async def get_schedule(
    band_id: str,
    schedule_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await ScheduleService(session).get_schedule(band_id, user.id, schedule_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/bands/{band_id}/schedules/occurrences/{occurrence_id}")
async def update_occurrence(
    band_id: str,
    occurrence_id: str,
    body: UpdateOccurrenceBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await ScheduleService(session).update_occurrence(
            band_id, user, occurrence_id, body.model_dump(exclude_unset=True)
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/bands/{band_id}/schedules/occurrences/{occurrence_id}/cancel")
async def cancel_occurrence(
    band_id: str,
    occurrence_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        return await ScheduleService(session).cancel_occurrence(band_id, user, occurrence_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/schedule/upcoming")
async def upcoming_schedule(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return await ScheduleService(session).upcoming_for_user(user)


@router.get("/schedule/mine")
async def my_schedules(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    items = await ScheduleService(session).list_mine_for_user(user)
    return {"items": items}


@router.get("/geo/autocomplete")
async def geo_autocomplete(
    q: str = "",
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    try:
        items = await autocomplete_places(q)
        return {"items": items}
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/billing/invoices")
async def list_invoices(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    items = await BillingService(session).list_invoices(user.id)
    return {"items": items}


@router.get("/billing/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BillingService(session).get_invoice_details(user.id, invoice_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/billing/invoices/{invoice_id}/pay")
async def pay_invoice(
    invoice_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BillingService(session).pay_invoice(user.id, invoice_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/billing/invoices/{invoice_id}/refresh")
async def refresh_invoice(
    invoice_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        return await BillingService(session).refresh_first_invoice(user.id, invoice_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/billing/status")
async def billing_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return await BillingService(session).get_billing_status(user.id)


@router.post("/webhooks/asaas")
async def asaas_webhook(
    payload: dict[str, Any],
    asaas_access_token: str | None = Header(default=None, alias="asaas-access-token"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    billing = BillingService(session)
    expected = await billing.get_setting("asaas_webhook_token")
    if expected and asaas_access_token != expected:
        raise HTTPException(status_code=401, detail="Webhook não autorizado")
    event = payload.get("event")
    payment = payload.get("payment") or {}
    if event in {"PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"}:
        await billing.handle_payment_confirmed(payment)
    elif event == "PAYMENT_OVERDUE":
        await billing.handle_payment_overdue(payment)
    elif event in {"PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"}:
        await billing.handle_payment_refunded(payment)
    return {"status": "ok"}


@router.post("/admin/auth/login")
async def admin_login(body: AdminLoginBody, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    try:
        return await AdminService(session).login(body.email, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/admin/me")
async def admin_me(admin=Depends(get_current_admin), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return await AdminService(session).me(admin)


@router.get("/admin/admins")
async def admin_list_admins(
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _ = admin
    return {"items": await AdminService(session).list_admins()}


@router.post("/admin/admins")
async def admin_create_admin(
    body: CreateAdminBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        created = await AdminService(session).create_admin(
            email=body.email,
            full_name=body.full_name,
            password=body.password,
            role=body.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await AdminService(session).audit(admin.id, "create_admin", "admin", created["id"], {
        "email": created["email"],
        "role": created["role"],
    })
    return {"admin": created}


@router.patch("/admin/admins/{admin_id}")
async def admin_update_admin(
    admin_id: str,
    body: UpdateAdminBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        updated = await AdminService(session).update_admin(
            admin_id,
            full_name=body.full_name,
            role=body.role,
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await AdminService(session).audit(admin.id, "update_admin", "admin", admin_id, body.model_dump(exclude_none=True))
    return {"admin": updated}


@router.post("/admin/admins/{admin_id}/reset-password")
async def admin_reset_admin_password(
    admin_id: str,
    body: ResetPasswordBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        await AdminService(session).reset_admin_password(admin_id, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await AdminService(session).audit(admin.id, "reset_admin_password", "admin", admin_id, None)
    return {"status": "ok"}


@router.post("/admin/sales/register")
async def admin_sales_register(
    body: SalesRegisterBody,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    payload = body.model_dump()
    try:
        result = await AdminService(session).register_sale(admin, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await AdminService(session).audit(
        admin.id,
        "sales_register",
        "user",
        result["user"]["id"],
        {"band_id": result["band"].get("id"), "plan_code": body.plan_code},
    )
    return result


@router.get("/admin/dashboard/stats")
async def admin_dashboard_stats(
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if not is_full_admin(admin):
        return await AdminService(session).sales_dashboard_stats(admin)
    return await AnalysisService(session).get_dashboard_stats()


@router.get("/admin/users")
async def admin_users(
    q: str | None = None,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    return {"items": await AdminService(session).list_users(q, admin=admin)}


@router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str,
    body: ResetPasswordBody,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        await AdminService(session).reset_user_password(user_id, body.password, admin=admin)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await AdminService(session).audit(admin.id, "reset_password", "user", user_id, None)
    return {"status": "ok"}


@router.get("/admin/bands")
async def admin_bands(admin=Depends(get_current_admin), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return {"items": await AdminService(session).list_bands(admin=admin)}


@router.patch("/admin/bands/{band_id}/exempt")
async def admin_exempt(
    band_id: str,
    body: ExemptBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).set_band_exempt(band_id, body.exempt, body.reason)
    await AdminService(session).audit(admin.id, "set_exempt", "band", band_id, body.model_dump())
    return {"status": "ok"}


@router.post("/admin/bands/{band_id}/suspend")
async def admin_suspend(
    band_id: str,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).suspend_band(band_id)
    await AdminService(session).audit(admin.id, "suspend", "band", band_id, None)
    return {"status": "ok"}


@router.post("/admin/songs/block")
async def admin_block_song(
    body: BlockSongBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await AdminService(session).block_song(admin.id, body.song_id, body.youtube_video_id, body.reason)
    await AdminService(session).audit(admin.id, "block_song", "song", body.song_id, body.model_dump())
    return {"status": "ok"}


@router.post("/admin/marketing/send")
async def admin_marketing(
    body: MarketingBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    result = await AdminService(session).send_marketing(body.subject, body.body, body.audience)
    await AdminService(session).audit(admin.id, "marketing_send", "campaign", None, result)
    return result


@router.post("/admin/billing/suspend-overdue")
async def admin_suspend_overdue(
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    stats = await BillingService(session).run_daily_billing_robot()
    await AdminService(session).audit(admin.id, "billing_robot", "billing", None, stats)
    return stats


@router.get("/admin/billing/settings")
async def admin_billing_settings(
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    _ = admin
    return await BillingService(session).get_asaas_settings()


@router.put("/admin/billing/settings")
async def admin_update_billing_settings(
    body: AsaasSettingsBody,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    billing = BillingService(session)
    if body.asaas_api_key is not None:
        await billing.set_setting("asaas_api_key", body.asaas_api_key.strip(), admin.id)
    if body.asaas_environment is not None:
        await billing.set_setting("asaas_environment", body.asaas_environment, admin.id)
    if body.asaas_webhook_token is not None:
        await billing.set_setting("asaas_webhook_token", body.asaas_webhook_token.strip(), admin.id)
    await AdminService(session).audit(admin.id, "update_asaas_settings", "settings", None, {
        "asaas_environment": body.asaas_environment,
        "api_key_updated": body.asaas_api_key is not None,
        "webhook_updated": body.asaas_webhook_token is not None,
    })
    return await billing.get_asaas_settings()


@router.get("/admin/billing/invoices")
async def admin_list_invoices(
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    scope = None if is_full_admin(admin) else admin.id
    return {"items": await BillingService(session).list_all_invoices_admin(registered_by_admin_id=scope)}


@router.post("/admin/billing/invoices/{invoice_id}/payment-link")
async def admin_invoice_payment_link(
    invoice_id: str,
    admin=Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    billing = BillingService(session)
    if not is_full_admin(admin):
        allowed = await billing.invoice_in_admin_scope(invoice_id, admin.id)
        if not allowed:
            raise HTTPException(status_code=403, detail="Fatura fora do seu escopo")
    try:
        result = await billing.ensure_payment_link_for_invoice_id(invoice_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await AdminService(session).audit(
        admin.id, "generate_payment_link", "invoice", invoice_id, {"invoice_url": result.get("invoice_url")}
    )
    return result


@router.post("/admin/billing/invoices/{invoice_id}/exempt-band/{band_id}")
async def admin_exempt_band_from_invoice(
    invoice_id: str,
    band_id: str,
    admin=Depends(require_full_admin),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    _ = invoice_id
    await BillingService(session).exempt_band_charges(band_id, "Isenção via admin")
    await AdminService(session).audit(
        admin.id, "exempt_band_invoice", "band", band_id, {"invoice_id": invoice_id}
    )
    return {"status": "ok"}
