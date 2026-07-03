import { describe, expect, it } from "vitest";

import {
  analyzeProgressionChords,
  buildHarmonicField,
  buildMusicMap,
  buildRelatedKeys,
  chordToDegree,
  chordToRoman,
  inferKeyFromChords,
  summarizeProgressionDegrees,
} from "./harmony.js";

describe("buildHarmonicField", () => {
  it("builds major field with seven degrees", () => {
    const field = buildHarmonicField("A", "major");
    expect(field).toHaveLength(7);
    expect(field[0]).toMatchObject({ degree: 1, note: "A", roman: "I", chord: "A" });
    expect(field[2]).toMatchObject({ degree: 3, note: "C#", roman: "iii", chord: "C#m" });
    expect(field[5]).toMatchObject({ degree: 6, note: "F#", roman: "vi", chord: "F#m" });
  });
});

describe("buildRelatedKeys", () => {
  it("returns relative and parallel for major", () => {
    const related = buildRelatedKeys("A", "major");
    expect(related.map((item) => item.type)).toEqual([
      "Relativo",
      "Paralelo",
      "Dominante",
      "Subdominante",
    ]);
    expect(related[0]).toMatchObject({ key: "F#", mode: "minor" });
    expect(related[1]).toMatchObject({ key: "Am", mode: "minor" });
  });
});

describe("chordToDegree", () => {
  it("maps chord root to scale degree in key", () => {
    expect(chordToDegree("A", "A", "major")).toBe(1);
    expect(chordToDegree("C#m7", "A", "major")).toBe(3);
    expect(chordToDegree("F#m", "A", "major")).toBe(6);
    expect(chordToDegree("E7", "A", "major")).toBe(5);
  });
});

describe("chordToRoman", () => {
  it("returns roman numeral from chord", () => {
    expect(chordToRoman("D", "A", "major")).toBe("IV");
    expect(chordToRoman("F#m", "A", "major")).toBe("vi");
  });
});

describe("analyzeProgressionChords", () => {
  it("labels each chord with degree and function", () => {
    const analyzed = analyzeProgressionChords(
      [
        { start_seconds: 0, end_seconds: 4, chord: "A" },
        { start_seconds: 4, end_seconds: 8, chord: "F#m" },
        { start_seconds: 8, end_seconds: 12, chord: "D" },
      ],
      "A",
      "major",
    );

    expect(analyzed[0]?.degree).toBe(1);
    expect(analyzed[1]?.degree).toBe(6);
    expect(analyzed[2]?.degree).toBe(4);
  });
});

describe("summarizeProgressionDegrees", () => {
  it("aggregates usage by degree", () => {
    const analyzed = analyzeProgressionChords(
      [
        { start_seconds: 0, end_seconds: 4, chord: "A" },
        { start_seconds: 4, end_seconds: 8, chord: "A" },
        { start_seconds: 8, end_seconds: 12, chord: "F#m" },
      ],
      "A",
      "major",
    );

    const summary = summarizeProgressionDegrees(analyzed, "A", "major");
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({ degree: 1, count: 2, percentage: 67 });
    expect(summary[1]).toMatchObject({ degree: 6, count: 1, percentage: 33 });
  });
});

describe("inferKeyFromChords", () => {
  it("detects A major from typical progression", () => {
    const inferred = inferKeyFromChords(["A", "F#m", "D", "E", "A/C#"]);
    expect(inferred).toMatchObject({ key: "A", mode: "major" });
  });

  it("prefers A major over wrongly imported C major", () => {
    const inferred = inferKeyFromChords(["A", "F#m", "D", "E"]);
    expect(inferred?.key).toBe("A");
    expect(inferred?.mode).toBe("major");
  });
});

describe("buildMusicMap", () => {
  it("creates timeline blocks for sections and chords", () => {
    const map = buildMusicMap({
      duration_seconds: 100,
      sections: [{ type: "intro", start_seconds: 0, end_seconds: 20 }],
      progression: [{ start_seconds: 0, end_seconds: 4, chord: "A" }],
      key: "A",
      mode: "major",
    });

    expect(map.sections).toHaveLength(1);
    expect(map.chords).toHaveLength(1);
    expect(map.sections[0]?.widthPercent).toBeCloseTo(20, 0);
  });
});
