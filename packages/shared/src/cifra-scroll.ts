export const DEFAULT_CIFRA_LINE_HEIGHT_PX = 32;
export const DEFAULT_BEATS_PER_LINE = 4;
export const DEFAULT_CIFRA_SCROLL_BPM = 120;

export interface CifraScrollSpeedOptions {
  bpm: number;
  lineHeightPx?: number;
  beatsPerLine?: number;
  speedMultiplier?: number;
}

/**
 * Estima pixels/segundo para rolagem da cifra a partir do BPM.
 * Assume ~4 batidas por linha e altura de linha ~32px (leading-8).
 */
export function cifraScrollPixelsPerSecond({
  bpm,
  lineHeightPx = DEFAULT_CIFRA_LINE_HEIGHT_PX,
  beatsPerLine = DEFAULT_BEATS_PER_LINE,
  speedMultiplier = 1,
}: CifraScrollSpeedOptions): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : DEFAULT_CIFRA_SCROLL_BPM;
  const safeMultiplier = Math.max(0.25, Math.min(3, speedMultiplier));
  const secondsPerLine = (beatsPerLine / safeBpm) * 60;
  return (lineHeightPx / secondsPerLine) * safeMultiplier;
}
