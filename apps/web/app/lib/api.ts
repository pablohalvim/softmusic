import { loadActiveBandId, loadTokens, saveTokens } from "./auth-storage";

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  if (import.meta.env.DEV) {
    return "http://localhost:8080";
  }
  return "";
}

export const apiUrl = resolveApiUrl();

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.softmusic.v1+json",
  };
  const tokens = loadTokens();
  if (tokens?.access_token) {
    headers.Authorization = `Bearer ${tokens.access_token}`;
  }
  const bandId = loadActiveBandId();
  if (bandId) {
    headers["X-Band-Id"] = bandId;
  }
  return headers;
}

async function refreshAccessToken(): Promise<boolean> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    return false;
  }
  const response = await fetch(`${apiUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  if (!response.ok) {
    return false;
  }
  const payload = await response.json();
  saveTokens({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? tokens.refresh_token,
  });
  return true;
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(authHeaders());
  if (init.headers) {
    for (const [key, value] of new Headers(init.headers)) {
      headers.set(key, value);
    }
  }
  let response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryHeaders = new Headers(authHeaders());
      if (init.headers) {
        for (const [key, value] of new Headers(init.headers)) {
          retryHeaders.set(key, value);
        }
      }
      response = await fetch(`${apiUrl}${path}`, { ...init, headers: retryHeaders });
    }
  }
  return response;
}

export async function fetchAuthenticatedBlob(path: string): Promise<string> {
  const response = await authFetch(path);
  if (!response.ok) {
    throw new Error("Não foi possível carregar o áudio");
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function getSongAudioUrl(songId: string): string {
  return `${apiUrl}/songs/${songId}/audio`;
}

export function getStemAudioUrl(songId: string, stemName: string): string {
  return `${apiUrl}/songs/${songId}/stems/${encodeURIComponent(stemName)}/audio`;
}

export interface Job {
  id: string;
  song_id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SongSummary {
  id: string;
  title: string | null;
  artist: string | null;
  duration_seconds: number | null;
  status: "pending" | "processing" | "completed" | "failed";
  source_type?: string;
  created_at: string;
  updated_at: string;
}

export interface SongsListResponse {
  items: SongSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardStats {
  generated_at: string;
  songs: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  };
  jobs: {
    queued: number;
    processing: number;
  };
  pipeline: {
    average_duration_seconds: number | null;
    success_rate_24h: number | null;
    completed_24h: number;
    failed_24h: number;
  };
  recent_songs: Array<{
    id: string;
    title: string | null;
    artist: string | null;
    status: SongSummary["status"];
    updated_at: string;
  }>;
  active_jobs: Array<{
    job_id: string;
    song_id: string;
    title: string | null;
    status: Job["status"];
    stage: string | null;
    progress: number;
    updated_at: string;
  }>;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await authFetch("/dashboard/stats");
  if (!response.ok) {
    throw new Error("Não foi possível carregar as métricas do dashboard");
  }
  return response.json();
}

export async function fetchJob(jobId: string): Promise<Job> {
  const response = await authFetch(`/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error("Não foi possível carregar o status do job");
  }
  return response.json();
}

export async function fetchSong(songId: string): Promise<SongSummary> {
  const response = await authFetch(`/songs/${songId}`);
  if (!response.ok) {
    throw new Error("Música não encontrada");
  }
  return response.json();
}

export async function fetchSongJob(songId: string): Promise<Job> {
  const response = await authFetch(`/songs/${songId}/job`);
  if (!response.ok) {
    throw new Error("Job não encontrado");
  }
  return response.json();
}

export async function fetchSongs(limit = 50): Promise<SongsListResponse> {
  const response = await authFetch(`/songs?limit=${limit}`);
  if (!response.ok) {
    throw new Error("Não foi possível carregar a biblioteca");
  }
  return response.json();
}

export async function fetchGlobalSongs(limit = 50): Promise<SongsListResponse> {
  const response = await authFetch(`/songs/global?limit=${limit}`);
  if (!response.ok) {
    throw new Error("Não foi possível carregar a biblioteca global");
  }
  return response.json();
}

export async function linkSongToBand(songId: string): Promise<SongSummary> {
  const response = await authFetch(`/songs/${songId}/link`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível adicionar a música à banda"));
  }
  return response.json();
}

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    return payload?.detail ?? payload?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function deleteSong(songId: string): Promise<void> {
  const response = await authFetch(`/songs/${songId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível excluir a música"));
  }
}

export async function cancelSongAnalysis(songId: string): Promise<Job> {
  const response = await authFetch(`/songs/${songId}/cancel`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível cancelar a análise"));
  }
  return response.json();
}

export function isActiveSong(status: SongSummary["status"]): boolean {
  return status === "pending" || status === "processing";
}

export function isJobFinished(status: Job["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isSongFinished(status: SongSummary["status"]): boolean {
  return status === "completed" || status === "failed";
}
