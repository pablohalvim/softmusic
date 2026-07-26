from __future__ import annotations

import json
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.email_service import EmailService
from app.domain.billing_calendar import (
    adjust_business_day,
    first_invoice_quote,
    month_period_for_due,
    next_due_anchor,
)
from app.infrastructure.billing.asaas_client import AsaasClient
from app.infrastructure.database.models import (
    PLAN_LIMITS,
    Band,
    BandMember,
    BandStatus,
    BillingAccount,
    Invoice,
    InvoiceKind,
    InvoiceLineItem,
    InvoiceStatus,
    NationalHoliday,
    SystemSetting,
    User,
)
from app.logging import logger

TZ_SP = ZoneInfo("America/Sao_Paulo")
OPEN_STATUSES = {
    InvoiceStatus.AWAITING_PAYMENT.value,
    InvoiceStatus.OVERDUE.value,
}
PLAN_LABELS = {
    "individual": "Individual",
    "band_10": "Banda 10",
    "band_20": "Banda 20",
}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _band_monthly_cents(plan_code: str, member_count: int) -> int:
    base, limit, extra = PLAN_LIMITS[plan_code]
    return base + max(0, member_count - limit) * extra


def _today_sp() -> date:
    return datetime.now(TZ_SP).date()


class BillingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._asaas: AsaasClient | None = None
        self.email = EmailService()

    async def _asaas_client(self) -> AsaasClient:
        if self._asaas is None:
            api_key = await self.get_setting("asaas_api_key")
            environment = await self.get_setting("asaas_environment") or "sandbox"
            self._asaas = AsaasClient(api_key=api_key or None, environment=environment)
        return self._asaas

    async def get_setting(self, key: str) -> str:
        result = await self.session.execute(select(SystemSetting).where(SystemSetting.key == key))
        row = result.scalar_one_or_none()
        if row and row.value:
            return row.value
        from app.config import get_settings

        settings = get_settings()
        if key == "asaas_api_key":
            return settings.asaas_api_key
        if key == "asaas_environment":
            return settings.asaas_environment
        if key == "asaas_webhook_token":
            return settings.asaas_webhook_token
        return ""

    async def set_setting(self, key: str, value: str, admin_id: str | None = None) -> None:
        result = await self.session.execute(select(SystemSetting).where(SystemSetting.key == key))
        row = result.scalar_one_or_none()
        now = datetime.now(UTC)
        if row is None:
            self.session.add(
                SystemSetting(key=key, value=value, updated_at=now, updated_by_admin_id=admin_id)
            )
        else:
            row.value = value
            row.updated_at = now
            row.updated_by_admin_id = admin_id
        await self.session.commit()
        self._asaas = None

    def _public_webhook_url(self) -> str:
        from app.config import get_settings

        settings = get_settings()
        base = (settings.public_api_base_url or "").strip().rstrip("/")
        if not base:
            origin = (settings.web_origin or "").strip().rstrip("/")
            if origin and "localhost" not in origin and "127.0.0.1" not in origin:
                base = f"{origin}/api"
            else:
                base = "http://localhost:8080"
        return f"{base}/webhooks/asaas"

    async def get_asaas_settings(self) -> dict[str, Any]:
        api_key = await self.get_setting("asaas_api_key")
        masked = ""
        if api_key:
            masked = api_key[:6] + "…" + api_key[-4:] if len(api_key) > 12 else "••••"
        return {
            "asaas_api_key_masked": masked,
            "asaas_api_key_configured": bool(api_key),
            "asaas_environment": await self.get_setting("asaas_environment") or "sandbox",
            "asaas_webhook_token_configured": bool(await self.get_setting("asaas_webhook_token")),
            "asaas_webhook_url": self._public_webhook_url(),
        }

    async def holiday_dates(self, year: int | None = None) -> set[date]:
        stmt = select(NationalHoliday.holiday_date)
        if year is not None:
            stmt = stmt.where(
                NationalHoliday.holiday_date >= date(year, 1, 1),
                NationalHoliday.holiday_date <= date(year, 12, 31),
            )
        result = await self.session.execute(stmt)
        return set(result.scalars().all())

    async def create_first_invoice_for_band(
        self,
        band: Band,
        *,
        with_trial: bool,
        today: date | None = None,
    ) -> Invoice:
        """Gera fatura local (sem Asaas) para a banda."""
        if band.billing_exempt:
            raise ValueError("Banda isenta não gera fatura")
        today = today or _today_sp()
        member_count = await self._member_count(band.id)
        monthly = _band_monthly_cents(band.plan_code, member_count)
        holidays = await self.holiday_dates(today.year)
        holidays |= await self.holiday_dates(today.year + 1)

        amount, due, period_start, period_end = first_invoice_quote(
            today,
            monthly,
            holiday_dates=holidays,
            trial_due_offset_days=2 if with_trial else 2,
        )
        # Segunda banda sem free: vencimento ainda today+2 (ou dia 10 se <4 dias),
        # mas sem trial na banda.
        if not with_trial and amount == monthly:
            due = adjust_business_day(next_due_anchor(today), holidays)

        invoice = Invoice(
            id=_new_id("inv"),
            billing_account_id=band.billing_account_id,
            invoice_kind=InvoiceKind.FIRST.value,
            invoice_number=await self._next_invoice_number(),
            total_amount_cents=amount,
            status=InvoiceStatus.AWAITING_PAYMENT.value,
            due_date=due,
            period_start=period_start,
            period_end=period_end,
        )
        self.session.add(invoice)
        await self.session.flush()
        await self._add_band_line_items(invoice, band, member_count, amount, monthly)
        await self.session.commit()
        await self.session.refresh(invoice)
        return invoice

    async def refresh_first_invoice(self, owner_user_id: str, invoice_id: str) -> dict[str, Any]:
        invoice = await self._get_owner_invoice(owner_user_id, invoice_id)
        if invoice.invoice_kind != InvoiceKind.FIRST.value:
            raise ValueError("Apenas a 1ª fatura pode ser atualizada")
        if invoice.status not in OPEN_STATUSES:
            raise ValueError("Fatura não está aberta")
        if invoice.due_date >= _today_sp() and invoice.status != InvoiceStatus.OVERDUE.value:
            raise ValueError("Fatura ainda não está vencida")

        if invoice.asaas_payment_id:
            asaas = await self._asaas_client()
            try:
                await asaas.delete_payment(invoice.asaas_payment_id)
            except Exception as exc:
                logger.warning("asaas_cancel_failed", payment_id=invoice.asaas_payment_id, error=str(exc))
            invoice.asaas_payment_id = None
            invoice.invoice_url = None
            invoice.asaas_payload_json = None
            invoice.pix_qr_payload = None

        band_ids = await self._band_ids_on_invoice(invoice.id)
        if not band_ids:
            raise ValueError("Fatura sem bandas")
        band = await self._get_band(band_ids[0])
        if band is None:
            raise ValueError("Banda não encontrada")

        today = _today_sp()
        member_count = await self._member_count(band.id)
        monthly = _band_monthly_cents(band.plan_code, member_count)
        holidays = await self.holiday_dates(today.year)
        holidays |= await self.holiday_dates(today.year + 1)
        amount, _due, period_start, period_end = first_invoice_quote(
            today, monthly, holiday_dates=holidays, trial_due_offset_days=0
        )
        invoice.total_amount_cents = amount
        invoice.due_date = today
        invoice.period_start = period_start
        invoice.period_end = period_end
        invoice.status = InvoiceStatus.AWAITING_PAYMENT.value

        await self._clear_line_items(invoice.id)
        await self._add_band_line_items(invoice, band, member_count, amount, monthly)
        await self.session.commit()
        return await self._serialize_invoice(invoice)

    async def pay_invoice(self, owner_user_id: str, invoice_id: str) -> dict[str, Any]:
        """Cria cobrança no Asaas sob demanda e retorna URL para redirecionar."""
        invoice = await self._get_owner_invoice(owner_user_id, invoice_id)
        return await self.ensure_payment_link(invoice)

    async def ensure_payment_link_for_invoice_id(self, invoice_id: str) -> dict[str, Any]:
        result = await self.session.execute(select(Invoice).where(Invoice.id == invoice_id))
        invoice = result.scalar_one_or_none()
        if invoice is None:
            raise ValueError("Fatura não encontrada")
        return await self.ensure_payment_link(invoice)

    async def ensure_payment_link(self, invoice: Invoice) -> dict[str, Any]:
        """Cria (ou reutiliza) cobrança Asaas e devolve invoice_url."""
        if invoice.status not in OPEN_STATUSES:
            raise ValueError("Fatura não está disponível para pagamento")
        if invoice.total_amount_cents <= 0:
            raise ValueError("Fatura sem valor")

        if invoice.invoice_kind == InvoiceKind.FIRST.value and invoice.due_date < _today_sp():
            raise ValueError("Fatura vencida. Atualize a fatura antes de pagar.")

        account = await self._get_account(invoice.billing_account_id)
        if account is None:
            raise ValueError("Conta de billing não encontrada")
        user = await self._get_user(account.owner_user_id)
        if user is None:
            raise ValueError("Usuário não encontrado")

        asaas = await self._asaas_client()
        customer_id = user.asaas_customer_id or account.asaas_customer_id
        if not customer_id:
            customer = await asaas.create_customer(
                {
                    "name": user.full_name,
                    "email": user.email,
                    "cpfCnpj": user.cpf,
                    "mobilePhone": "".join(ch for ch in user.phone if ch.isdigit())[-11:],
                    "postalCode": user.address_zip,
                    "address": user.address_street,
                    "addressNumber": user.address_number,
                    "complement": user.address_complement or "",
                    "province": user.address_neighborhood,
                    "city": user.address_city,
                    "state": user.address_state,
                }
            )
            customer_id = str(customer.get("id", ""))
            user.asaas_customer_id = customer_id
            account.asaas_customer_id = customer_id
            await self.session.flush()

        if invoice.asaas_payment_id and invoice.invoice_url:
            return {
                "invoice_id": invoice.id,
                "invoice_url": invoice.invoice_url,
                "asaas_payment_id": invoice.asaas_payment_id,
                "redirect": True,
            }

        value = round(invoice.total_amount_cents / 100, 2)
        payment = await asaas.create_payment(
            {
                "customer": customer_id,
                "billingType": "UNDEFINED",
                "value": value,
                "dueDate": invoice.due_date.isoformat(),
                "description": f"SoftMusic — fatura #{invoice.invoice_number or invoice.id}",
                "externalReference": invoice.id,
            }
        )
        invoice.asaas_payment_id = str(payment.get("id", ""))
        invoice.invoice_url = payment.get("invoiceUrl") or payment.get("bankSlipUrl")
        invoice.payment_method = str(payment.get("billingType", "undefined")).lower()
        invoice.asaas_payload_json = json.dumps(payment, default=str)
        await self.session.commit()
        return {
            "invoice_id": invoice.id,
            "invoice_url": invoice.invoice_url,
            "asaas_payment_id": invoice.asaas_payment_id,
            "redirect": True,
        }

    async def list_invoices(self, owner_user_id: str) -> list[dict[str, Any]]:
        account = await self._account_for_owner(owner_user_id)
        if account is None:
            return []
        await self._mark_overdue_for_account(account.id)
        result = await self.session.execute(
            select(Invoice)
            .where(Invoice.billing_account_id == account.id)
            .order_by(Invoice.due_date.desc(), Invoice.created_at.desc())
        )
        return [await self._serialize_invoice(inv) for inv in result.scalars().all()]

    async def list_all_invoices_admin(
        self,
        *,
        registered_by_admin_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if registered_by_admin_id:
            # Faturas que tocam bandas cadastradas pelo vendedor OU owner cadastrado por ele.
            band_ids_result = await self.session.execute(
                select(Band.id).where(Band.registered_by_admin_id == registered_by_admin_id)
            )
            band_ids = [row[0] for row in band_ids_result.all()]
            owner_ids_result = await self.session.execute(
                select(User.id).where(User.registered_by_admin_id == registered_by_admin_id)
            )
            owner_ids = [row[0] for row in owner_ids_result.all()]
            account_ids: list[str] = []
            if owner_ids:
                accounts = await self.session.execute(
                    select(BillingAccount.id).where(BillingAccount.owner_user_id.in_(owner_ids))
                )
                account_ids = [row[0] for row in accounts.all()]

            invoice_ids: set[str] = set()
            if band_ids:
                lines = await self.session.execute(
                    select(InvoiceLineItem.invoice_id).where(InvoiceLineItem.band_id.in_(band_ids))
                )
                invoice_ids.update(row[0] for row in lines.all())
            if account_ids:
                by_account = await self.session.execute(
                    select(Invoice.id).where(Invoice.billing_account_id.in_(account_ids))
                )
                invoice_ids.update(row[0] for row in by_account.all())

            if not invoice_ids:
                return []
            result = await self.session.execute(
                select(Invoice)
                .where(Invoice.id.in_(list(invoice_ids)))
                .order_by(Invoice.due_date.desc(), Invoice.created_at.desc())
                .limit(500)
            )
        else:
            result = await self.session.execute(
                select(Invoice).order_by(Invoice.due_date.desc(), Invoice.created_at.desc()).limit(500)
            )

        items = []
        for inv in result.scalars().all():
            data = await self._serialize_invoice(inv)
            account = await self._get_account(inv.billing_account_id)
            owner = await self._get_user(account.owner_user_id) if account else None
            data["owner_email"] = owner.email if owner else None
            data["owner_name"] = owner.full_name if owner else None
            data["is_delinquent"] = inv.status == InvoiceStatus.OVERDUE.value
            items.append(data)
        return items

    async def invoice_in_admin_scope(self, invoice_id: str, admin_id: str) -> bool:
        items = await self.list_all_invoices_admin(registered_by_admin_id=admin_id)
        return any(item["id"] == invoice_id for item in items)

    async def get_invoice_details(self, owner_user_id: str, invoice_id: str) -> dict[str, Any]:
        invoice = await self._get_owner_invoice(owner_user_id, invoice_id)
        return await self._serialize_invoice(invoice, detailed=True)

    async def get_billing_status(self, owner_user_id: str) -> dict[str, Any]:
        account = await self._account_for_owner(owner_user_id)
        if account is None:
            return {"status": "none", "monthly_total_cents": 0, "bands": [], "blocked_bands": []}
        bands = await self._bands_for_account(account.id)
        band_items = []
        total_cents = 0
        blocked = []
        for band in bands:
            if band.billing_exempt:
                continue
            count = await self._member_count(band.id)
            amount = _band_monthly_cents(band.plan_code, count)
            total_cents += amount
            band_items.append(
                {
                    "id": band.id,
                    "name": band.name,
                    "plan_code": band.plan_code,
                    "status": band.status,
                    "member_count": count,
                    "monthly_amount_cents": amount,
                }
            )
            if band.status == BandStatus.SUSPENDED.value:
                blocked.append({"id": band.id, "name": band.name})
        return {
            "status": account.status,
            "monthly_total_cents": total_cents,
            "grace_period_ends_at": account.grace_period_ends_at.isoformat()
            if account.grace_period_ends_at
            else None,
            "bands": band_items,
            "blocked_bands": blocked,
        }

    async def exempt_band_charges(self, band_id: str, reason: str | None = None) -> None:
        """Isenta a banda e remove suas cobranças de faturas abertas."""
        band = await self._get_band(band_id)
        if band is None:
            raise ValueError("Banda não encontrada")
        band.billing_exempt = True
        band.exempt_reason = reason
        if band.status in {
            BandStatus.PENDING_PAYMENT.value,
            BandStatus.PAST_DUE.value,
            BandStatus.SUSPENDED.value,
            BandStatus.TRIAL.value,
        }:
            band.status = BandStatus.ACTIVE.value

        result = await self.session.execute(
            select(Invoice).where(
                Invoice.billing_account_id == band.billing_account_id,
                Invoice.status.in_(list(OPEN_STATUSES)),
            )
        )
        asaas = await self._asaas_client()
        for invoice in result.scalars().all():
            lines = await self.session.execute(
                select(InvoiceLineItem).where(
                    InvoiceLineItem.invoice_id == invoice.id,
                    InvoiceLineItem.band_id == band_id,
                )
            )
            removed = 0
            for line in lines.scalars().all():
                removed += line.amount_cents
                await self.session.delete(line)
            if removed <= 0:
                continue
            invoice.total_amount_cents = max(0, invoice.total_amount_cents - removed)
            remaining = await self.session.execute(
                select(func.count())
                .select_from(InvoiceLineItem)
                .where(InvoiceLineItem.invoice_id == invoice.id)
            )
            if int(remaining.scalar_one()) == 0 or invoice.total_amount_cents == 0:
                if invoice.asaas_payment_id:
                    try:
                        await asaas.delete_payment(invoice.asaas_payment_id)
                    except Exception as exc:
                        logger.warning("asaas_cancel_failed", error=str(exc))
                invoice.status = InvoiceStatus.CANCELLED.value
                invoice.asaas_payment_id = None
                invoice.invoice_url = None
        await self.session.commit()

    async def handle_payment_confirmed(self, payment: dict[str, Any]) -> None:
        payment_id = str(payment.get("id", ""))
        external = payment.get("externalReference")
        invoice: Invoice | None = None
        if external:
            result = await self.session.execute(select(Invoice).where(Invoice.id == str(external)))
            invoice = result.scalar_one_or_none()
        if invoice is None and payment_id:
            result = await self.session.execute(
                select(Invoice).where(Invoice.asaas_payment_id == payment_id)
            )
            invoice = result.scalar_one_or_none()
        if invoice is None:
            return

        invoice.status = InvoiceStatus.PAID.value
        invoice.paid_at = datetime.now(UTC)
        invoice.payment_method = str(payment.get("billingType", invoice.payment_method or "")).lower()
        invoice.invoice_url = payment.get("invoiceUrl") or invoice.invoice_url
        invoice.asaas_payload_json = json.dumps(payment, default=str)

        account = await self._get_account(invoice.billing_account_id)
        if account:
            account.status = "active"
            account.grace_period_ends_at = None
            band_ids = await self._band_ids_on_invoice(invoice.id)
            for band_id in band_ids:
                band = await self._get_band(band_id)
                if band and not band.billing_exempt:
                    band.status = BandStatus.ACTIVE.value
                    band.trial_ends_at = None
        await self.session.commit()

    async def handle_payment_overdue(self, payment: dict[str, Any]) -> None:
        payment_id = str(payment.get("id", ""))
        external = payment.get("externalReference")
        invoice: Invoice | None = None
        if external:
            result = await self.session.execute(select(Invoice).where(Invoice.id == str(external)))
            invoice = result.scalar_one_or_none()
        if invoice is None and payment_id:
            result = await self.session.execute(
                select(Invoice).where(Invoice.asaas_payment_id == payment_id)
            )
            invoice = result.scalar_one_or_none()
        if invoice is None:
            return
        if invoice.status == InvoiceStatus.PAID.value:
            return
        invoice.status = InvoiceStatus.OVERDUE.value
        await self.session.commit()

    async def handle_payment_refunded(self, payment: dict[str, Any]) -> None:
        payment_id = str(payment.get("id", ""))
        result = await self.session.execute(
            select(Invoice).where(Invoice.asaas_payment_id == payment_id)
        )
        invoice = result.scalar_one_or_none()
        if invoice is None:
            return
        invoice.status = InvoiceStatus.REFUNDED.value
        await self.session.commit()

    async def run_daily_billing_robot(self) -> dict[str, int]:
        today = _today_sp()
        stats = {
            "recurrence_created": 0,
            "bands_blocked": 0,
            "links_cancelled": 0,
            "emails_due_soon": 0,
            "emails_overdue_warning": 0,
            "emails_available": 0,
            "emails_blocked": 0,
        }
        await self._mark_all_overdue()

        if today.day == 5:
            created, emails = await self._generate_recurrence_invoices(today)
            stats["recurrence_created"] = created
            stats["emails_available"] = emails

        if today.day == 15:
            blocked, emails = await self._block_unpaid_recurrence(today)
            stats["bands_blocked"] = blocked
            stats["emails_blocked"] = emails

        stats["links_cancelled"] = await self._cancel_stale_first_invoice_links(today)
        stats["emails_due_soon"] = await self._email_due_tomorrow(today)
        stats["emails_overdue_warning"] = await self._email_overdue_plus_2(today)
        return stats

    # Mantido por compatibilidade com endpoint/admin antigo.
    async def suspend_overdue_accounts(self) -> int:
        result = await self.run_daily_billing_robot()
        return int(result.get("bands_blocked", 0))

    async def sync_subscription(self, billing_account_id: str) -> int:
        """Calcula total mensal local (sem criar assinatura Asaas)."""
        bands = await self._bands_for_account(billing_account_id)
        total = 0
        for band in bands:
            if band.billing_exempt:
                continue
            total += _band_monthly_cents(band.plan_code, await self._member_count(band.id))
        return total

    async def create_checkout(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        raise ValueError("Use o botão Pagar na fatura. Checkout legado desativado.")

    # --- robot helpers ---

    async def _generate_recurrence_invoices(self, today: date) -> tuple[int, int]:
        holidays = await self.holiday_dates(today.year)
        holidays |= await self.holiday_dates(today.year + 1)
        due = adjust_business_day(date(today.year, today.month, 10), holidays)
        period_start, period_end = month_period_for_due(due)

        accounts = await self.session.execute(select(BillingAccount))
        created = 0
        emails = 0
        for account in accounts.scalars().all():
            paid_first = await self.session.execute(
                select(func.count())
                .select_from(Invoice)
                .where(
                    Invoice.billing_account_id == account.id,
                    Invoice.invoice_kind == InvoiceKind.FIRST.value,
                    Invoice.status == InvoiceStatus.PAID.value,
                )
            )
            if int(paid_first.scalar_one()) == 0:
                continue

            existing = await self.session.execute(
                select(Invoice).where(
                    Invoice.billing_account_id == account.id,
                    Invoice.invoice_kind == InvoiceKind.RECURRENCE.value,
                    Invoice.period_start == period_start,
                    Invoice.status != InvoiceStatus.CANCELLED.value,
                )
            )
            if existing.scalar_one_or_none():
                continue

            bands = await self._bands_for_account(account.id)
            billable = [
                b
                for b in bands
                if not b.billing_exempt
                and b.status
                in {
                    BandStatus.ACTIVE.value,
                    BandStatus.PAST_DUE.value,
                    BandStatus.PENDING_PAYMENT.value,
                }
            ]
            # Inclui bandas com 1ª fatura paga
            eligible: list[Band] = []
            for band in billable:
                if await self._band_has_paid_first(band.id):
                    eligible.append(band)
            if not eligible:
                continue

            invoice = Invoice(
                id=_new_id("inv"),
                billing_account_id=account.id,
                invoice_kind=InvoiceKind.RECURRENCE.value,
                invoice_number=await self._next_invoice_number(),
                total_amount_cents=0,
                status=InvoiceStatus.AWAITING_PAYMENT.value,
                due_date=due,
                period_start=period_start,
                period_end=period_end,
            )
            self.session.add(invoice)
            await self.session.flush()
            total = 0
            for band in eligible:
                count = await self._member_count(band.id)
                monthly = _band_monthly_cents(band.plan_code, count)
                await self._add_band_line_items(invoice, band, count, monthly, monthly)
                total += monthly
            invoice.total_amount_cents = total
            created += 1

            owner = await self._get_user(account.owner_user_id)
            if owner and self.email.invoice_available(owner.email, due, total):
                emails += 1

        await self.session.commit()
        return created, emails

    async def _block_unpaid_recurrence(self, today: date) -> tuple[int, int]:
        period_start = date(today.year, today.month, 1)
        result = await self.session.execute(
            select(Invoice).where(
                Invoice.invoice_kind == InvoiceKind.RECURRENCE.value,
                Invoice.period_start == period_start,
                Invoice.status.in_(list(OPEN_STATUSES)),
            )
        )
        blocked = 0
        emails = 0
        notified_owners: set[str] = set()
        for invoice in result.scalars().all():
            band_ids = await self._band_ids_on_invoice(invoice.id)
            names: list[str] = []
            for band_id in band_ids:
                band = await self._get_band(band_id)
                if band and not band.billing_exempt and band.status != BandStatus.SUSPENDED.value:
                    band.status = BandStatus.SUSPENDED.value
                    blocked += 1
                    names.append(band.name)
            account = await self._get_account(invoice.billing_account_id)
            if account and account.owner_user_id not in notified_owners and names:
                owner = await self._get_user(account.owner_user_id)
                if owner and self.email.bands_blocked(owner.email, names):
                    emails += 1
                notified_owners.add(account.owner_user_id)
                account.status = "suspended"
        await self.session.commit()
        return blocked, emails

    async def _cancel_stale_first_invoice_links(self, today: date) -> int:
        cutoff = today - timedelta(days=3)
        result = await self.session.execute(
            select(Invoice).where(
                Invoice.invoice_kind == InvoiceKind.FIRST.value,
                Invoice.status.in_(list(OPEN_STATUSES)),
                Invoice.due_date < cutoff,
                Invoice.asaas_payment_id.is_not(None),
            )
        )
        asaas = await self._asaas_client()
        count = 0
        for invoice in result.scalars().all():
            try:
                await asaas.delete_payment(invoice.asaas_payment_id or "")
            except Exception as exc:
                logger.warning("asaas_cancel_failed", payment_id=invoice.asaas_payment_id, error=str(exc))
            invoice.asaas_payment_id = None
            invoice.invoice_url = None
            invoice.asaas_payload_json = None
            count += 1
        await self.session.commit()
        return count

    async def _email_due_tomorrow(self, today: date) -> int:
        tomorrow = today + timedelta(days=1)
        result = await self.session.execute(
            select(Invoice).where(
                Invoice.invoice_kind == InvoiceKind.RECURRENCE.value,
                Invoice.status.in_(list(OPEN_STATUSES)),
                Invoice.due_date == tomorrow,
                Invoice.reminder_due_soon_sent_at.is_(None),
            )
        )
        sent = 0
        for invoice in result.scalars().all():
            account = await self._get_account(invoice.billing_account_id)
            owner = await self._get_user(account.owner_user_id) if account else None
            if owner and self.email.invoice_due_tomorrow(owner.email, invoice.due_date, invoice.total_amount_cents):
                invoice.reminder_due_soon_sent_at = datetime.now(UTC)
                sent += 1
        await self.session.commit()
        return sent

    async def _email_overdue_plus_2(self, today: date) -> int:
        target = today - timedelta(days=2)
        result = await self.session.execute(
            select(Invoice).where(
                Invoice.invoice_kind == InvoiceKind.RECURRENCE.value,
                Invoice.status.in_(list(OPEN_STATUSES)),
                Invoice.due_date == target,
                Invoice.reminder_overdue_sent_at.is_(None),
            )
        )
        sent = 0
        for invoice in result.scalars().all():
            account = await self._get_account(invoice.billing_account_id)
            owner = await self._get_user(account.owner_user_id) if account else None
            if owner and self.email.invoice_payment_missing(owner.email):
                invoice.reminder_overdue_sent_at = datetime.now(UTC)
                sent += 1
        await self.session.commit()
        return sent

    # --- helpers ---

    async def _add_band_line_items(
        self,
        invoice: Invoice,
        band: Band,
        member_count: int,
        charged_cents: int,
        full_monthly_cents: int,
    ) -> None:
        base, limit, extra = PLAN_LIMITS[band.plan_code]
        extras = max(0, member_count - limit)
        extras_cents = extras * extra
        # Pró-rata: aplica proporção charged/full no base e extras
        ratio = (charged_cents / full_monthly_cents) if full_monthly_cents > 0 else 1.0
        base_charged = int(round(base * ratio))
        extras_charged = max(0, charged_cents - base_charged) if extras else 0
        if extras and extras_charged == 0 and charged_cents > base_charged:
            extras_charged = charged_cents - base_charged
        if not extras:
            base_charged = charged_cents

        plan_name = PLAN_LABELS.get(band.plan_code, band.plan_code)
        self.session.add(
            InvoiceLineItem(
                id=_new_id("ili"),
                invoice_id=invoice.id,
                band_id=band.id,
                description=f"{band.name} — Plano {plan_name}",
                amount_cents=base_charged,
                plan_code=band.plan_code,
                item_kind="plan_base",
                quantity=1,
                unit_amount_cents=base_charged,
            )
        )
        if extras > 0:
            unit = int(round(extras_charged / extras)) if extras else 0
            self.session.add(
                InvoiceLineItem(
                    id=_new_id("ili"),
                    invoice_id=invoice.id,
                    band_id=band.id,
                    description=f"{band.name} — Usuários adicionais ({extras})",
                    amount_cents=extras_charged,
                    plan_code=band.plan_code,
                    item_kind="extra_member",
                    quantity=extras,
                    unit_amount_cents=unit,
                )
            )

    async def _clear_line_items(self, invoice_id: str) -> None:
        result = await self.session.execute(
            select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice_id)
        )
        for line in result.scalars().all():
            await self.session.delete(line)
        await self.session.flush()

    async def _serialize_invoice(self, invoice: Invoice, detailed: bool = False) -> dict[str, Any]:
        lines_result = await self.session.execute(
            select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id)
        )
        lines = []
        for line in lines_result.scalars().all():
            item = {
                "id": line.id,
                "band_id": line.band_id,
                "description": line.description,
                "amount_cents": line.amount_cents,
                "plan_code": line.plan_code,
                "item_kind": line.item_kind,
                "quantity": line.quantity,
                "unit_amount_cents": line.unit_amount_cents,
            }
            if detailed:
                band = await self._get_band(line.band_id)
                item["band_name"] = band.name if band else None
                item["plan_label"] = PLAN_LABELS.get(line.plan_code or "", line.plan_code)
            lines.append(item)

        can_pay = invoice.status in OPEN_STATUSES and invoice.total_amount_cents > 0
        needs_refresh = (
            invoice.invoice_kind == InvoiceKind.FIRST.value
            and invoice.status in OPEN_STATUSES
            and invoice.due_date < _today_sp()
        )
        return {
            "id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "invoice_kind": invoice.invoice_kind,
            "total_amount_cents": invoice.total_amount_cents,
            "status": invoice.status,
            "due_date": invoice.due_date.isoformat(),
            "paid_at": invoice.paid_at.isoformat() if invoice.paid_at else None,
            "payment_method": invoice.payment_method,
            "invoice_url": invoice.invoice_url,
            "period_start": invoice.period_start.isoformat(),
            "period_end": invoice.period_end.isoformat(),
            "line_items": lines,
            "can_pay": can_pay and not needs_refresh,
            "can_refresh": needs_refresh,
            "has_asaas_link": bool(invoice.invoice_url),
        }

    async def _next_invoice_number(self) -> int:
        result = await self.session.execute(select(func.max(Invoice.invoice_number)))
        current = result.scalar_one()
        return int(current or 0) + 1

    async def _mark_overdue_for_account(self, billing_account_id: str) -> None:
        today = _today_sp()
        result = await self.session.execute(
            select(Invoice).where(
                Invoice.billing_account_id == billing_account_id,
                Invoice.status == InvoiceStatus.AWAITING_PAYMENT.value,
                Invoice.due_date < today,
            )
        )
        changed = False
        for invoice in result.scalars().all():
            invoice.status = InvoiceStatus.OVERDUE.value
            changed = True
        if changed:
            await self.session.commit()

    async def _mark_all_overdue(self) -> None:
        today = _today_sp()
        result = await self.session.execute(
            select(Invoice).where(
                Invoice.status == InvoiceStatus.AWAITING_PAYMENT.value,
                Invoice.due_date < today,
            )
        )
        for invoice in result.scalars().all():
            invoice.status = InvoiceStatus.OVERDUE.value
        await self.session.commit()

    async def _band_has_paid_first(self, band_id: str) -> bool:
        result = await self.session.execute(
            select(Invoice)
            .join(InvoiceLineItem, InvoiceLineItem.invoice_id == Invoice.id)
            .where(
                InvoiceLineItem.band_id == band_id,
                Invoice.invoice_kind == InvoiceKind.FIRST.value,
                Invoice.status == InvoiceStatus.PAID.value,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def _band_ids_on_invoice(self, invoice_id: str) -> list[str]:
        result = await self.session.execute(
            select(InvoiceLineItem.band_id).where(InvoiceLineItem.invoice_id == invoice_id).distinct()
        )
        return list(result.scalars().all())

    async def _get_owner_invoice(self, owner_user_id: str, invoice_id: str) -> Invoice:
        account = await self._account_for_owner(owner_user_id)
        if account is None:
            raise ValueError("Conta de billing não encontrada")
        result = await self.session.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.billing_account_id == account.id)
        )
        invoice = result.scalar_one_or_none()
        if invoice is None:
            raise ValueError("Fatura não encontrada")
        return invoice

    async def _get_account(self, billing_account_id: str) -> BillingAccount | None:
        result = await self.session.execute(
            select(BillingAccount).where(BillingAccount.id == billing_account_id)
        )
        return result.scalar_one_or_none()

    async def _account_for_owner(self, owner_user_id: str) -> BillingAccount | None:
        result = await self.session.execute(
            select(BillingAccount).where(BillingAccount.owner_user_id == owner_user_id)
        )
        return result.scalar_one_or_none()

    async def _bands_for_account(self, billing_account_id: str) -> list[Band]:
        result = await self.session.execute(
            select(Band).where(Band.billing_account_id == billing_account_id)
        )
        return list(result.scalars().all())

    async def _member_count(self, band_id: str) -> int:
        result = await self.session.execute(
            select(func.count())
            .select_from(BandMember)
            .where(BandMember.band_id == band_id, BandMember.status == "active")
        )
        return int(result.scalar_one())

    async def _get_user(self, user_id: str) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def _get_band(self, band_id: str) -> Band | None:
        result = await self.session.execute(select(Band).where(Band.id == band_id))
        return result.scalar_one_or_none()
