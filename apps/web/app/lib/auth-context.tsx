import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  AUTH_CLEARED_EVENT,
  apiUrl,
  ensureFreshAccessToken,
  getJwtExpiryMs,
  refreshAccessToken,
} from "./api";
import {
  clearTokens,
  loadTokens,
  saveTokens,
  type AuthTokens,
} from "./auth-storage";

export interface AuthUser {
  id: string;
  full_name: string;
  email: string;
  cpf_masked?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  register: (payload: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function parseApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    return payload?.detail ?? payload?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Agenda renovação ~2 min antes do access expirar; com a página aberta, o token se renova sozinho. */
function scheduleAccessRefresh(refresh: () => Promise<unknown>): () => void {
  let timer: number | null = null;
  let cancelled = false;

  const arm = () => {
    if (cancelled) return;
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    const access = loadTokens()?.access_token;
    if (!access) return;
    const exp = getJwtExpiryMs(access);
    const delay =
      exp == null ? 60_000 : Math.max(5_000, exp - Date.now() - 120_000);
    timer = window.setTimeout(() => {
      void refresh().finally(() => {
        if (!cancelled) arm();
      });
    }, delay);
  };

  arm();
  return () => {
    cancelled = true;
    if (timer != null) window.clearTimeout(timer);
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async (token: string) => {
    const response = await fetch(`${apiUrl}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.softmusic.v1+json",
      },
    });
    if (!response.ok) {
      throw new Error("Sessão expirada");
    }
    const payload = await response.json();
    setUser(payload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cancelSchedule = () => undefined;

    async function bootstrap() {
      const tokens = loadTokens();
      if (!tokens) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        await ensureFreshAccessToken();
        const next = loadTokens();
        await fetchMe(next?.access_token ?? tokens.access_token);
      } catch {
        const refreshed = await refreshAccessToken();
        if (cancelled) return;
        if (refreshed) {
          const next = loadTokens();
          if (next?.access_token) {
            try {
              await fetchMe(next.access_token);
              return;
            } catch {
              /* cai no clear abaixo */
            }
          }
        }
        clearTokens();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap().then(() => {
      if (cancelled) return;
      cancelSchedule = scheduleAccessRefresh(() => ensureFreshAccessToken());
    });

    const onAuthCleared = () => {
      if (!cancelled) setUser(null);
    };
    window.addEventListener(AUTH_CLEARED_EVENT, onAuthCleared);

    // Voltou para a aba / foco na janela → renova se o access já tiver acabado.
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      void ensureFreshAccessToken();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      cancelled = true;
      cancelSchedule();
      window.removeEventListener(AUTH_CLEARED_EVENT, onAuthCleared);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [fetchMe]);

  const login = useCallback(async (loginValue: string, password: string) => {
    const response = await fetch(`${apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: loginValue, password }),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, "Falha no login"));
    }
    const payload = await response.json();
    const tokens: AuthTokens = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    };
    saveTokens(tokens);
    setUser(payload.user);
  }, []);

  const register = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(`${apiUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response, "Falha no cadastro"));
    }
    const payload = await response.json();
    const tokens: AuthTokens = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    };
    saveTokens(tokens);
    setUser(payload.user);
  }, []);

  const logout = useCallback(async () => {
    const tokens = loadTokens();
    if (tokens) {
      await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      }).catch(() => undefined);
    }
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      getAccessToken: () => loadTokens()?.access_token ?? null,
    }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }
  return ctx;
}
