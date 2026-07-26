import { clearTokens, loadActiveBandId, loadTokens, saveTokens } from "./auth-storage";

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

/** Single-flight: evita 2 refreshes paralelos (rotação revoga o token do “perdedor”). */
let refreshInFlight: Promise<boolean> | null = null;

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const run = async (): Promise<boolean> => {
    const tokens = loadTokens();
    if (!tokens?.refresh_token) {
      return false;
    }
    try {
      const response = await fetch(`${apiUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      });
      if (!response.ok) {
        return false;
      }
      const payload = await response.json();
      if (!payload?.access_token) {
        return false;
      }
      saveTokens({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token ?? tokens.refresh_token,
      });
      return true;
    } catch {
      return false;
    }
  };

  refreshInFlight = run().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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
    const hadRefresh = Boolean(loadTokens()?.refresh_token);
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryHeaders = new Headers(authHeaders());
      if (init.headers) {
        for (const [key, value] of new Headers(init.headers)) {
          retryHeaders.set(key, value);
        }
      }
      response = await fetch(`${apiUrl}${path}`, { ...init, headers: retryHeaders });
    } else if (hadRefresh) {
      // Refresh inválido/expirado — limpa para não ficar em loop de 401.
      clearTokens();
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
  analyzed_count: number;
  songs: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  };
  recent_songs: Array<{
    id: string;
    title: string | null;
    artist: string | null;
    status: SongSummary["status"];
    updated_at: string;
  }>;
  in_progress_songs: Array<{
    id: string;
    title: string | null;
    artist: string | null;
    status: SongSummary["status"];
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

export interface PendingInvite {
  id: string;
  band_id: string;
  band_name: string;
  email: string;
  can_analyze_songs: boolean;
  expires_at: string;
  created_at: string;
}

export async function fetchPendingInvites(): Promise<PendingInvite[]> {
  const response = await authFetch("/invites/pending");
  if (!response.ok) {
    throw new Error("Não foi possível carregar convites");
  }
  const payload = await response.json();
  return payload.items ?? [];
}

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "msg" in first) {
      return String((first as { msg: unknown }).msg);
    }
  }
  const message = (payload as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}

export async function acceptPendingInvite(inviteId: string): Promise<void> {
  const response = await authFetch("/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite_id: inviteId }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(errorDetail(payload, "Não foi possível aceitar o convite"));
  }
}

export async function declinePendingInvite(inviteId: string): Promise<void> {
  const response = await authFetch("/invites/decline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite_id: inviteId }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(errorDetail(payload, "Não foi possível recusar o convite"));
  }
}

export async function inviteBandMember(
  bandId: string,
  email: string,
  canAnalyzeSongs = false,
): Promise<void> {
  const response = await authFetch(`/bands/${bandId}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, can_analyze_songs: canAnalyzeSongs }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(errorDetail(payload, "Não foi possível enviar o convite"));
  }
}

export interface BandRole {
  id: string;
  band_id: string;
  name: string;
  sort_order: number;
  is_default: boolean;
}

export interface BandMemberDetail {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  is_owner: boolean;
  joined_at: string | null;
  roles: BandRole[];
  can_analyze_songs: boolean;
  can_invite_members: boolean;
  can_manage_members: boolean;
}

export interface SavedAddress {
  id: string;
  band_id: string;
  label: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string | null;
  maps_url?: string;
}

export interface ScheduleOccurrence {
  id: string;
  kind: "event" | "rehearsal";
  starts_at: string;
  ends_at: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string | null;
  maps_url: string;
}

export interface BandSchedule {
  id: string;
  band_id: string;
  title: string | null;
  created_at: string;
  occurrences: ScheduleOccurrence[];
  members: Array<{ member_id: string; full_name: string }>;
}

export interface UpcomingOccurrence {
  id: string;
  schedule_id: string;
  kind: "event" | "rehearsal";
  title?: string | null;
  band_id: string;
  band_name: string;
  starts_at: string;
  ends_at: string;
  formatted_address: string;
  lat: number;
  lng: number;
  maps_url: string;
}

async function readJsonOrThrow(response: Response, fallback: string) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(errorDetail(payload, fallback));
  }
  return response.json();
}

export async function fetchBandRoles(bandId: string): Promise<BandRole[]> {
  const response = await authFetch(`/bands/${bandId}/roles`);
  const payload = await readJsonOrThrow(response, "Não foi possível carregar funções");
  return payload.items ?? [];
}

export async function createBandRole(bandId: string, name: string): Promise<BandRole> {
  const response = await authFetch(`/bands/${bandId}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readJsonOrThrow(response, "Não foi possível criar a função");
}

export async function updateBandRole(bandId: string, roleId: string, name: string): Promise<BandRole> {
  const response = await authFetch(`/bands/${bandId}/roles/${roleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return readJsonOrThrow(response, "Não foi possível atualizar a função");
}

export async function deleteBandRole(bandId: string, roleId: string): Promise<void> {
  const response = await authFetch(`/bands/${bandId}/roles/${roleId}`, { method: "DELETE" });
  await readJsonOrThrow(response, "Não foi possível excluir a função");
}

export async function fetchBandMembers(bandId: string): Promise<BandMemberDetail[]> {
  const response = await authFetch(`/bands/${bandId}/members`);
  const payload = await readJsonOrThrow(response, "Não foi possível carregar membros");
  return payload.items ?? [];
}

export async function updateBandMember(
  bandId: string,
  memberId: string,
  body: {
    can_analyze_songs?: boolean;
    can_invite_members?: boolean;
    can_manage_members?: boolean;
    can_delete_songs?: boolean;
    role_ids?: string[];
  },
): Promise<BandMemberDetail> {
  const response = await authFetch(`/bands/${bandId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonOrThrow(response, "Não foi possível atualizar o membro");
}

export async function removeBandMember(bandId: string, memberId: string): Promise<void> {
  const response = await authFetch(`/bands/${bandId}/members/${memberId}`, { method: "DELETE" });
  await readJsonOrThrow(response, "Não foi possível remover o membro");
}

export async function changeBandPlan(bandId: string, planCode: string) {
  const response = await authFetch(`/bands/${bandId}/plan`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_code: planCode }),
  });
  return readJsonOrThrow(response, "Não foi possível alterar o plano");
}

export async function fetchBandAddresses(bandId: string): Promise<SavedAddress[]> {
  const response = await authFetch(`/bands/${bandId}/addresses`);
  const payload = await readJsonOrThrow(response, "Não foi possível carregar endereços");
  return payload.items ?? [];
}

export async function createBandAddress(
  bandId: string,
  body: {
    label: string;
    formatted_address: string;
    lat: number;
    lng: number;
    place_id?: string | null;
  },
): Promise<SavedAddress> {
  const response = await authFetch(`/bands/${bandId}/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonOrThrow(response, "Não foi possível salvar o endereço");
}

export async function deleteBandAddress(bandId: string, addressId: string): Promise<void> {
  const response = await authFetch(`/bands/${bandId}/addresses/${addressId}`, {
    method: "DELETE",
  });
  await readJsonOrThrow(response, "Não foi possível excluir o endereço");
}

export async function fetchBandSchedules(bandId: string): Promise<BandSchedule[]> {
  const response = await authFetch(`/bands/${bandId}/schedules`);
  const payload = await readJsonOrThrow(response, "Não foi possível carregar a agenda");
  return payload.items ?? [];
}

export async function createBandSchedule(bandId: string, body: unknown): Promise<BandSchedule> {
  const response = await authFetch(`/bands/${bandId}/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonOrThrow(response, "Não foi possível criar a escala");
}

export async function fetchUpcomingSchedule(): Promise<{
  next_rehearsal: UpcomingOccurrence | null;
  next_event: UpcomingOccurrence | null;
}> {
  const response = await authFetch("/schedule/upcoming");
  return readJsonOrThrow(response, "Não foi possível carregar a agenda");
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
