export interface CifraKeyOverride {
  key: string;
  mode: string;
}

function storageKey(songId: string): string {
  return `softmusic:cifra-key:${songId}`;
}

export function loadCifraKeyOverride(songId: string): CifraKeyOverride | null {
  try {
    const raw = localStorage.getItem(storageKey(songId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CifraKeyOverride;
    if (!parsed?.key || !parsed?.mode) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCifraKeyOverride(songId: string, override: CifraKeyOverride): void {
  localStorage.setItem(storageKey(songId), JSON.stringify(override));
}

export function clearCifraKeyOverride(songId: string): void {
  localStorage.removeItem(storageKey(songId));
}
