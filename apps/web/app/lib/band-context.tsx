import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { BandSummary } from "@softmusic/types";

import { authFetch } from "./api";
import { clearActiveBandId, loadActiveBandId, saveActiveBandId } from "./auth-storage";
import { useAuth } from "./auth-context";

interface RefreshBandsOptions {
  /** Evita flash de "Carregando..." em atualizações em background. */
  silent?: boolean;
}

interface BandContextValue {
  bands: BandSummary[];
  activeBand: BandSummary | null;
  loading: boolean;
  setActiveBandId: (bandId: string) => void;
  refreshBands: (options?: RefreshBandsOptions) => Promise<void>;
  patchBand: (bandId: string, patch: Partial<BandSummary>) => void;
  createBand: (name: string, planCode: string) => Promise<BandSummary>;
}

const BandContext = createContext<BandContextValue | null>(null);

export function BandProvider({ children }: { children: React.ReactNode }) {
  const { user, getAccessToken } = useAuth();
  const [bands, setBands] = useState<BandSummary[]>([]);
  const [activeBandId, setActiveBandIdState] = useState<string | null>(loadActiveBandId);
  const [loading, setLoading] = useState(true);

  const refreshBands = useCallback(async (options?: RefreshBandsOptions) => {
    if (!getAccessToken()) {
      setBands([]);
      setActiveBandIdState(null);
      setLoading(false);
      return;
    }
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    try {
      const response = await authFetch("/bands");
      if (!response.ok) {
        throw new Error("Não foi possível carregar bandas");
      }
      const payload = await response.json();
      const items: BandSummary[] = payload.items ?? [];
      setBands(items);
      // Aplica localStorage assim que a lista chega — antes de qualquer tela decidir redirect.
      const stored = loadActiveBandId();
      if (stored && items.some((b) => b.id === stored)) {
        setActiveBandIdState(stored);
      } else if (items.length > 0) {
        saveActiveBandId(items[0].id);
        setActiveBandIdState(items[0].id);
      } else {
        clearActiveBandId();
        setActiveBandIdState(null);
      }
    } catch {
      // Não zera bands em falha transitória — evita AuthGuard mandar para /bandas.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (user) {
      void refreshBands();
    } else {
      setBands([]);
      setActiveBandIdState(null);
      setLoading(false);
    }
  }, [user, refreshBands]);

  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      void refreshBands({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, refreshBands]);

  const setActiveBandId = useCallback((bandId: string) => {
    saveActiveBandId(bandId);
    setActiveBandIdState(bandId);
  }, []);

  const patchBand = useCallback((bandId: string, patch: Partial<BandSummary>) => {
    setBands((prev) => prev.map((band) => (band.id === bandId ? { ...band, ...patch } : band)));
  }, []);

  const createBand = useCallback(async (name: string, planCode: string) => {
    const response = await authFetch("/bands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, plan_code: planCode }),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text || "Não foi possível criar a banda";
      try {
        const payload = JSON.parse(text) as {
          error?: { message?: string };
          detail?: string;
        };
        message = payload.error?.message ?? payload.detail ?? message;
      } catch {
        // resposta não-JSON (ex.: HTML de proxy)
      }
      throw new Error(message);
    }
    const band: BandSummary = await response.json();
    await refreshBands();
    setActiveBandId(band.id);
    return band;
  }, [refreshBands, setActiveBandId]);

  const activeBand = useMemo(
    () => bands.find((b) => b.id === activeBandId) ?? null,
    [bands, activeBandId],
  );

  const value = useMemo<BandContextValue>(
    () => ({
      bands,
      activeBand,
      loading,
      setActiveBandId,
      refreshBands,
      patchBand,
      createBand,
    }),
    [bands, activeBand, loading, setActiveBandId, refreshBands, patchBand, createBand],
  );

  return <BandContext.Provider value={value}>{children}</BandContext.Provider>;
}

export function useBand(): BandContextValue {
  const ctx = useContext(BandContext);
  if (!ctx) {
    throw new Error("useBand deve ser usado dentro de BandProvider");
  }
  return ctx;
}
