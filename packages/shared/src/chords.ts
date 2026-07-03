const CHROMATIC_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
  Fb: "E",
};

const SECTION_LABELS: Record<string, string> = {
  intro: "Intro",
  verse: "Verso",
  pre_chorus: "Pré-Refrão",
  chorus: "Refrão",
  bridge: "Ponte",
  instrumental: "Instrumental",
  solo: "Solo",
  interlude: "Interlúdio",
  break: "Break",
  build_up: "Build Up",
  drop: "Drop",
  ending: "Final",
  outro: "Outro",
};

export interface ChordProgressionItem {
  start_seconds: number;
  end_seconds: number;
  chord: string;
  roman_numeral: string;
  function: string | null;
}

export interface StructureSection {
  type: string;
  start_seconds: number;
  end_seconds: number;
  confidence: number;
}

export interface CifraLine {
  id: string;
  chords: string[];
  lyrics: string;
}

export interface CifraSection {
  id: string;
  label: string;
  lines: CifraLine[];
}

export interface CifraSheet {
  original_key: string;
  mode: string;
  tempo_bpm: number;
  sections: CifraSection[];
}

const CHORD_PATTERN = /^([A-G](?:#|b)?)([^/]*?)(?:\/([A-G](?:#|b)?))?$/;

function normalizeRoot(root: string): string {
  if (root.length === 2 && root[1] === "b") {
    return FLAT_TO_SHARP[root] ?? root;
  }
  return root;
}

function rootToIndex(root: string): number {
  const normalized = normalizeRoot(root);
  const index = CHROMATIC_SHARP.indexOf(normalized as (typeof CHROMATIC_SHARP)[number]);
  if (index === -1) {
    throw new Error(`Tom inválido: ${root}`);
  }
  return index;
}

function indexToRoot(index: number, preferFlats = false): string {
  const value = ((index % 12) + 12) % 12;
  const sharp = CHROMATIC_SHARP[value] ?? "C";
  if (!preferFlats) {
    return sharp;
  }
  const flatMap: Record<string, string> = {
    "C#": "Db",
    "D#": "Eb",
    "F#": "Gb",
    "G#": "Ab",
    "A#": "Bb",
  };
  return flatMap[sharp] ?? sharp;
}

export function transposeChord(chord: string, semitones: number): string {
  const trimmed = chord.trim();
  if (!trimmed || semitones === 0) {
    return trimmed;
  }

  const match = CHORD_PATTERN.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  const root = match[1];
  const suffix = match[2] ?? "";
  const bass = match[3];
  if (!root) {
    return trimmed;
  }

  const transposedRoot = indexToRoot(rootToIndex(root) + semitones);
  const transposedBass = bass ? indexToRoot(rootToIndex(bass) + semitones) : undefined;
  return transposedBass ? `${transposedRoot}${suffix}/${transposedBass}` : `${transposedRoot}${suffix}`;
}

export function transposeKey(key: string, mode: string, semitones: number): string {
  const root = key.replace(/m$| minor| major/gi, "").trim();
  const isMinor = mode === "minor" || key.toLowerCase().includes("m");
  const transposed = indexToRoot(rootToIndex(root) + semitones);
  return isMinor ? `${transposed}m` : transposed;
}

export function formatSectionLabel(type: string, index: number): string {
  const base = SECTION_LABELS[type] ?? type;
  const duplicates = ["verse", "chorus", "bridge"];
  if (duplicates.includes(type) && index > 0) {
    return `${base} ${index + 1}`;
  }
  return base;
}

export function chordsForSection(
  progression: ChordProgressionItem[],
  section: StructureSection,
  sectionIndex: number,
  totalSections: number,
): string[] {
  const inSection = progression
    .filter(
      (item) =>
        item.start_seconds >= section.start_seconds && item.start_seconds < section.end_seconds,
    )
    .map((item) => item.chord);

  if (inSection.length > 0) {
    return inSection;
  }

  if (progression.length === 0) {
    return [];
  }

  const startIndex = Math.floor((sectionIndex / totalSections) * progression.length);
  const endIndex = Math.max(
    startIndex + 1,
    Math.floor(((sectionIndex + 1) / totalSections) * progression.length),
  );
  return progression.slice(startIndex, endIndex).map((item) => item.chord);
}

export function compressChordSequence(chords: string[]): string[] {
  const result: string[] = [];
  for (const chord of chords) {
    if (result.length === 0 || result[result.length - 1] !== chord) {
      result.push(chord);
    }
  }
  return result;
}

export function buildCifraSheet(input: {
  key: string;
  mode: string;
  tempo_bpm: number;
  progression: ChordProgressionItem[];
  sections: StructureSection[];
}): CifraSheet {
  const sectionCounts: Record<string, number> = {};
  const totalSections = input.sections.length || 1;
  const cifraSections: CifraSection[] = input.sections.map((section, sectionIndex) => {
    const count = sectionCounts[section.type] ?? 0;
    sectionCounts[section.type] = count + 1;

    const rawChords = chordsForSection(
      input.progression,
      section,
      sectionIndex,
      totalSections,
    );
    const chords = compressChordSequence(rawChords);

    const lines: CifraLine[] = [
      {
        id: `section-${sectionIndex}-line-0`,
        chords,
        lyrics: "",
      },
    ];

    return {
      id: `section-${sectionIndex}`,
      label: formatSectionLabel(section.type, count),
      lines,
    };
  });

  return {
    original_key: input.key,
    mode: input.mode,
    tempo_bpm: input.tempo_bpm,
    sections: cifraSections,
  };
}

export const KEY_OPTIONS = CHROMATIC_SHARP.map((note) => note);
