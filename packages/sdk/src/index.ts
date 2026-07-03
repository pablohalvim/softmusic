import {
  AnalysisResultSchema,
  type AnalysisResult,
  type AnalyzeRequest,
  JobSchema,
  type Job,
  SongSummarySchema,
  type SongSummary,
} from "@softmusic/types";

export interface SoftMusicClientOptions {
  baseUrl: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
}

export class SoftMusicClient {
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SoftMusicClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    return {
      Accept: "application/vnd.softmusic.v1+json",
      "Content-Type": "application/json",
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      ...extra,
    };
  }

  async analyze(request: AnalyzeRequest): Promise<{ job_id: string; song_id: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}/songs/analyze`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    const data = await this.parseJson<{ job_id: string; song_id: string }>(response);
    return data;
  }

  async getJob(jobId: string): Promise<Job> {
    const response = await this.fetchImpl(`${this.baseUrl}/jobs/${jobId}`, {
      headers: this.headers(),
    });
    const data = await this.parseJson(response);
    return JobSchema.parse(data);
  }

  async getSong(songId: string): Promise<SongSummary> {
    const response = await this.fetchImpl(`${this.baseUrl}/songs/${songId}`, {
      headers: this.headers(),
    });
    const data = await this.parseJson(response);
    return SongSummarySchema.parse(data);
  }

  async getAnalysis(songId: string): Promise<AnalysisResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/songs/${songId}/analysis`, {
      headers: this.headers(),
    });
    const data = await this.parseJson(response);
    return AnalysisResultSchema.parse(data);
  }

  private async parseJson<T>(response: Response): Promise<T> {
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `Request failed with ${response.status}`);
    }
    return payload as T;
  }
}

export { SoftMusicClient as default };
