from __future__ import annotations

import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

import httpx

from app.application.services.email_templates import (
    google_calendar_url,
    invite_member_email_html,
    invite_member_email_text,
    schedule_occurrence_email_html,
    schedule_occurrence_email_text,
)
from app.config import get_settings
from app.logging import logger

TZ_SP = ZoneInfo("America/Sao_Paulo")


class EmailService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def send(
        self,
        to: str | Sequence[str],
        subject: str,
        body: str,
        *,
        html: str | None = None,
    ) -> bool:
        recipients = self._normalize_recipients(to)
        if not recipients:
            return False
        if self.settings.resend_api_key:
            return self._send_resend(recipients, subject, body, html=html)
        if self.settings.smtp_host:
            return self._send_smtp(recipients, subject, body, html=html)
        logger.info("email_skipped_no_provider", to=recipients, subject=subject)
        return False

    def _normalize_recipients(self, to: str | Sequence[str]) -> list[str]:
        if isinstance(to, str):
            items = [to]
        else:
            items = list(to)
        seen: set[str] = set()
        result: list[str] = []
        for item in items:
            email = (item or "").strip().lower()
            if not email or email in seen:
                continue
            seen.add(email)
            result.append(email)
        return result

    def _send_resend(
        self,
        recipients: list[str],
        subject: str,
        body: str,
        *,
        html: str | None = None,
    ) -> bool:
        payload: dict = {
            "from": self.settings.email_from or "SoftMusic <administrativo@softmusic.com.br>",
            "to": recipients,
            "subject": subject,
            "text": body,
        }
        if html:
            payload["html"] = html
        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {self.settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=30.0,
            )
            if response.is_success:
                return True
            logger.warning(
                "resend_send_failed",
                to=recipients,
                status=response.status_code,
                error=response.text[:500],
            )
            return False
        except Exception as exc:
            logger.warning("resend_send_failed", to=recipients, error=str(exc))
            return False

    def _send_smtp(
        self,
        recipients: list[str],
        subject: str,
        body: str,
        *,
        html: str | None = None,
    ) -> bool:
        message = EmailMessage()
        message["From"] = self.settings.email_from or "SoftMusic <administrativo@softmusic.com.br>"
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        message.set_content(body)
        if html:
            message.add_alternative(html, subtype="html")

        try:
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port) as server:
                server.starttls()
                if self.settings.smtp_user:
                    server.login(self.settings.smtp_user, self.settings.smtp_password)
                server.send_message(message)
            return True
        except Exception as exc:
            logger.warning("email_send_failed", to=recipients, error=str(exc))
            return False

    def send_bulk(self, recipients: Iterable[str], subject: str, body: str) -> int:
        sent = 0
        for email in recipients:
            if self.send(email, subject, body):
                sent += 1
        return sent

    def invite_member(self, email: str, band_name: str, invite_url: str) -> bool:
        html = invite_member_email_html(
            band_name=band_name,
            invite_url=invite_url,
            web_origin=self.settings.web_origin,
        )
        text = invite_member_email_text(band_name=band_name, invite_url=invite_url)
        return self.send(
            email,
            f"Convite para a banda {band_name} — SoftMusic",
            text,
            html=html,
        )

    def payment_overdue(self, email: str, invoice_url: str | None) -> bool:
        link = invoice_url or f"{self.settings.web_origin}/faturas"
        return self.send(
            email,
            "Fatura SoftMusic em atraso",
            f"Sua assinatura está em atraso. Regularize em: {link}",
        )

    def invoice_available(self, email: str, due_date, amount_cents: int) -> bool:
        link = f"{self.settings.web_origin}/faturas"
        value = f"R$ {amount_cents / 100:.2f}".replace(".", ",")
        due = due_date.strftime("%d/%m/%Y") if hasattr(due_date, "strftime") else str(due_date)
        return self.send(
            email,
            "Nova fatura SoftMusic disponível",
            f"Sua fatura mensal de {value} já está disponível para pagamento.\n"
            f"Vencimento: {due}\n\nAcesse: {link}",
        )

    def invoice_due_tomorrow(self, email: str, due_date, amount_cents: int) -> bool:
        link = f"{self.settings.web_origin}/faturas"
        value = f"R$ {amount_cents / 100:.2f}".replace(".", ",")
        due = due_date.strftime("%d/%m/%Y") if hasattr(due_date, "strftime") else str(due_date)
        return self.send(
            email,
            "Lembrete: fatura SoftMusic vence amanhã",
            f"Sua fatura de {value} vence amanhã ({due}).\n\nPague em: {link}",
        )

    def invoice_payment_missing(self, email: str) -> bool:
        link = f"{self.settings.web_origin}/faturas"
        return self.send(
            email,
            "Pagamento SoftMusic não localizado",
            "Não localizamos o pagamento da sua fatura. "
            "Em 3 dias o acesso às músicas e cifras das bandas será bloqueado.\n\n"
            f"Regularize em: {link}",
        )

    def bands_blocked(self, email: str, band_names: list[str]) -> bool:
        link = f"{self.settings.web_origin}/faturas"
        names = ", ".join(band_names)
        return self.send(
            email,
            "Bandas SoftMusic bloqueadas por falta de pagamento",
            f"As seguintes bandas foram bloqueadas: {names}.\n"
            "Enquanto o pagamento não for efetuado, ninguém associado à banda "
            "conseguirá ver músicas e cifras.\n\n"
            f"Pague em: {link}",
        )

    def schedule_occurrence(
        self,
        *,
        recipients: Sequence[str],
        kind: str,
        band_name: str,
        title: str | None,
        starts_at: datetime,
        ends_at: datetime,
        address: str,
        lat: float,
        lng: float,
    ) -> bool:
        kind_label = "Ensaio" if kind == "rehearsal" else "Evento"
        start_local = starts_at.astimezone(TZ_SP)
        end_local = ends_at.astimezone(TZ_SP)
        date_br = start_local.strftime("%d/%m/%Y")
        when_label = start_local.strftime("%d/%m/%Y às %H:%M")
        ends_label = end_local.strftime("%d/%m/%Y às %H:%M")
        subject = f"{kind_label} {band_name} {date_br}"

        event_title = f"{kind_label} — {band_name}"
        if title:
            event_title = f"{event_title}: {title}"

        details = f"{event_title}\nLocal: {address}\nSoftMusic"
        calendar_url = google_calendar_url(
            title=event_title,
            starts_at_utc_compact=starts_at.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ"),
            ends_at_utc_compact=ends_at.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ"),
            details=details,
            location=address,
        )
        maps_url = f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"

        html = schedule_occurrence_email_html(
            kind_label=kind_label,
            band_name=band_name,
            title=title,
            when_label=when_label,
            ends_label=ends_label,
            address=address,
            maps_url=maps_url,
            calendar_url=calendar_url,
            web_origin=self.settings.web_origin,
        )
        text = schedule_occurrence_email_text(
            kind_label=kind_label,
            band_name=band_name,
            title=title,
            when_label=when_label,
            ends_label=ends_label,
            address=address,
            maps_url=maps_url,
            calendar_url=calendar_url,
        )
        return self.send(recipients, subject, text, html=html)
