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

export const AUTH_CLEARED_EVENT = "softmusic:auth-cleared";
export const AUTH_TOKENS_UPDATED_EVENT = "softmusic:auth-tokens-updated";

function notifyAuthCleared(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_CLEARED_EVENT));
}

function notifyTokensUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_TOKENS_UPDATED_EVENT));
}

/** Lê `exp` do JWT sem validar assinatura (só para refresh preventivo no cliente). */
export function getJwtExpiryMs(token: string): number | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function accessTokenNeedsRefresh(token: string, skewMs = 120_000): boolean {
  const exp = getJwtExpiryMs(token);
  if (exp == null) return true;
  return Date.now() + skewMs >= exp;
}

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
    const tokensBefore = loadTokens();
    if (!tokensBefore?.refresh_token) {
      return false;
    }
    try {
      const response = await fetch(`${apiUrl}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/vnd.softmusic.v1+json",
        },
        body: JSON.stringify({ refresh_token: tokensBefore.refresh_token }),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
        };
        if (!payload?.access_token) {
          return false;
        }
        saveTokens({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token ?? tokensBefore.refresh_token,
        });
        notifyTokensUpdated();
        return true;
      }

      // Outra aba pode ter rotacionado o refresh e gravado tokens novos.
      const tokensAfter = loadTokens();
      if (
        tokensAfter?.access_token &&
        tokensAfter.access_token !== tokensBefore.access_token &&
        !accessTokenNeedsRefresh(tokensAfter.access_token, 0)
      ) {
        return true;
      }

      // Só limpa em 401 definitivo com o mesmo refresh (expirado/revogado).
      // Erros de rede/5xx NÃO apagam a sessão — senão perde edição da cifra.
      if (response.status === 401 || response.status === 403) {
        const stillSameRefresh =
          loadTokens()?.refresh_token === tokensBefore.refresh_token;
        if (stillSameRefresh) {
          clearTokens();
          notifyAuthCleared();
        }
      }
      return false;
    } catch {
      const tokensAfter = loadTokens();
      if (
        tokensAfter?.access_token &&
        tokensAfter.access_token !== tokensBefore.access_token
      ) {
        return true;
      }
      return false;
    }
  };

  refreshInFlight = run().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Renova o access token se estiver perto de expirar (ou já expirado). */
export async function ensureFreshAccessToken(): Promise<boolean> {
  const tokens = loadTokens();
  if (!tokens?.access_token) {
    return false;
  }
  if (!accessTokenNeedsRefresh(tokens.access_token)) {
    return true;
  }
  return refreshAccessToken();
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Qualquer ação autenticada: se o access acabou (ou está perto), renova e segue.
  await ensureFreshAccessToken();

  const buildHeaders = () => {
    const headers = new Headers(authHeaders());
    if (init.headers) {
      for (const [key, value] of new Headers(init.headers)) {
        headers.set(key, value);
      }
    }
    return headers;
  };

  let response = await fetch(`${apiUrl}${path}`, { ...init, headers: buildHeaders() });
  if (response.status === 401 && loadTokens()?.refresh_token) {
    // Access expirou no meio do caminho — renova e repete a mesma ação uma vez.
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await fetch(`${apiUrl}${path}`, { ...init, headers: buildHeaders() });
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
  has_audio?: boolean;
  is_global?: boolean;
  created_by_user_id?: string | null;
  link_source?: "created" | "imported_global";
  can_reanalyze?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnalyzeSongResponse {
  duplicate?: boolean;
  job_id: string | null;
  song_id: string;
  message?: string | null;
  variation?: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    snapshot: Record<string, unknown>;
  } | null;
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
  can_invite_members?: boolean;
  can_manage_members?: boolean;
  can_delete_songs?: boolean;
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
  permissions: {
    can_analyze_songs?: boolean;
    can_invite_members?: boolean;
    can_manage_members?: boolean;
    can_delete_songs?: boolean;
  } = {},
): Promise<void> {
  const response = await authFetch(`/bands/${bandId}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      can_analyze_songs: permissions.can_analyze_songs ?? false,
      can_invite_members: permissions.can_invite_members ?? false,
      can_manage_members: permissions.can_manage_members ?? false,
      can_delete_songs: permissions.can_delete_songs ?? false,
    }),
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
  title?: string | null;
  starts_at: string;
  ends_at: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string | null;
  saved_address_id?: string | null;
  maps_url: string;
}

export interface ScheduleMember {
  member_id: string;
  full_name: string;
  role_ids?: string[];
  role_names?: string[];
  label?: string;
}

export interface ScheduleGridRow {
  occurrence_id: string;
  schedule_id: string;
  title: string | null;
  kind: "event" | "rehearsal";
  starts_at: string;
  ends_at: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id?: string | null;
  maps_url: string;
  member_count: number;
  members: ScheduleMember[];
}

export interface BandScheduleSong {
  id?: string;
  song_id: string;
  title?: string | null;
  artist?: string | null;
  musical_key: string;
  sort_order?: number;
}

export interface BandSchedule {
  id: string;
  band_id: string;
  title: string | null;
  created_at: string;
  occurrences: ScheduleOccurrence[];
  members: ScheduleMember[];
  songs?: BandScheduleSong[];
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
  members?: ScheduleMember[];
}

export function formatScheduleMemberLabel(member: {
  full_name: string;
  role_names?: string[];
  label?: string;
}): string {
  if (member.label?.trim()) return member.label;
  const roles = member.role_names ?? [];
  if (roles.length > 0) return `${member.full_name} (${roles.join(", ")})`;
  return member.full_name;
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

export async function fetchBandSchedules(bandId: string): Promise<ScheduleGridRow[]> {
  const response = await authFetch(`/bands/${bandId}/schedules`);
  const payload = await readJsonOrThrow(response, "Não foi possível carregar a agenda");
  return payload.items ?? [];
}

export async function fetchBandSchedule(bandId: string, scheduleId: string): Promise<BandSchedule> {
  const response = await authFetch(`/bands/${bandId}/schedules/${scheduleId}`);
  return readJsonOrThrow(response, "Não foi possível carregar a escala");
}

export async function createBandSchedule(bandId: string, body: unknown): Promise<BandSchedule> {
  const response = await authFetch(`/bands/${bandId}/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonOrThrow(response, "Não foi possível criar a escala");
}

export async function updateScheduleOccurrence(
  bandId: string,
  occurrenceId: string,
  body: unknown,
): Promise<BandSchedule> {
  const response = await authFetch(`/bands/${bandId}/schedules/occurrences/${occurrenceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonOrThrow(response, "Não foi possível atualizar a escala");
}

export async function cancelScheduleOccurrence(
  bandId: string,
  occurrenceId: string,
): Promise<void> {
  const response = await authFetch(
    `/bands/${bandId}/schedules/occurrences/${occurrenceId}/cancel`,
    { method: "POST" },
  );
  await readJsonOrThrow(response, "Não foi possível cancelar a escala");
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

export async function shareSongToGlobal(songId: string): Promise<SongSummary> {
  const response = await authFetch(`/songs/${songId}/share`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível compartilhar na biblioteca global"));
  }
  return response.json();
}

export async function unshareSongFromGlobal(songId: string): Promise<SongSummary> {
  const response = await authFetch(`/songs/${songId}/unshare`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível remover da biblioteca global"));
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

export async function updateSongMetadata(
  songId: string,
  input: { title: string; artist?: string | null },
): Promise<SongSummary> {
  const response = await authFetch(`/songs/${songId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title.trim(),
      artist: input.artist?.trim() || null,
    }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível atualizar a música"));
  }
  return response.json();
}

export async function cancelSongAnalysis(songId: string): Promise<Job> {
  const response = await authFetch(`/songs/${songId}/cancel`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível cancelar a análise"));
  }
  return response.json();
}

export async function createCifraDraft(input: {
  title: string;
  artist?: string;
  share_to_global?: boolean;
}): Promise<AnalyzeSongResponse> {
  const response = await authFetch("/songs/cifra-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      artist: input.artist?.trim() || null,
      share_to_global: input.share_to_global ?? true,
    }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível criar a música"));
  }
  return response.json();
}

export async function uploadSongForAnalysis(input: {
  file: File;
  title: string;
  artist?: string;
  share_to_global?: boolean;
}): Promise<AnalyzeSongResponse> {
  const formData = new FormData();
  formData.set("file", input.file);
  const options: Record<string, string | boolean> = {
    title: input.title,
    educational_level: "intermediate",
    share_to_global: input.share_to_global ?? true,
  };
  if (input.artist?.trim()) {
    options.artist = input.artist.trim();
  }
  formData.set("options", JSON.stringify(options));
  const response = await authFetch("/songs/upload", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível enviar a música"));
  }
  return response.json();
}

export async function reanalyzeSongAudio(
  songId: string,
  file: File,
  options?: { replace?: boolean },
): Promise<AnalyzeSongResponse> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("options", JSON.stringify({ educational_level: "intermediate" }));
  const replace = options?.replace ?? true;
  const response = await authFetch(
    `/songs/${encodeURIComponent(songId)}/analyze-audio-upload?replace=${replace ? "true" : "false"}`,
    {
      method: "POST",
      body: formData,
    },
  );
  if (!response.ok) {
    throw new Error(await parseError(response, "Não foi possível iniciar a nova análise"));
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
