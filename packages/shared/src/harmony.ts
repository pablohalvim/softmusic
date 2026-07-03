const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
  Fb: "E",
};

const ROOT_PATTERN = /^([A-G](?:#|b)?)/;

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"] as const;
const ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"] as const;

const MAJOR_SUFFIXES = ["", "m", "m", "", "", "m", "°"] as const;
const MINOR_SUFFIXES = ["m", "°", "", "m", "m", "", ""] as const;

export type HarmonicFunction = "tonic" | "subdominant" | "dominant" | "other";

export interface HarmonicFieldDegree {
  degree: number;
  note: string;
  roman: string;
  chord: string;
  function: HarmonicFunction;
  functionLabel: string;
}

export interface RelatedKeyInfo {
  type: string;
  key: string;
  mode: "major" | "minor";
  description: string;
}

export interface AnalyzedChord {
  chord: string;
  start_seconds: number;
  end_seconds: number;
  degree: number | null;
  roman: string;
  inKey: boolean;
  function: HarmonicFunction;
  functionLabel: string;
}

export interface ProgressionDegreeSummary {
  degree: number;
  roman: string;
  count: number;
  percentage: number;
  chords: string[];
}

export interface MusicMapSectionBlock {
  id: string;
  label: string;
  type: string;
  start_seconds: number;
  end_seconds: number;
  leftPercent: number;
  widthPercent: number;
}

export interface MusicMapChordBlock {
  chord: string;
  roman: string;
  degree: number | null;
  start_seconds: number;
  end_seconds: number;
  leftPercent: number;
  widthPercent: number;
  function: HarmonicFunction;
}

export interface MusicMap {
  duration_seconds: number;
  sections: MusicMapSectionBlock[];
  chords: MusicMapChordBlock[];
}

function normalizeRoot(root: string): string {
  if (root.length === 2 && root[1] === "b") {
    return FLAT_TO_SHARP[root] ?? root;
  }
  return root;
}

function rootToIndex(root: string): number {
  const normalized = normalizeRoot(root);
  const index = CHROMATIC.indexOf(normalized as (typeof CHROMATIC)[number]);
  if (index === -1) {
    throw new Error(`Tom inválido: ${root}`);
  }
  return index;
}

function indexToRoot(index: number): string {
  const value = ((index % 12) + 12) % 12;
  return CHROMATIC[value] ?? "C";
}

export function parseKeyRoot(key: string): string {
  return key.replace(/m$| minor| major/gi, "").trim();
}

function scaleNotes(key: string, mode: string): string[] {
  const idx = rootToIndex(parseKeyRoot(key));
  const intervals = mode === "minor" ? MINOR_INTERVALS : MAJOR_INTERVALS;
  return intervals.map((step) => indexToRoot(idx + step));
}

function parseChordRoot(chord: string): string | null {
  const match = ROOT_PATTERN.exec(chord.trim());
  return match?.[1] ?? null;
}

function functionForDegree(degree: number, mode: string): HarmonicFunction {
  if (mode === "minor") {
    if (degree === 1) return "tonic";
    if (degree === 4) return "subdominant";
    if (degree === 5) return "dominant";
    return "other";
  }
  if (degree === 1 || degree === 6) return "tonic";
  if (degree === 2 || degree === 4) return "subdominant";
  if (degree === 5 || degree === 7) return "dominant";
  return "other";
}

function functionLabel(functionName: HarmonicFunction): string {
  switch (functionName) {
    case "tonic":
      return "Tônica";
    case "subdominant":
      return "Subdominante";
    case "dominant":
      return "Dominante";
    default:
      return "Mediante";
  }
}

function degreeLabel(degree: number): string {
  return `${degree}ª`;
}

export function buildHarmonicField(key: string, mode: string): HarmonicFieldDegree[] {
  const notes = scaleNotes(key, mode);
  const romans = mode === "minor" ? ROMAN_MINOR : ROMAN_MAJOR;
  const suffixes = mode === "minor" ? MINOR_SUFFIXES : MAJOR_SUFFIXES;

  return notes.map((note, index) => {
    const degree = index + 1;
    const harmonicFunction = functionForDegree(degree, mode);
    return {
      degree,
      note,
      roman: romans[index] ?? String(degree),
      chord: `${note}${suffixes[index] ?? ""}`,
      function: harmonicFunction,
      functionLabel: functionLabel(harmonicFunction),
    };
  });
}

export function buildRelatedKeys(key: string, mode: string): RelatedKeyInfo[] {
  const root = parseKeyRoot(key);
  const idx = rootToIndex(root);

  if (mode === "minor") {
    return [
      {
        type: "Relativo",
        key: indexToRoot(idx + 3),
        mode: "major",
        description: "Mesmas alterações, centro na tônica relativa maior",
      },
      {
        type: "Paralelo",
        key: root,
        mode: "major",
        description: "Mesma tônica, campo harmônico maior",
      },
      {
        type: "Dominante",
        key: indexToRoot(idx + 7),
        mode: "minor",
        description: "5º grau — cria tensão de resolução",
      },
      {
        type: "Subdominante",
        key: indexToRoot(idx + 5),
        mode: "minor",
        description: "4º grau — afastamento suave da tônica",
      },
    ];
  }

  return [
    {
      type: "Relativo",
      key: indexToRoot(idx + 9),
      mode: "minor",
      description: "Mesmas alterações, centro na relativa menor",
    },
    {
      type: "Paralelo",
      key: `${root}m`,
      mode: "minor",
      description: "Mesma tônica, campo harmônico menor",
    },
    {
      type: "Dominante",
      key: indexToRoot(idx + 7),
      mode: "major",
      description: "5º grau — tensão clássica de resolução",
    },
    {
      type: "Subdominante",
      key: indexToRoot(idx + 5),
      mode: "major",
      description: "4º grau — preparação e coloração",
    },
  ];
}

export function chordToDegree(chord: string, key: string, mode: string): number | null {
  const root = parseChordRoot(chord);
  if (!root) return null;

  const notes = scaleNotes(key, mode);
  const normalized = normalizeRoot(root);
  const index = notes.findIndex((note) => normalizeRoot(note) === normalized);
  return index === -1 ? null : index + 1;
}

export function chordToRoman(chord: string, key: string, mode: string): string {
  const degree = chordToDegree(chord, key, mode);
  if (!degree) return "?";

  const romans = mode === "minor" ? ROMAN_MINOR : ROMAN_MAJOR;
  return romans[degree - 1] ?? "?";
}

export interface InferredKey {
  key: string;
  mode: "major" | "minor";
  score: number;
}

function chordBaseSymbol(chord: string): string {
  return (chord.split("/")[0] ?? chord).trim();
}

function isMinorChordSymbol(symbol: string): boolean {
  return /^[A-G](?:#|b)?m(?!aj|in)/i.test(symbol);
}

function chordQualityMatches(chord: string, expected: string): boolean {
  return isMinorChordSymbol(chordBaseSymbol(chord)) === isMinorChordSymbol(expected);
}

function scoreKeyForChords(chords: string[], key: string, mode: string): number {
  const field = buildHarmonicField(key, mode);
  let score = 0;

  for (const chord of chords) {
    const trimmed = chord.trim();
    if (!trimmed) continue;

    const degree = chordToDegree(trimmed, key, mode);
    if (!degree) continue;

    const expected = field[degree - 1]?.chord ?? "";
    score += 2;

    if (chordQualityMatches(trimmed, expected)) {
      score += 3;
    }

    if (degree === 1) score += 4;
    if (degree === 5) score += 2;
    if (degree === 4) score += 1;
  }

  return score;
}

/** Infers the most likely key from chord symbols without transposing them. */
export function inferKeyFromChords(chords: string[]): InferredKey | null {
  const usable = chords.map((chord) => chord.trim()).filter(Boolean);
  if (usable.length === 0) return null;

  let best: InferredKey | null = null;

  for (const root of CHROMATIC) {
    for (const mode of ["major", "minor"] as const) {
      const key = mode === "minor" ? `${root}m` : root;
      const score = scoreKeyForChords(usable, key, mode);
      if (!best || score > best.score) {
        best = { key: root, mode, score };
      }
    }
  }

  if (!best || best.score === 0) return null;
  return best;
}

export function analyzeProgressionChords(
  progression: Array<{
    start_seconds: number;
    end_seconds: number;
    chord: string;
  }>,
  key: string,
  mode: string,
): AnalyzedChord[] {
  return progression.map((item) => {
    const degree = chordToDegree(item.chord, key, mode);
    const harmonicFunction = degree ? functionForDegree(degree, mode) : "other";
    return {
      chord: item.chord,
      start_seconds: item.start_seconds,
      end_seconds: item.end_seconds,
      degree,
      roman: degree ? chordToRoman(item.chord, key, mode) : "?",
      inKey: degree !== null,
      function: harmonicFunction,
      functionLabel: functionLabel(harmonicFunction),
    };
  });
}

export function summarizeProgressionDegrees(
  analyzed: AnalyzedChord[],
  key: string,
  mode: string,
): ProgressionDegreeSummary[] {
  const field = buildHarmonicField(key, mode);
  const counts = new Map<number, { count: number; chords: Set<string> }>();

  for (const item of analyzed) {
    if (!item.degree) continue;
    const current = counts.get(item.degree) ?? { count: 0, chords: new Set<string>() };
    current.count += 1;
    current.chords.add(item.chord);
    counts.set(item.degree, current);
  }

  const total = analyzed.filter((item) => item.degree).length || 1;

  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([degree, data]) => ({
      degree,
      roman: field[degree - 1]?.roman ?? String(degree),
      count: data.count,
      percentage: Math.round((data.count / total) * 100),
      chords: [...data.chords],
    }));
}

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

function formatSectionLabel(type: string, index: number): string {
  const base = SECTION_LABELS[type] ?? type;
  if (["verse", "chorus", "bridge"].includes(type) && index > 0) {
    return `${base} ${index + 1}`;
  }
  return base;
}

export function buildMusicMap(input: {
  duration_seconds: number;
  sections: Array<{
    type: string;
    start_seconds: number;
    end_seconds: number;
  }>;
  progression: Array<{
    start_seconds: number;
    end_seconds: number;
    chord: string;
  }>;
  key: string;
  mode: string;
}): MusicMap {
  const duration = Math.max(input.duration_seconds, 1);
  const sectionCounts: Record<string, number> = {};
  const analyzed = analyzeProgressionChords(input.progression, input.key, input.mode);

  const sections = input.sections.map((section, index) => {
    const count = sectionCounts[section.type] ?? 0;
    sectionCounts[section.type] = count + 1;
    const start = Math.max(0, section.start_seconds);
    const end = Math.max(start + 0.1, section.end_seconds);
    return {
      id: `section-${index}`,
      label: formatSectionLabel(section.type, count),
      type: section.type,
      start_seconds: start,
      end_seconds: end,
      leftPercent: (start / duration) * 100,
      widthPercent: Math.max(((end - start) / duration) * 100, 0.5),
    };
  });

  const chords = analyzed.map((item, index) => {
    const start = Math.max(0, item.start_seconds);
    const end = Math.max(start + 0.1, item.end_seconds);
    return {
      chord: item.chord,
      roman: item.roman,
      degree: item.degree,
      start_seconds: start,
      end_seconds: end,
      leftPercent: (start / duration) * 100,
      widthPercent: Math.max(((end - start) / duration) * 100, 0.4),
      function: item.function,
    };
  });

  return {
    duration_seconds: duration,
    sections,
    chords,
  };
}

export { degreeLabel, functionLabel };
