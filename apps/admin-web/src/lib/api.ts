const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const TOKEN_KEY = "softmusic:admin_token";
const ADMIN_KEY = "softmusic:admin_profile";

export type AdminRole = "full_admin" | "salesperson";

export interface AdminProfile {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  status?: string;
}

export interface AdminDashboardStats {
  generated_at: string;
  scope?: string;
  users_total?: number;
  bands_total?: number;
  delinquent_bands?: number;
  delinquent_users?: number;
  songs?: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
  };
  jobs?: {
    queued: number;
    processing: number;
  };
  pipeline?: {
    average_duration_seconds: number | null;
    success_rate_24h: number | null;
    completed_24h: number;
    failed_24h: number;
  };
  recent_songs?: Array<{
    id: string;
    title: string | null;
    artist: string | null;
    status: string;
    updated_at: string;
  }>;
  active_jobs?: Array<{
    job_id: string;
    song_id: string;
    title: string | null;
    status: string;
    stage: string | null;
    progress: number;
    updated_at: string;
  }>;
}

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
}

export function getStoredAdmin(): AdminProfile | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AdminProfile;
  } catch {
    return null;
  }
}

export function setStoredAdmin(admin: AdminProfile): void {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

export function isFullAdmin(admin: AdminProfile | null | undefined): boolean {
  return (admin?.role ?? "full_admin") === "full_admin";
}

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAdminToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401) {
    clearAdminToken();
  }
  return response;
}

async function parseAdminError(response: Response, fallback: string): Promise<never> {
  const text = await response.text();
  let message = fallback;
  try {
    const payload = JSON.parse(text) as { error?: { message?: string }; detail?: string };
    message = payload.error?.message ?? payload.detail ?? message;
  } catch {
    if (text) message = text;
  }
  throw new Error(message);
}

export async function adminLogin(email: string, password: string): Promise<AdminProfile> {
  const response = await fetch(`${API_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error("Credenciais inválidas");
  }
  const payload = await response.json();
  setAdminToken(payload.access_token);
  const admin = payload.admin as AdminProfile;
  setStoredAdmin(admin);
  return admin;
}

export async function fetchAdminMe(): Promise<AdminProfile> {
  const response = await adminFetch("/admin/me");
  if (!response.ok) await parseAdminError(response, "Falha ao carregar perfil admin");
  const admin = (await response.json()) as AdminProfile;
  setStoredAdmin(admin);
  return admin;
}

export async function fetchAdminUsers(query = "") {
  const response = await adminFetch(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  if (!response.ok) await parseAdminError(response, "Falha ao carregar usuários");
  return response.json();
}

export async function fetchAdminBands() {
  const response = await adminFetch("/admin/bands");
  if (!response.ok) await parseAdminError(response, "Falha ao carregar bandas");
  return response.json();
}

export async function fetchAdminDashboardStats(): Promise<AdminDashboardStats> {
  const response = await adminFetch("/admin/dashboard/stats");
  if (!response.ok) await parseAdminError(response, "Falha ao carregar dashboard");
  return response.json();
}

export async function fetchAdmins() {
  const response = await adminFetch("/admin/admins");
  if (!response.ok) await parseAdminError(response, "Falha ao carregar admins");
  return response.json();
}

export async function createAdmin(payload: {
  email: string;
  full_name: string;
  password: string;
  role: AdminRole;
}) {
  const response = await adminFetch("/admin/admins", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao criar admin");
  return response.json();
}

export async function updateAdmin(
  adminId: string,
  payload: { full_name?: string; role?: AdminRole; status?: "active" | "inactive" },
) {
  const response = await adminFetch(`/admin/admins/${adminId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao atualizar admin");
  return response.json();
}

export async function resetAdminPassword(adminId: string, password: string) {
  const response = await adminFetch(`/admin/admins/${adminId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao redefinir senha do admin");
}

export async function registerSale(payload: Record<string, unknown>) {
  const response = await adminFetch("/admin/sales/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao cadastrar venda");
  return response.json();
}

export async function generateInvoicePaymentLink(invoiceId: string) {
  const response = await adminFetch(`/admin/billing/invoices/${invoiceId}/payment-link`, {
    method: "POST",
  });
  if (!response.ok) await parseAdminError(response, "Falha ao gerar link de pagamento");
  return response.json() as Promise<{ invoice_url?: string; invoice_id: string }>;
}

export async function setBandExempt(bandId: string, exempt: boolean, reason?: string) {
  const response = await adminFetch(`/admin/bands/${bandId}/exempt`, {
    method: "PATCH",
    body: JSON.stringify({ exempt, reason }),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao atualizar isenção");
}

export async function suspendBand(bandId: string) {
  const response = await adminFetch(`/admin/bands/${bandId}/suspend`, { method: "POST" });
  if (!response.ok) await parseAdminError(response, "Falha ao suspender banda");
}

export async function deleteBand(bandId: string) {
  const response = await adminFetch(`/admin/bands/${bandId}`, { method: "DELETE" });
  if (!response.ok) await parseAdminError(response, "Falha ao remover banda");
}

export async function suspendOverdueAccounts() {
  const response = await adminFetch("/admin/billing/suspend-overdue", { method: "POST" });
  if (!response.ok) await parseAdminError(response, "Falha ao suspender contas em atraso");
  return response.json();
}

export async function sendMarketing(subject: string, body: string, audience = "all") {
  const response = await adminFetch("/admin/marketing/send", {
    method: "POST",
    body: JSON.stringify({ subject, body, audience }),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao enviar campanha");
  return response.json();
}

export interface AsaasSettings {
  asaas_api_key_masked: string;
  asaas_api_key_configured: boolean;
  asaas_environment: string;
  asaas_webhook_token_configured: boolean;
  asaas_webhook_url: string;
}

export async function fetchAsaasSettings(): Promise<AsaasSettings> {
  const response = await adminFetch("/admin/billing/settings");
  if (!response.ok) await parseAdminError(response, "Falha ao carregar parametrização Asaas");
  return response.json();
}

export async function updateAsaasSettings(payload: {
  asaas_api_key?: string;
  asaas_environment?: "sandbox" | "production";
  asaas_webhook_token?: string;
}): Promise<AsaasSettings> {
  const response = await adminFetch("/admin/billing/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!response.ok) await parseAdminError(response, "Falha ao salvar parametrização Asaas");
  return response.json();
}

export async function fetchAdminInvoices() {
  const response = await adminFetch("/admin/billing/invoices");
  if (!response.ok) await parseAdminError(response, "Falha ao carregar faturas");
  return response.json();
}
