import { describe, expect, it } from "vitest";

import { cifraScrollPixelsPerSecond } from "./cifra-scroll.js";

describe("cifraScrollPixelsPerSecond", () => {
  it("increases speed with higher BPM", () => {
    const slow = cifraScrollPixelsPerSecond({ bpm: 80 });
    const fast = cifraScrollPixelsPerSecond({ bpm: 160 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("doubles when speed multiplier is 2", () => {
    const base = cifraScrollPixelsPerSecond({ bpm: 120, speedMultiplier: 1 });
    const doubled = cifraScrollPixelsPerSecond({ bpm: 120, speedMultiplier: 2 });
    expect(doubled).toBeCloseTo(base * 2, 5);
  });

  it("uses fallback BPM when invalid", () => {
    const fallback = cifraScrollPixelsPerSecond({ bpm: 120 });
    const invalid = cifraScrollPixelsPerSecond({ bpm: 0 });
    expect(invalid).toBeCloseTo(fallback, 5);
  });

  it("matches expected value at 144 BPM", () => {
    // 32px line, 4 beats/line -> 19.2 px/s
    expect(cifraScrollPixelsPerSecond({ bpm: 144 })).toBeCloseTo(19.2, 1);
  });
});
