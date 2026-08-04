import { parseUtcIso } from "@softmusic/shared/datetime";

/** Converte ISO da API (UTC, com ou sem offset) para valor de `datetime-local` no fuso do browser. */
export function toDatetimeLocalValue(iso: string): string {
  const d = parseUtcIso(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converte valor de `datetime-local` (hora local do browser) para ISO UTC. */
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}
