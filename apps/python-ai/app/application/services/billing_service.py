from __future__ import annotations

import json
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.billing.asaas_client import AsaasClient
from app.infrastructure.database.models import (
    Band,
    BandMember,
    BandStatus,
    BillingAccount,
    BillingSubscriptionItem,
    Invoice,
    InvoiceLineItem,
    PLAN_LIMITS,
    User,
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _band_monthly_cents(plan_code: str, member_count: int) -> int:
    base, limit, extra = PLAN_LIMITS[plan_code]
    return base + max(0, member_count - limit) * extra


class BillingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.asaas = AsaasClient()

    async def sync_subscription(self, billing_account_id: str) -> int:
        account = await self._get_account(billing_account_id)
        if account is None:
            raise ValueError("Conta de billing não encontrada")

        bands = await self._bands_for_account(billing_account_id)
        total_cents = 0
        for band in bands:
            if band.billing_exempt:
                continue
            count = await self._member_count(band.id)
            amount = _band_monthly_cents(band.plan_code, count)
            total_cents += amount
            await self._upsert_subscription_item(billing_account_id, band, count, amount)

        if total_cents == 0 and any(b.billing_exempt for b in bands):
            account.status = "active"
            for band in bands:
                if band.billing_exempt:
                    band.status = BandStatus.ACTIVE.value
            await self.session.commit()
            return 0

        user = await self._get_user(account.owner_user_id)
        if user and not account.asaas_customer_id:
            customer = await self.asaas.create_customer(
                {
                    "name": user.full_name,
                    "email": user.email,
                    "cpfCnpj": user.cpf,
                    "mobilePhone": user.phone,
                }
            )
            account.asaas_customer_id = customer.get("id")

        if account.asaas_customer_id:
            value = round(total_cents / 100, 2)
            if account.asaas_subscription_id:
                await self.asaas.update_subscription(
                    account.asaas_subscription_id,
                    {"value": value, "description": "SoftMusic — assinaturas consolidadas"},
                )
            else:
                sub = await self.asaas.create_subscription(
                    {
                        "customer": account.asaas_customer_id,
                        "billingType": "UNDEFINED",
                        "value": value,
                        "cycle": "MONTHLY",
                        "description": "SoftMusic — assinaturas consolidadas",
                    }
                )
                account.asaas_subscription_id = sub.get("id")

        account.status = "active" if total_cents > 0 else account.status
        await self.session.commit()
        return total_cents

    async def list_invoices(self, owner_user_id: str) -> list[dict[str, Any]]:
        account = await self._account_for_owner(owner_user_id)
        if account is None:
            return []
        result = await self.session.execute(
            select(Invoice)
            .where(Invoice.billing_account_id == account.id)
            .order_by(Invoice.due_date.desc())
        )
        invoices = []
        for invoice in result.scalars().all():
            lines_result = await self.session.execute(
                select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id)
            )
            lines = [
                {
                    "band_id": line.band_id,
                    "description": line.description,
                    "amount_cents": line.amount_cents,
                }
                for line in lines_result.scalars().all()
            ]
            invoices.append(
                {
                    "id": invoice.id,
                    "total_amount_cents": invoice.total_amount_cents,
                    "status": invoice.status,
                    "due_date": invoice.due_date.isoformat(),
                    "paid_at": invoice.paid_at.isoformat() if invoice.paid_at else None,
                    "payment_method": invoice.payment_method,
                    "invoice_url": invoice.invoice_url,
                    "pix": self._parse_pix_payload(invoice.pix_qr_payload),
                    "line_items": lines,
                }
            )
        return invoices

    async def get_billing_status(self, owner_user_id: str) -> dict[str, Any]:
        account = await self._account_for_owner(owner_user_id)
        if account is None:
            return {"status": "none", "monthly_total_cents": 0, "bands": []}
        bands = await self._bands_for_account(account.id)
        band_items = []
        total_cents = 0
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
        pending_invoice = await self._latest_pending_invoice(account.id)
        return {
            "status": account.status,
            "monthly_total_cents": total_cents,
            "grace_period_ends_at": account.grace_period_ends_at.isoformat()
            if account.grace_period_ends_at
            else None,
            "bands": band_items,
            "pending_invoice_id": pending_invoice.id if pending_invoice else None,
        }

    async def create_checkout(
        self,
        owner_user_id: str,
        payment_method: str,
        credit_card: dict[str, Any] | None = None,
        holder_info: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        account = await self._account_for_owner(owner_user_id)
        if account is None:
            raise ValueError("Conta de billing não encontrada")

        user = await self._get_user(owner_user_id)
        if user is None:
            raise ValueError("Usuário não encontrado")

        total_cents = await self.sync_subscription(account.id)
        if total_cents <= 0:
            raise ValueError("Nenhum valor a cobrar no momento")

        if not account.asaas_customer_id:
            customer = await self.asaas.create_customer(
                {
                    "name": user.full_name,
                    "email": user.email,
                    "cpfCnpj": user.cpf,
                    "mobilePhone": user.phone,
                }
            )
            account.asaas_customer_id = customer.get("id")
            await self.session.commit()

        pending = await self._latest_pending_invoice(account.id)
        if pending and pending.asaas_payment_id:
            existing_payment = await self.asaas.get_payment(pending.asaas_payment_id)
            if existing_payment.get("status") in {"PENDING", "OVERDUE"}:
                return await self._checkout_response(pending, payment_method, existing_payment)

        due = (date.today() + timedelta(days=3)).isoformat()
        value = round(total_cents / 100, 2)
        billing_type = "PIX" if payment_method == "pix" else "CREDIT_CARD"
        payload: dict[str, Any] = {
            "customer": account.asaas_customer_id,
            "billingType": billing_type,
            "value": value,
            "dueDate": due,
            "description": "SoftMusic — assinatura mensal",
        }
        if billing_type == "CREDIT_CARD":
            if not credit_card or not holder_info:
                raise ValueError("Dados do cartão são obrigatórios")
            payload["creditCard"] = {
                "holderName": credit_card["holder_name"],
                "number": credit_card["number"],
                "expiryMonth": credit_card["expiry_month"],
                "expiryYear": credit_card["expiry_year"],
                "ccv": credit_card["ccv"],
            }
            payload["creditCardHolderInfo"] = {
                "name": holder_info.get("name", user.full_name),
                "email": holder_info.get("email", user.email),
                "cpfCnpj": holder_info.get("cpf", user.cpf),
                "postalCode": holder_info.get("postal_code", user.address_zip),
                "addressNumber": holder_info.get("address_number", user.address_number),
                "phone": holder_info.get("phone", user.phone),
            }

        payment = await self.asaas.create_payment(payload)
        invoice = await self._upsert_pending_invoice(account, payment, total_cents)
        await self.session.commit()

        if billing_type == "CREDIT_CARD" and payment.get("status") == "CONFIRMED":
            await self.handle_payment_confirmed(payment)

        return await self._checkout_response(invoice, payment_method, payment)

    async def _checkout_response(
        self,
        invoice: Invoice,
        payment_method: str,
        payment: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        pix_data: dict[str, str | None] = {"qr_image_base64": None, "copy_paste": None}
        if payment_method == "pix":
            payment_id = invoice.asaas_payment_id
            if payment_id:
                qr = await self.asaas.get_pix_qr_code(payment_id)
                pix_data = {
                    "qr_image_base64": qr.get("encodedImage"),
                    "copy_paste": qr.get("payload"),
                }
                invoice.pix_qr_payload = json.dumps(pix_data)
                await self.session.commit()
        return {
            "invoice_id": invoice.id,
            "status": invoice.status,
            "payment_method": payment_method,
            "total_amount_cents": invoice.total_amount_cents,
            "invoice_url": invoice.invoice_url,
            "pix": pix_data if payment_method == "pix" else None,
            "payment_status": (payment or {}).get("status"),
        }

    async def handle_payment_confirmed(self, payment: dict[str, Any]) -> None:
        customer_id = payment.get("customer")
        result = await self.session.execute(
            select(BillingAccount).where(BillingAccount.asaas_customer_id == customer_id)
        )
        account = result.scalar_one_or_none()
        if account is None:
            return
        account.status = "active"
        account.grace_period_ends_at = None
        bands = await self._bands_for_account(account.id)
        for band in bands:
            if band.status in {BandStatus.PENDING_PAYMENT.value, BandStatus.PAST_DUE.value, BandStatus.SUSPENDED.value}:
                band.status = BandStatus.ACTIVE.value
        await self._record_invoice(account, payment)
        await self.session.commit()

    async def handle_payment_overdue(self, payment: dict[str, Any]) -> None:
        customer_id = payment.get("customer")
        result = await self.session.execute(
            select(BillingAccount).where(BillingAccount.asaas_customer_id == customer_id)
        )
        account = result.scalar_one_or_none()
        if account is None:
            return
        account.status = "past_due"
        account.grace_period_ends_at = datetime.now(UTC) + timedelta(days=5)
        bands = await self._bands_for_account(account.id)
        for band in bands:
            if not band.billing_exempt:
                band.status = BandStatus.PAST_DUE.value
        await self.session.commit()

    async def suspend_overdue_accounts(self) -> int:
        now = datetime.now(UTC)
        result = await self.session.execute(
            select(BillingAccount).where(
                BillingAccount.grace_period_ends_at.is_not(None),
                BillingAccount.grace_period_ends_at < now,
                BillingAccount.status == "past_due",
            )
        )
        count = 0
        for account in result.scalars().all():
            account.status = "suspended"
            bands = await self._bands_for_account(account.id)
            for band in bands:
                if not band.billing_exempt:
                    band.status = BandStatus.SUSPENDED.value
            count += 1
        await self.session.commit()
        return count

    async def _record_invoice(self, account: BillingAccount, payment: dict[str, Any]) -> None:
        invoice = Invoice(
            id=_new_id("inv"),
            billing_account_id=account.id,
            asaas_payment_id=str(payment.get("id", "")),
            total_amount_cents=int(float(payment.get("value", 0)) * 100),
            status="paid",
            due_date=date.today(),
            paid_at=datetime.now(UTC),
            payment_method=str(payment.get("billingType", "")).lower(),
            invoice_url=payment.get("invoiceUrl"),
            pix_qr_payload=payment.get("encodedImage"),
            period_start=date.today().replace(day=1),
            period_end=date.today(),
        )
        self.session.add(invoice)

    async def _upsert_subscription_item(
        self, billing_account_id: str, band: Band, member_count: int, amount_cents: int
    ) -> None:
        result = await self.session.execute(
            select(BillingSubscriptionItem).where(BillingSubscriptionItem.band_id == band.id)
        )
        item = result.scalar_one_or_none()
        if item is None:
            item = BillingSubscriptionItem(
                id=_new_id("bsi"),
                billing_account_id=billing_account_id,
                band_id=band.id,
                plan_code=band.plan_code,
                member_count=member_count,
                monthly_amount_cents=amount_cents,
            )
            self.session.add(item)
        else:
            item.member_count = member_count
            item.monthly_amount_cents = amount_cents
            item.plan_code = band.plan_code

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
        from sqlalchemy import func

        result = await self.session.execute(
            select(func.count())
            .select_from(BandMember)
            .where(BandMember.band_id == band_id, BandMember.status == "active")
        )
        return int(result.scalar_one())

    async def _get_user(self, user_id: str) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    def _parse_pix_payload(self, raw: str | None) -> dict[str, str | None] | None:
        if not raw:
            return None
        try:
            data = json.loads(raw)
            return {
                "qr_image_base64": data.get("qr_image_base64") or data.get("encodedImage"),
                "copy_paste": data.get("copy_paste") or data.get("payload"),
            }
        except json.JSONDecodeError:
            return {"qr_image_base64": raw, "copy_paste": None}

    async def _latest_pending_invoice(self, billing_account_id: str) -> Invoice | None:
        result = await self.session.execute(
            select(Invoice)
            .where(
                Invoice.billing_account_id == billing_account_id,
                Invoice.status.in_(["pending", "overdue"]),
            )
            .order_by(Invoice.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _upsert_pending_invoice(
        self, account: BillingAccount, payment: dict[str, Any], total_cents: int
    ) -> Invoice:
        payment_id = str(payment.get("id", ""))
        existing = await self.session.execute(
            select(Invoice).where(Invoice.asaas_payment_id == payment_id)
        )
        invoice = existing.scalar_one_or_none()
        if invoice is None:
            invoice = Invoice(
                id=_new_id("inv"),
                billing_account_id=account.id,
                asaas_payment_id=payment_id,
                total_amount_cents=total_cents,
                status="pending",
                due_date=date.fromisoformat(str(payment.get("dueDate", date.today().isoformat()))),
                payment_method=str(payment.get("billingType", "")).lower(),
                invoice_url=payment.get("invoiceUrl"),
                period_start=date.today().replace(day=1),
                period_end=date.today(),
            )
            self.session.add(invoice)
        else:
            invoice.total_amount_cents = total_cents
            invoice.invoice_url = payment.get("invoiceUrl")
        await self.session.flush()
        return invoice
