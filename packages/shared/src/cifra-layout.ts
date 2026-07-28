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

export function newLineId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Acordes separados por espaço (ex.: "Am G F C"). */
export function parseChordTokens(notas: string): string[] {
  return notas.trim().split(/\s+/).filter(Boolean);
}

export function lineFromNotasAndLetra(input: {
  lyrics: string;
  chords: string[];
  lineId?: string;
}): CifraLineWithPlacements {
  const lyrics = input.lyrics;
  return {
    id: input.lineId ?? newLineId(),
    lyrics,
    placements: legacyLineToPlacements(input.chords, lyrics),
  };
}

/** Ordem visual dos acordes da linha (por offset). */
export function placementsToChordList(placements: ChordPlacement[]): string[] {
  return [...placements].sort((a, b) => a.offset - b.offset).map((p) => p.chord);
}

export function updateLineNotasAndLetra(
  line: CifraLineWithPlacements,
  input: { lyrics: string; chords: string[] },
): CifraLineWithPlacements {
  return lineFromNotasAndLetra({
    lineId: line.id,
    lyrics: input.lyrics,
    chords: input.chords,
  });
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

export interface WrappedCifraSegment {
  /** Coluna global (na linha lógica) onde este segmento começa. */
  startCol: number;
  lyrics: string;
  placements: ChordPlacement[];
}

export interface WrapCifraLineOptions {
  /** Largura visual do acorde em colunas (ex.: após transposição). */
  chordLength?: (chord: string) => number;
}

/**
 * Fatia uma linha de cifra em segmentos que cabem em `maxCols` colunas,
 * preservando o alinhamento acorde ↔ letra (offsets locais por segmento).
 * Prefere quebrar em espaço/hífen e evita partir um acorde ao meio.
 */
export function wrapCifraLine(
  lyrics: string,
  placements: ChordPlacement[] | undefined,
  maxCols: number,
  options?: WrapCifraLineOptions,
): WrappedCifraSegment[] {
  const chordLength = options?.chordLength ?? ((chord: string) => Math.max(1, chord.length));
  const safeMax = Math.max(4, Math.floor(maxCols));
  const safePlacements = [...(placements ?? [])].sort((a, b) => a.offset - b.offset);

  const placementEnd = safePlacements.reduce(
    (max, placement) => Math.max(max, placement.offset + chordLength(placement.chord)),
    0,
  );
  const totalWidth = Math.max(lyrics.length, placementEnd);

  if (totalWidth <= safeMax) {
    return [{ startCol: 0, lyrics, placements: safePlacements }];
  }

  const segments: WrappedCifraSegment[] = [];
  let cursor = 0;

  while (cursor < totalWidth) {
    let idealEnd = Math.min(cursor + safeMax, totalWidth);

    for (const placement of safePlacements) {
      const start = placement.offset;
      const end = start + chordLength(placement.chord);
      if (start < idealEnd && end > idealEnd && start > cursor) {
        idealEnd = start;
      }
    }

    let breakAt = idealEnd;
    if (idealEnd < totalWidth) {
      const searchEnd = Math.min(idealEnd, lyrics.length);
      let whitespaceBreak = -1;
      for (let index = searchEnd - 1; index > cursor; index -= 1) {
        const char = lyrics[index];
        if (char === " " || char === "\t" || char === "-") {
          whitespaceBreak = index + 1;
          break;
        }
      }
      if (whitespaceBreak > cursor) {
        breakAt = whitespaceBreak;
      }

      for (const placement of safePlacements) {
        const start = placement.offset;
        const end = start + chordLength(placement.chord);
        if (start < breakAt && end > breakAt && start > cursor) {
          breakAt = start;
        }
      }

      if (breakAt <= cursor) {
        breakAt = Math.min(cursor + safeMax, totalWidth);
      }
    }

    const segmentPlacements = safePlacements
      .filter((placement) => placement.offset >= cursor && placement.offset < breakAt)
      .map((placement) => ({
        ...placement,
        offset: placement.offset - cursor,
      }));

    segments.push({
      startCol: cursor,
      lyrics: cursor >= lyrics.length ? "" : lyrics.slice(cursor, Math.min(breakAt, lyrics.length)),
      placements: segmentPlacements,
    });

    cursor = breakAt;
    if (segments.length > 500) break;
  }

  return segments.length > 0 ? segments : [{ startCol: 0, lyrics, placements: safePlacements }];
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
