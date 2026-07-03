import { z } from "zod";
import { AnalysisModeSchema, EducationalLevelSchema } from "./analysis.js";

export const SourceTypeSchema = z.enum([
  "youtube",
  "upload",
  "http",
  "s3",
  "azure_blob",
  "gcs",
]);

export const AnalyzeSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("youtube"), url: z.string().url() }),
  z.object({ type: z.literal("http"), url: z.string().url() }),
  z.object({ type: z.literal("s3"), url: z.string().url() }),
  z.object({ type: z.literal("azure_blob"), url: z.string().url() }),
  z.object({ type: z.literal("gcs"), url: z.string().url() }),
  z.object({ type: z.literal("upload"), file_id: z.string().min(1) }),
]);

export const AnalyzeOptionsSchema = z.object({
  modes: z.array(AnalysisModeSchema).default(["educational"]),
  educational_level: EducationalLevelSchema.default("intermediate"),
  cifra_club_url: z.string().url().optional(),
});

export const AnalyzeRequestSchema = z.object({
  source: AnalyzeSourceSchema,
  options: AnalyzeOptionsSchema.optional(),
});

export const SongSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  source_type: z.string().optional(),
  youtube_url: z.string().nullable().optional(),
  cifra_club_url: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const AnalyzeResponseSchema = z.object({
  duplicate: z.boolean().optional(),
  job_id: z.string().nullable(),
  song_id: z.string(),
  message: z.string().nullable().optional(),
  variation: z
    .object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      snapshot: z.record(z.unknown()),
      cifra_club_url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type SongSummary = z.infer<typeof SongSummarySchema>;
