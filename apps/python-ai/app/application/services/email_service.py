from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import Iterable

import httpx

from app.config import get_settings
from app.logging import logger


class EmailService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def send(self, to: str, subject: str, body: str) -> bool:
        if self.settings.resend_api_key:
            return self._send_resend(to, subject, body)
        if self.settings.smtp_host:
            return self._send_smtp(to, subject, body)
        logger.info("email_skipped_no_provider", to=to, subject=subject)
        return False

    def _send_resend(self, to: str, subject: str, body: str) -> bool:
        try:
            response = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {self.settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": self.settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "text": body,
                },
                timeout=30.0,
            )
            if response.is_success:
                return True
            logger.warning(
                "resend_send_failed",
                to=to,
                status=response.status_code,
                error=response.text[:500],
            )
            return False
        except Exception as exc:
            logger.warning("resend_send_failed", to=to, error=str(exc))
            return False

    def _send_smtp(self, to: str, subject: str, body: str) -> bool:
        message = EmailMessage()
        message["From"] = self.settings.email_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        try:
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port) as server:
                server.starttls()
                if self.settings.smtp_user:
                    server.login(self.settings.smtp_user, self.settings.smtp_password)
                server.send_message(message)
            return True
        except Exception as exc:
            logger.warning("email_send_failed", to=to, error=str(exc))
            return False

    def send_bulk(self, recipients: Iterable[str], subject: str, body: str) -> int:
        sent = 0
        for email in recipients:
            if self.send(email, subject, body):
                sent += 1
        return sent

    def invite_member(self, email: str, band_name: str, invite_url: str) -> bool:
        return self.send(
            email,
            f"Convite para a banda {band_name} — SoftMusic",
            f"Você foi convidado para participar da banda {band_name}.\n\nAceite em: {invite_url}",
        )

    def payment_overdue(self, email: str, invoice_url: str | None) -> bool:
        link = invoice_url or f"{self.settings.web_origin}/faturas"
        return self.send(
            email,
            "Fatura SoftMusic em atraso",
            f"Sua assinatura está em atraso. Regularize em: {link}",
        )
