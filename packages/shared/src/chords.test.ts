import { describe, expect, it } from "vitest";

import { buildCifraSheet, compressChordSequence, transposeChord, transposeKey } from "./chords.js";

describe("transposeChord", () => {
  it("transposes simple major chord", () => {
    expect(transposeChord("G", 2)).toBe("A");
  });

  it("transposes slash chord", () => {
    expect(transposeChord("G/B", 2)).toBe("A/C#");
  });

  it("transposes extended chord", () => {
    expect(transposeChord("C7M", 1)).toBe("C#7M");
    expect(transposeChord("Am7", -2)).toBe("Gm7");
  });
});

describe("transposeKey", () => {
  it("transposes major key", () => {
    expect(transposeKey("G", "major", 2)).toBe("A");
  });

  it("transposes minor key", () => {
    expect(transposeKey("Am", "minor", 2)).toBe("Bm");
  });
});

describe("buildCifraSheet", () => {
  it("groups chords by section", () => {
    const sheet = buildCifraSheet({
      key: "G",
      mode: "major",
      tempo_bpm: 120,
      progression: [
        { start_seconds: 0, end_seconds: 4, chord: "G", roman_numeral: "I", function: "tonic" },
        { start_seconds: 4, end_seconds: 8, chord: "C7M", roman_numeral: "IV", function: null },
        { start_seconds: 8, end_seconds: 12, chord: "Am7", roman_numeral: "ii", function: null },
      ],
      sections: [
        { type: "intro", start_seconds: 0, end_seconds: 12, confidence: 0.9 },
      ],
    });

    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0]?.label).toBe("Intro");
    expect(sheet.sections[0]?.lines[0]?.chords).toEqual(["G", "C7M", "Am7"]);
  });

  it("distributes chords across sections when timestamps do not match", () => {
    const sheet = buildCifraSheet({
      key: "G",
      mode: "major",
      tempo_bpm: 120,
      progression: [
        { start_seconds: 0, end_seconds: 4, chord: "G", roman_numeral: "I", function: "tonic" },
        { start_seconds: 4, end_seconds: 8, chord: "C7M", roman_numeral: "IV", function: null },
        { start_seconds: 8, end_seconds: 12, chord: "Am7", roman_numeral: "ii", function: null },
        { start_seconds: 12, end_seconds: 16, chord: "D7", roman_numeral: "V", function: null },
      ],
      sections: [
        { type: "verse", start_seconds: 50, end_seconds: 120, confidence: 0.9 },
        { type: "chorus", start_seconds: 120, end_seconds: 200, confidence: 0.9 },
      ],
    });

    expect(sheet.sections).toHaveLength(2);
    expect(sheet.sections[0]?.lines[0]?.chords).toEqual(["G", "C7M"]);
    expect(sheet.sections[1]?.lines[0]?.chords).toEqual(["Am7", "D7"]);
  });

  it("compresses repeated consecutive chords", () => {
    expect(compressChordSequence(["A", "A", "A", "F#m", "F#m", "D"])).toEqual(["A", "F#m", "D"]);
  });
});
