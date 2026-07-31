"""Templates HTML de e-mail SoftMusic (manual de cores do produto)."""

from __future__ import annotations

from html import escape
from urllib.parse import quote

# Manual de cores (apps/web app.css / admin)
VOID = "#020806"
CANVAS = "#050f0a"
SURFACE = "#0a1610"
SURFACE_ELEVATED = "#0f1f16"
BORDER = "#1a3328"
BORDER_BRIGHT = "#2d5c45"
BRAND = "#22c55e"
BRAND_BRIGHT = "#4ade80"
BRAND_DIM = "#14532d"
TEXT = "#ecfdf5"
MUTED = "#7fa892"
ACCENT = "#ef4444"


def google_calendar_url(
    *,
    title: str,
    starts_at_utc_compact: str,
    ends_at_utc_compact: str,
    details: str,
    location: str,
) -> str:
    """starts/ends no formato YYYYMMDDTHHMMSSZ."""
    params = (
        f"action=TEMPLATE"
        f"&text={quote(title)}"
        f"&dates={starts_at_utc_compact}/{ends_at_utc_compact}"
        f"&details={quote(details)}"
        f"&location={quote(location)}"
    )
    return f"https://calendar.google.com/calendar/render?{params}"


def _shell(*, preheader: str, body_inner: str) -> str:
    pre = escape(preheader)
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>SoftMusic</title>
  <!--[if mso]><style type="text/css">table {{ border-collapse: collapse; }}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:{VOID};color:{TEXT};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{pre}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{VOID};background-image:radial-gradient(ellipse 80% 50% at 50% -20%, rgba(34,197,94,0.12), transparent);">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:{SURFACE};border:1px solid {BORDER};border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.45);">
          <tr>
            <td style="padding:22px 28px;background:linear-gradient(135deg,{BRAND_DIM} 0%,{SURFACE_ELEVATED} 55%,{SURFACE} 100%);border-bottom:1px solid {BORDER};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40" valign="middle">
                    <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,{BRAND_BRIGHT},{BRAND});color:#052e16;font-weight:800;font-size:18px;line-height:36px;text-align:center;">S</div>
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <div style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:{TEXT};">SoftMusic</div>
                    <div style="font-size:12px;color:{MUTED};margin-top:2px;">Agenda da banda</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              {body_inner}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 24px;border-top:1px solid {BORDER};background:{CANVAS};">
              <p style="margin:0;font-size:12px;line-height:1.5;color:{MUTED};">
                Você recebeu este e-mail porque foi incluído na escala da banda no SoftMusic.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def schedule_occurrence_email_html(
    *,
    kind_label: str,
    band_name: str,
    title: str | None,
    when_label: str,
    ends_label: str,
    address: str,
    maps_url: str,
    web_origin: str,
    members_lines: list[str] | None = None,
    songs_lines: list[str] | None = None,
    action: str = "create",
) -> str:
    band = escape(band_name)
    kind = escape(kind_label)
    optional_title = (
        f'<p style="margin:0 0 16px;font-size:15px;color:{MUTED};">{escape(title)}</p>'
        if title
        else ""
    )
    if action == "cancel":
        intro = "Este compromisso foi cancelado. Abra o anexo .ics para remover do Google Agenda."
        accent_label = "Cancelado"
    elif action == "update":
        intro = "A escala foi atualizada. Abra o anexo .ics para atualizar no Google Agenda."
        accent_label = "Atualizado"
    else:
        intro = "Você foi confirmado na escala. Abra o anexo .ics para salvar no Google Agenda."
        accent_label = kind_label

    members = [line for line in (members_lines or []) if line.strip()]
    if members and action != "cancel":
        members_html = "".join(
            f'<li style="margin:0 0 6px;font-size:13px;color:{MUTED};">{escape(line)}</li>'
            for line in members
        )
        members_block = f"""
            <p style="margin:14px 0 6px;font-size:13px;color:{MUTED};"><strong style="color:{TEXT};">Integrantes</strong></p>
            <ul style="margin:0;padding-left:18px;">{members_html}</ul>
        """
    else:
        members_block = ""
    songs = [line for line in (songs_lines or []) if line.strip()]
    if songs and action != "cancel":
        songs_html = "".join(
            f'<li style="margin:0 0 6px;font-size:13px;color:{MUTED};">{escape(line)}</li>'
            for line in songs
        )
        songs_block = f"""
            <p style="margin:14px 0 6px;font-size:13px;color:{MUTED};"><strong style="color:{TEXT};">Músicas</strong></p>
            <ul style="margin:0;padding-left:18px;">{songs_html}</ul>
        """
    else:
        songs_block = ""
    agenda_href = escape(f"{web_origin.rstrip('/')}/agenda")
    agenda_link = (
        f' · <a href="{agenda_href}" style="color:{BRAND_BRIGHT};text-decoration:underline;">Ver minha agenda</a>'
        if action != "cancel"
        else ""
    )
    body = f"""
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:{BRAND_BRIGHT};">{escape(accent_label)}</p>
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;font-weight:700;color:{TEXT};">{band}</h1>
      {optional_title}
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:{MUTED};">
        {escape(intro)}
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:{SURFACE_ELEVATED};border:1px solid {BORDER_BRIGHT};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <p style="margin:0 0 10px;font-size:13px;color:{MUTED};"><strong style="color:{TEXT};">Quando</strong><br />{escape(when_label)}</p>
            <p style="margin:0 0 10px;font-size:13px;color:{MUTED};"><strong style="color:{TEXT};">Até</strong><br />{escape(ends_label)}</p>
            <p style="margin:0;font-size:13px;color:{MUTED};"><strong style="color:{TEXT};">Local</strong><br />{escape(address)}</p>
            {members_block}
            {songs_block}
          </td>
        </tr>
      </table>

      <p style="margin:0 0 12px;font-size:13px;color:{MUTED};">
        Anexo: arquivo <strong style="color:{TEXT};">.ics</strong> para o Google Agenda / Apple Calendar.
      </p>

      <p style="margin:0 0 18px;">
        <a href="{escape(maps_url)}" target="_blank" rel="noopener noreferrer"
           style="font-size:14px;font-weight:600;color:{BRAND_BRIGHT};text-decoration:underline;">
          Abrir rota no mapa
        </a>
      </p>

      <p style="margin:0;font-size:13px;color:{MUTED};">
        Acesse o SoftMusic:
        <a href="{escape(web_origin)}" style="color:{BRAND_BRIGHT};text-decoration:underline;">{escape(web_origin)}</a>
        {agenda_link}
      </p>
    """
    return _shell(
        preheader=f"{kind_label} de {band_name} em {when_label}",
        body_inner=body,
    )


def invite_member_email_html(
    *,
    band_name: str,
    invite_url: str,
    web_origin: str,
) -> str:
    band = escape(band_name)
    body = f"""
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:{BRAND_BRIGHT};">Convite</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:{TEXT};">Você foi convidado</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:{MUTED};">
        A banda <strong style="color:{TEXT};">{band}</strong> convidou você para o SoftMusic —
        cifras, análises e agenda da equipe em um só lugar.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:{SURFACE_ELEVATED};border:1px solid {BORDER_BRIGHT};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <p style="margin:0;font-size:14px;line-height:1.5;color:{MUTED};">
              Crie sua conta (ou entre se já tiver) e aceite o convite para entrar na banda
              <strong style="color:{TEXT};">{band}</strong>.
            </p>
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
        <tr>
          <td style="border-radius:12px;background:linear-gradient(180deg,{BRAND_BRIGHT},{BRAND});">
            <a href="{escape(invite_url)}" target="_blank" rel="noopener noreferrer"
               style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#052e16;text-decoration:none;">
              Aceitar Convite
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:12px;line-height:1.5;color:{MUTED};">
        Se o botão não funcionar, copie e cole este link no navegador:<br />
        <a href="{escape(invite_url)}" style="color:{BRAND_BRIGHT};word-break:break-all;">{escape(invite_url)}</a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:{MUTED};">
        SoftMusic · <a href="{escape(web_origin)}" style="color:{BRAND_BRIGHT};">{escape(web_origin)}</a>
      </p>
    """
    return _shell(
        preheader=f"{band_name} convidou você para o SoftMusic",
        body_inner=body,
    )


def invite_member_email_text(*, band_name: str, invite_url: str) -> str:
    return (
        f"A banda {band_name} convidou você para o SoftMusic.\n\n"
        f"Aceitar convite: {invite_url}\n"
    )


def password_reset_code_email_html(*, full_name: str, code: str, web_origin: str) -> str:
    name = escape(full_name or "olá")
    safe_code = escape(code)
    body = f"""
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:{BRAND_BRIGHT};">Recuperação de senha</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:{TEXT};">Seu código de verificação</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:{MUTED};">
        Olá, <strong style="color:{TEXT};">{name}</strong>. Use o código abaixo para redefinir sua senha no SoftMusic.
        Ele expira em 15 minutos.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:{SURFACE_ELEVATED};border:1px solid {BORDER_BRIGHT};border-radius:14px;">
        <tr>
          <td align="center" style="padding:22px 20px;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:{MUTED};">Código</p>
            <p style="margin:0;font-size:32px;font-weight:800;letter-spacing:0.28em;color:{BRAND_BRIGHT};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">{safe_code}</p>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;line-height:1.55;color:{MUTED};">
        Se você não pediu a redefinição, ignore este e-mail. Sua senha permanecerá a mesma.
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:{MUTED};">
        SoftMusic · <a href="{escape(web_origin)}" style="color:{BRAND_BRIGHT};">{escape(web_origin)}</a>
      </p>
    """
    return _shell(
        preheader=f"Código SoftMusic: {code}",
        body_inner=body,
    )


def password_reset_code_email_text(*, full_name: str, code: str) -> str:
    return (
        f"Olá, {full_name or 'olá'}.\n\n"
        f"Seu código para redefinir a senha no SoftMusic é: {code}\n"
        "Ele expira em 15 minutos.\n\n"
        "Se você não pediu isso, ignore este e-mail.\n"
    )


def schedule_occurrence_email_text(
    *,
    kind_label: str,
    band_name: str,
    title: str | None,
    when_label: str,
    ends_label: str,
    address: str,
    maps_url: str,
    members_lines: list[str] | None = None,
    songs_lines: list[str] | None = None,
    action: str = "create",
) -> str:
    action_label = {
        "cancel": "CANCELADO",
        "update": "ATUALIZADO",
        "create": "NOVO",
    }.get(action, "NOVO")
    lines = [
        f"[{action_label}] {kind_label} — {band_name}",
    ]
    if title:
        lines.append(title)
    lines.extend(
        [
            "",
            f"Quando: {when_label}",
            f"Até: {ends_label}",
            f"Local: {address}",
        ]
    )
    members = [line for line in (members_lines or []) if line.strip()]
    if members and action != "cancel":
        lines.append("")
        lines.append("Integrantes:")
        lines.extend(f"- {line}" for line in members)
    songs = [line for line in (songs_lines or []) if line.strip()]
    if songs and action != "cancel":
        lines.append("")
        lines.append("Músicas:")
        lines.extend(f"- {line}" for line in songs)
    lines.extend(
        [
            "",
            "Abra o anexo .ics para sincronizar com o Google Agenda.",
            f"Abrir rota no mapa: {maps_url}",
        ]
    )
    return "\n".join(lines)
