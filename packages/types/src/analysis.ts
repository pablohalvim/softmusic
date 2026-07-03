import { z } from "zod";

export const ANALYSIS_JSON_VERSION = "1.0.0" as const;

export const EducationalLevelSchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
  "professional",
]);

export const AnalysisModeSchema = z.enum([
  "educational",
  "worship",
  "guitar",
  "piano",
  "improvisation",
]);

export const MetadataSchema = z.object({
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  duration_seconds: z.number().nonnegative(),
  genre: z.string().nullable(),
  mood: z.string().nullable(),
  language: z.string().nullable(),
  release_year: z.number().int().nullable(),
  isrc: z.string().nullable(),
});

export const HarmonySchema = z.object({
  key: z.string(),
  mode: z.enum(["major", "minor", "other"]),
  relative_key: z.string(),
  parallel_key: z.string(),
  tempo_bpm: z.number().positive(),
  meter: z.string(),
  scale: z.array(z.string()),
  chord_progression: z.array(
    z.object({
      start_seconds: z.number().nonnegative(),
      end_seconds: z.number().nonnegative(),
      chord: z.string(),
      roman_numeral: z.string(),
      function: z.string().nullable(),
    }),
  ),
  cadences: z.array(
    z.object({
      start_seconds: z.number().nonnegative(),
      type: z.string(),
      chords: z.array(z.string()),
    }),
  ),
  modulations: z.array(
    z.object({
      start_seconds: z.number().nonnegative(),
      from_key: z.string(),
      to_key: z.string(),
      pivot_chord: z.string().nullable(),
    }),
  ),
  harmonic_rhythm: z.number().nonnegative(),
});

export const RhythmSchema = z.object({
  bpm: z.number().positive(),
  beat_times: z.array(z.number().nonnegative()),
  downbeat_times: z.array(z.number().nonnegative()),
  subdivision: z.string(),
  swing: z.number().min(0).max(1),
  syncopation: z.number().min(0).max(1),
  groove: z.string(),
  complexity: z.number().min(0).max(1),
  pulse_stability: z.number().min(0).max(1),
});

export const StructureSectionSchema = z.object({
  type: z.enum([
    "intro",
    "verse",
    "pre_chorus",
    "chorus",
    "bridge",
    "instrumental",
    "solo",
    "interlude",
    "break",
    "build_up",
    "drop",
    "ending",
    "outro",
  ]),
  start_seconds: z.number().nonnegative(),
  end_seconds: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});

export const InstrumentSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
  stem: z.string().nullable(),
});

export const PerformanceSchema = z.object({
  dynamics: z.number().min(0).max(1),
  energy: z.number().min(0).max(1),
  density: z.number().min(0).max(1),
  intensity: z.number().min(0).max(1),
  loudness_lufs: z.number(),
  compression_estimate: z.number().min(0).max(1),
});

export const EducationalExplanationSchema = z.object({
  level: EducationalLevelSchema,
  summary: z.string(),
  harmony_notes: z.array(z.string()),
  emotional_tension: z.array(z.string()),
});

export const AnalysisResultSchema = z.object({
  version: z.literal(ANALYSIS_JSON_VERSION),
  song_id: z.string(),
  generated_at: z.string().datetime(),
  metadata: MetadataSchema,
  harmony: HarmonySchema,
  rhythm: RhythmSchema,
  structure: z.object({
    sections: z.array(StructureSectionSchema),
  }),
  instruments: z.array(InstrumentSchema),
  performance: PerformanceSchema,
  educational: z.array(EducationalExplanationSchema),
  worship: z.record(z.unknown()).nullable(),
  guitar: z.record(z.unknown()).nullable(),
  piano: z.record(z.unknown()).nullable(),
  improvisation: z.record(z.unknown()).nullable(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type EducationalLevel = z.infer<typeof EducationalLevelSchema>;
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
