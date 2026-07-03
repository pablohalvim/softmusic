const AUDIO_VOLUME_KEY = "softmusic:audio-volume";
const METRONOME_VOLUME_KEY = "softmusic:metronome-volume";

export function loadAudioVolume(defaultValue = 1): number {
  return loadVolume(AUDIO_VOLUME_KEY, defaultValue);
}

export function saveAudioVolume(value: number): void {
  saveVolume(AUDIO_VOLUME_KEY, value);
}

export function loadMetronomeVolume(defaultValue = 0.9): number {
  return loadVolume(METRONOME_VOLUME_KEY, defaultValue);
}

export function saveMetronomeVolume(value: number): void {
  saveVolume(METRONOME_VOLUME_KEY, value);
}

function loadVolume(key: string, defaultValue: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return defaultValue;
    return clampVolume(parsed);
  } catch {
    return defaultValue;
  }
}

function saveVolume(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(clampVolume(value)));
  } catch {
    // ignore storage errors
  }
}

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}
