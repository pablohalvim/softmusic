const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const TOKEN_KEY = "softmusic:admin_token";

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
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
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function adminLogin(email: string, password: string) {
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
  return payload.admin;
}

export async function fetchAdminUsers(query = "") {
  const response = await adminFetch(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  if (!response.ok) throw new Error("Falha ao carregar usuários");
  return response.json();
}

export async function fetchAdminBands() {
  const response = await adminFetch("/admin/bands");
  if (!response.ok) throw new Error("Falha ao carregar bandas");
  return response.json();
}

export async function setBandExempt(bandId: string, exempt: boolean, reason?: string) {
  const response = await adminFetch(`/admin/bands/${bandId}/exempt`, {
    method: "PATCH",
    body: JSON.stringify({ exempt, reason }),
  });
  if (!response.ok) throw new Error("Falha ao atualizar isenção");
}

export async function suspendBand(bandId: string) {
  const response = await adminFetch(`/admin/bands/${bandId}/suspend`, { method: "POST" });
  if (!response.ok) throw new Error("Falha ao suspender banda");
}

export async function suspendOverdueAccounts() {
  const response = await adminFetch("/admin/billing/suspend-overdue", { method: "POST" });
  if (!response.ok) throw new Error("Falha ao suspender contas em atraso");
  return response.json();
}

export async function sendMarketing(subject: string, body: string, audience = "all") {
  const response = await adminFetch("/admin/marketing/send", {
    method: "POST",
    body: JSON.stringify({ subject, body, audience }),
  });
  if (!response.ok) throw new Error("Falha ao enviar campanha");
  return response.json();
}
