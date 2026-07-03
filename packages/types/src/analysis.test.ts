import { describe, expect, it } from "vitest";
import { AnalysisResultSchema } from "./analysis.js";
import { AnalyzeRequestSchema } from "./api.js";

describe("AnalyzeRequestSchema", () => {
  it("validates youtube source", () => {
    const result = AnalyzeRequestSchema.safeParse({
      source: { type: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    expect(result.success).toBe(true);
  });
});

describe("AnalysisResultSchema", () => {
  it("rejects invalid version", () => {
    const result = AnalysisResultSchema.safeParse({
      version: "0.0.1",
      song_id: "song_1",
      generated_at: new Date().toISOString(),
      metadata: {},
    });
    expect(result.success).toBe(false);
  });
});
