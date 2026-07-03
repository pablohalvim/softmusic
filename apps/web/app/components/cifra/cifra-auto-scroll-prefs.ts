const STORAGE_KEY = "softmusic:cifra-auto-scroll";

export interface CifraAutoScrollPrefs {
  speedMultiplier: number;
  syncWithAudio: boolean;
}

const DEFAULT_PREFS: CifraAutoScrollPrefs = {
  speedMultiplier: 1,
  syncWithAudio: false,
};

export function loadCifraAutoScrollPrefs(): CifraAutoScrollPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<CifraAutoScrollPrefs & { enabled?: boolean }>;
    return {
      speedMultiplier:
        typeof parsed.speedMultiplier === "number"
          ? Math.min(2, Math.max(0.5, parsed.speedMultiplier))
          : DEFAULT_PREFS.speedMultiplier,
      syncWithAudio: parsed.syncWithAudio ?? DEFAULT_PREFS.syncWithAudio,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveCifraAutoScrollPrefs(prefs: CifraAutoScrollPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
