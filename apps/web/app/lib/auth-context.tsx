import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { apiUrl } from "./api";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async (token: string) => {
    const response = await fetch(`${apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error("Sessão expirada");
    }
    const payload = await response.json();
    setUser(payload);
  }, []);

  useEffect(() => {
    const tokens = loadTokens();
    if (!tokens) {
      setLoading(false);
      return;
    }
    fetchMe(tokens.access_token)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
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
