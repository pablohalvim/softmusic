import { describe, expect, it } from "vitest";

import {
  buildChordRowChars,
  collectUniqueDisplayChords,
  legacyLineToPlacements,
  lineFromNotasAndLetra,
  lineDisplayWidth,
  lineMaxChordOffset,
  normalizeEditableSheet,
  placementsToChordList,
  parseChordTokens,
  replaceChordInSheetByDisplay,
  sheetFromImportedSections,
  updateLineNotasAndLetra,
} from "./cifra-layout.js";

describe("cifra-layout", () => {
  it("maps chord-only line offsets from legacy chords", () => {
    const placements = legacyLineToPlacements(["A", "F#m", "D"], "Há uma canção, que não cessa");
    expect(placements).toHaveLength(3);
    expect(placements[0]?.offset).toBe(0);
  });

  it("builds chord row above lyrics", () => {
    const lyrics = "Há uma canção";
    const placements = [
      { id: "p1", chord: "A", offset: 0 },
      { id: "p2", chord: "F#m", offset: 7 },
    ];
    const width = lineDisplayWidth(lyrics, placements);
    const row = buildChordRowChars(lyrics, placements, width).join("");
    expect(row.startsWith("A")).toBe(true);
    expect(row.indexOf("F#m")).toBe(7);
  });

  it("converts imported sections with placements", () => {
    const sheet = sheetFromImportedSections([
      {
        id: "s1",
        label: "Intro",
        lines: [
          {
            id: "l1",
            lyrics: "Há uma canção",
            placements: [{ id: "p1", chord: "A", offset: 0 }],
          },
        ],
      },
    ]);
    expect(sheet.sections[0]?.lines[0]?.placements[0]?.chord).toBe("A");
  });

  it("adds 30% extra width for lyric lines", () => {
    const lyrics = "Há uma canção";
    const width = lineDisplayWidth(lyrics, [], { sectionLabel: "Verso" });
    expect(width).toBe(Math.ceil(lyrics.length * 1.3));
  });

  it("uses 5x width for intro and solo sections", () => {
    const placements = [
      { id: "p1", chord: "A", offset: 0 },
      { id: "p2", chord: "F#m", offset: 4 },
      { id: "p3", chord: "D", offset: 8 },
    ];
    const introWidth = lineDisplayWidth("", placements, { sectionLabel: "Intro" });
    expect(introWidth).toBe(60);
    const soloWidth = lineDisplayWidth("", placements, { sectionLabel: "Solo 1" });
    expect(soloWidth).toBe(60);
  });

  it("allows chord movement beyond lyrics within extended width", () => {
    const lyrics = "Há uma canção";
    const placements = [{ id: "p1", chord: "A", offset: 0 }];
    const maxOffset = lineMaxChordOffset(lyrics, placements, { sectionLabel: "Verso" });
    expect(maxOffset).toBeGreaterThan(lyrics.length - 1);
  });

  it("collects unique display chords in order", () => {
    const sheet = sheetFromImportedSections([
      {
        id: "s1",
        label: "Verso",
        lines: [
          {
            id: "l1",
            lyrics: "linha",
            placements: [
              { id: "p1", chord: "A", offset: 0 },
              { id: "p2", chord: "F#m", offset: 4 },
              { id: "p3", chord: "A", offset: 8 },
            ],
          },
        ],
      },
    ]);
    expect(collectUniqueDisplayChords(sheet, (chord) => chord)).toEqual(["A", "F#m"]);
  });

  it("replaces chord everywhere in sheet", () => {
    const sheet = sheetFromImportedSections([
      {
        id: "s1",
        label: "Verso",
        lines: [
          {
            id: "l1",
            lyrics: "linha",
            placements: [
              { id: "p1", chord: "A", offset: 0 },
              { id: "p2", chord: "F#m", offset: 4 },
              { id: "p3", chord: "A", offset: 8 },
            ],
          },
        ],
      },
    ]);
    const next = replaceChordInSheetByDisplay(
      sheet,
      "A",
      "G",
      (display) => display,
      (stored) => stored,
    );
    expect(next.sections[0]?.lines[0]?.placements.map((p) => p.chord)).toEqual(["G", "F#m", "G"]);
  });

  it("parses chord tokens from notas field", () => {
    expect(parseChordTokens("Am G F#m  C")).toEqual(["Am", "G", "F#m", "C"]);
    expect(parseChordTokens("   ")).toEqual([]);
  });

  it("builds a line from notas and letra", () => {
    const line = lineFromNotasAndLetra({
      chords: ["A", "F#m"],
      lyrics: "Há uma canção",
    });
    expect(line.lyrics).toBe("Há uma canção");
    expect(line.placements).toHaveLength(2);
    expect(line.id).toMatch(/^line-/);
  });

  it("preserves line id when updating notas and letra", () => {
    const original = lineFromNotasAndLetra({
      lineId: "line-fixed",
      chords: ["A"],
      lyrics: "Antiga",
    });
    const updated = updateLineNotasAndLetra(original, {
      chords: ["G", "D"],
      lyrics: "Nova letra",
    });
    expect(updated.id).toBe("line-fixed");
    expect(updated.lyrics).toBe("Nova letra");
    expect(placementsToChordList(updated.placements)).toEqual(["G", "D"]);
  });

  it("normalizes sheets missing placements on lines", () => {
    const normalized = normalizeEditableSheet({
      sections: [
        {
          id: "s1",
          label: "Cifra",
          lines: [{ id: "l1", lyrics: "Pra onde eu posso ir?", placements: undefined as never }],
        },
      ],
    });
    expect(normalized.sections[0]?.lines[0]?.placements).toEqual([]);
    expect(lineDisplayWidth("Pra onde eu posso ir?", undefined)).toBeGreaterThan(0);
  });
});
