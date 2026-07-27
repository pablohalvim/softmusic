from __future__ import annotations

import base64
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

import httpx

from app.application.services.email_templates import (
    invite_member_email_html,
    invite_member_email_text,
    password_reset_code_email_html,
    password_reset_code_email_text,
    schedule_occurrence_email_html,
    schedule_occurrence_email_text,
)
from app.application.services.ics import build_ics
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
        attachments: list[dict[str, str]] | None = None,
    ) -> bool:
        recipients = self._normalize_recipients(to)
        if not recipients:
            return False
        if self.settings.resend_api_key:
            return self._send_resend(
                recipients, subject, body, html=html, attachments=attachments
            )
        if self.settings.smtp_host:
            return self._send_smtp(
                recipients, subject, body, html=html, attachments=attachments
            )
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
        attachments: list[dict[str, str]] | None = None,
    ) -> bool:
        payload: dict = {
            "from": self.settings.email_from or "SoftMusic <administrativo@softmusic.com.br>",
            "to": recipients,
            "subject": subject,
            "text": body,
        }
        if html:
            payload["html"] = html
        if attachments:
            payload["attachments"] = [
                {
                    "filename": item["filename"],
                    "content": base64.b64encode(item["content"].encode("utf-8")).decode("ascii"),
                }
                for item in attachments
            ]
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
        attachments: list[dict[str, str]] | None = None,
    ) -> bool:
        message = EmailMessage()
        message["From"] = self.settings.email_from or "SoftMusic <administrativo@softmusic.com.br>"
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        message.set_content(body)
        if html:
            message.add_alternative(html, subtype="html")
        for item in attachments or []:
            message.add_attachment(
                item["content"].encode("utf-8"),
                maintype="text",
                subtype="calendar",
                filename=item["filename"],
            )

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

    def password_reset_code(self, email: str, code: str, full_name: str) -> bool:
        html = password_reset_code_email_html(
            full_name=full_name,
            code=code,
            web_origin=self.settings.web_origin,
        )
        text = password_reset_code_email_text(full_name=full_name, code=code)
        return self.send(
            email,
            "Código para redefinir sua senha — SoftMusic",
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
        calendar_uid: str,
        calendar_sequence: int = 0,
        members_lines: Sequence[str] | None = None,
        songs_lines: Sequence[str] | None = None,
        action: str = "create",
    ) -> bool:
        kind_label = "Ensaio" if kind == "rehearsal" else "Evento"
        start_local = starts_at.astimezone(TZ_SP)
        end_local = ends_at.astimezone(TZ_SP)
        date_br = start_local.strftime("%d/%m/%Y")
        when_label = start_local.strftime("%d/%m/%Y às %H:%M")
        ends_label = end_local.strftime("%d/%m/%Y às %H:%M")
        roster = [line for line in (members_lines or []) if str(line).strip()]
        repertoire = [line for line in (songs_lines or []) if str(line).strip()]

        summary = title or f"{kind_label} — {band_name}"
        if action == "cancel":
            subject = f"Cancelado: {kind_label} {band_name} {date_br}"
            method = "CANCEL"
        elif action == "update":
            subject = f"Atualizado: {kind_label} {band_name} {date_br}"
            method = "REQUEST"
        else:
            subject = f"{kind_label} {band_name} {date_br}"
            method = "REQUEST"

        details_parts = [summary, f"Banda: {band_name}", f"Local: {address}"]
        if roster and action != "cancel":
            details_parts.append("Integrantes:")
            details_parts.extend(f"- {line}" for line in roster)
        if repertoire and action != "cancel":
            details_parts.append("Músicas:")
            details_parts.extend(f"- {line}" for line in repertoire)
        details_parts.append("SoftMusic")
        description = "\n".join(details_parts)
        maps_url = f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"

        ics_content = build_ics(
            uid=calendar_uid,
            summary=summary,
            description=description,
            location=address,
            starts_at=starts_at,
            ends_at=ends_at,
            sequence=calendar_sequence,
            method=method,
        )
        filename = f"softmusic-{kind}-{date_br.replace('/', '-')}.ics"

        html = schedule_occurrence_email_html(
            kind_label=kind_label,
            band_name=band_name,
            title=title,
            when_label=when_label,
            ends_label=ends_label,
            address=address,
            maps_url=maps_url,
            web_origin=self.settings.web_origin,
            members_lines=list(roster),
            songs_lines=list(repertoire),
            action=action,
        )
        text = schedule_occurrence_email_text(
            kind_label=kind_label,
            band_name=band_name,
            title=title,
            when_label=when_label,
            ends_label=ends_label,
            address=address,
            maps_url=maps_url,
            members_lines=list(roster),
            songs_lines=list(repertoire),
            action=action,
        )
        return self.send(
            recipients,
            subject,
            text,
            html=html,
            attachments=[{"filename": filename, "content": ics_content}],
        )
