import { z } from "zod";

export const JobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const JobStageSchema = z.enum([
  "validate",
  "download",
  "normalize",
  "convert",
  "trim_silence",
  "separate_stems",
  "analyze_stems",
  "merge",
  "knowledge_graph",
  "explain",
  "persist",
]);

export const JobSchema = z.object({
  id: z.string(),
  song_id: z.string(),
  status: JobStatusSchema,
  stage: JobStageSchema.nullable(),
  progress: z.number().min(0).max(100),
  error: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});

export type Job = z.infer<typeof JobSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
