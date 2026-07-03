export const APP_TIMEZONE = "America/Sao_Paulo";
export const APP_LOCALE = "pt-BR";

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  dateStyle: "short",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  dateStyle: "short",
});

/** Parses ISO timestamps from the API, assuming UTC when no offset is present. */
export function parseUtcIso(iso: string): Date {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso);
  }
  return new Date(`${iso}Z`);
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(parseUtcIso(iso));
}

export function formatDate(iso: string): string {
  return dateFormatter.format(parseUtcIso(iso));
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = parseUtcIso(iso);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min atrás`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;

  return formatDate(iso);
}
