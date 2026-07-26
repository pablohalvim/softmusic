export const STEM_LABELS: Record<string, string> = {
  drums: "Bateria",
  bass: "Baixo",
  vocals: "Vocal",
  guitar: "Guitarra / Violão",
  piano: "Teclado / Piano",
  other: "Outros instrumentos",
};

export function stemLabel(name: string): string {
  return STEM_LABELS[name] ?? name;
}

export interface StemInfo {
  name: string;
  file: string;
  duration_seconds: number;
  role: string;
  available?: boolean;
}

export interface StemsManifest {
  song_id: string;
  separated: boolean;
  model?: string;
  backend?: string;
  stems: StemInfo[];
  message?: string;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
