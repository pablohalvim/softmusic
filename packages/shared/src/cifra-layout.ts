export interface ChordPlacement {
  id: string;
  chord: string;
  offset: number;
}

export interface CifraLineWithPlacements {
  id: string;
  lyrics: string;
  placements: ChordPlacement[];
}

export interface CifraSectionWithPlacements {
  id: string;
  label: string;
  lines: CifraLineWithPlacements[];
}

export interface EditableCifraSheet {
  sections: CifraSectionWithPlacements[];
}

export function newPlacementId(chord: string, offset: number): string {
  return `p-${offset}-${chord}-${Math.random().toString(36).slice(2, 7)}`;
}

export function legacyLineToPlacements(chords: string[], lyrics: string): ChordPlacement[] {
  if (chords.length === 0) return [];
  if (!lyrics.trim()) {
    return chords.map((chord, index) => ({
      id: newPlacementId(chord, index * 4),
      chord,
      offset: index * 4,
    }));
  }

  if (chords.length === 1) {
    const chord = chords[0]!;
    return [{ id: newPlacementId(chord, 0), chord, offset: 0 }];
  }

  const step = lyrics.length / chords.length;
  return chords.map((chord, index) => {
    const offset = Math.min(
      Math.max(0, Math.round(step * index)),
      Math.max(0, lyrics.length - 1),
    );
    return {
      id: newPlacementId(chord, offset),
      chord,
      offset,
    };
  });
}

export function normalizeEditableSheet(sheet: EditableCifraSheet): EditableCifraSheet {
  return sheetFromImportedSections(sheet?.sections ?? []);
}

export function sheetFromImportedSections(
  sections: Array<{
    id: string;
    label: string;
    lines: Array<{
      id: string;
      lyrics: string;
      chords?: string[];
      placements?: ChordPlacement[];
    }>;
  }>,
): EditableCifraSheet {
  return {
    sections: sections.map((section) => ({
      id: section.id,
      label: section.label,
      lines: section.lines.map((line) => ({
        id: line.id,
        lyrics: line.lyrics,
        placements:
          line.placements && line.placements.length > 0
            ? line.placements
            : legacyLineToPlacements(line.chords ?? [], line.lyrics),
      })),
    })),
  };
}

export function isInstrumentalSectionLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return /^(intro|solo|interl[uú]dio|instrumental|outro|passagem|break|riff)(\s+\d+)?$/i.test(
    normalized,
  );
}

export function lineContentWidth(lyrics: string, placements: ChordPlacement[] | undefined): number {
  const safePlacements = placements ?? [];
  const placementEnd = safePlacements.reduce(
    (max, placement) => Math.max(max, placement.offset + placement.chord.length),
    0,
  );
  return Math.max(lyrics.length, placementEnd);
}

export interface LineWidthOptions {
  sectionLabel?: string;
}

/** Largura editável da linha (com folga para arrastar acordes). */
export function lineDisplayWidth(
  lyrics: string,
  placements: ChordPlacement[] | undefined,
  options?: LineWidthOptions,
): number {
  const safePlacements = placements ?? [];
  const contentWidth = lineContentWidth(lyrics, safePlacements);
  const instrumental =
    isInstrumentalSectionLabel(options?.sectionLabel ?? "") ||
    (!lyrics.trim() && safePlacements.length > 0);

  if (instrumental) {
    const base = Math.max(contentWidth, safePlacements.length * 4, 8);
    return Math.ceil(base * 5);
  }

  const base = Math.max(contentWidth, lyrics.length, 1);
  return Math.ceil(base * 1.3);
}

/** Maior deslocamento (coluna) permitido para um acorde nesta linha. */
export function lineMaxChordOffset(
  lyrics: string,
  placements: ChordPlacement[] | undefined,
  options?: LineWidthOptions & { chordLength?: number },
): number {
  const safePlacements = placements ?? [];
  const width = lineDisplayWidth(lyrics, safePlacements, options);
  const chordLength = Math.max(1, options?.chordLength ?? 1);
  return Math.max(0, width - chordLength);
}

export function buildChordRowChars(
  lyrics: string,
  placements: ChordPlacement[] | undefined,
  width: number,
): string[] {
  const safePlacements = placements ?? [];
  const row = Array.from({ length: width }, () => " ");
  const sorted = [...safePlacements].sort((a, b) => a.offset - b.offset);

  for (const placement of sorted) {
    for (let index = 0; index < placement.chord.length; index += 1) {
      const column = placement.offset + index;
      if (column >= 0 && column < width) {
        row[column] = placement.chord[index] ?? " ";
      }
    }
  }

  return row;
}

/** Acordes únicos na ordem de aparição (valores já transpostos para exibição). */
export function collectUniqueDisplayChords(
  sheet: EditableCifraSheet,
  displayChord: (chord: string) => string,
): string[] {
  const seen = new Set<string>();
  const chords: string[] = [];

  for (const section of sheet.sections) {
    for (const line of section.lines) {
      for (const placement of line.placements) {
        const display = displayChord(placement.chord);
        if (!display || seen.has(display)) continue;
        seen.add(display);
        chords.push(display);
      }
    }
  }

  return chords;
}

/** Substitui um acorde em todas as ocorrências da cifra (compara pelo valor exibido). */
export function replaceChordInSheetByDisplay(
  sheet: EditableCifraSheet,
  fromDisplay: string,
  toDisplay: string,
  toStoredChord: (displayChord: string) => string,
  displayChord: (storedChord: string) => string,
): EditableCifraSheet {
  const trimmedTo = toDisplay.trim();
  if (!trimmedTo || fromDisplay === trimmedTo) return sheet;

  const storedReplacement = toStoredChord(trimmedTo);

  return {
    sections: sheet.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => ({
        ...line,
        placements: line.placements.map((placement) => {
          if (displayChord(placement.chord) !== fromDisplay) return placement;
          return { ...placement, chord: storedReplacement };
        }),
      })),
    })),
  };
}
