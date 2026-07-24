import type { EditableCifraSheet } from "@softmusic/shared/cifra-layout";

import { authFetch } from "../../lib/api";
import { loadActiveBandId } from "../../lib/auth-storage";
import type { CifraKeyOverride } from "./cifra-key";

export const OFFICIAL_CIFRA_VARIATION_NAME = "Versão oficial";

export interface CifraVariationSnapshot {
  transposeSemitones: number;
  capo: number;
  sectionChords: Record<string, string[]>;
  isImported: boolean;
  importedSheet: EditableCifraSheet | null;
  keyOverride?: CifraKeyOverride | null;
}

export interface CifraVariation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: CifraVariationSnapshot;
}

function variationsStorageKey(songId: string): string {
  // Escopa o cache local por banda para que variações de uma banda não vazem
  // para outra no mesmo dispositivo/navegador.
  const bandId = loadActiveBandId();
  return bandId
    ? `softmusic:cifra-variations:${bandId}:${songId}`
    : `softmusic:cifra-variations:${songId}`;
}

export function mergeCifraVariations(local: CifraVariation[], server: CifraVariation[]): CifraVariation[] {
  const map = new Map<string, CifraVariation>();
  for (const variation of local) {
    map.set(variation.id, variation);
  }
  for (const variation of server) {
    map.set(variation.id, variation);
  }
  return Array.from(map.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function serverVariationToLocal(variation: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: CifraVariationSnapshot;
}): CifraVariation {
  return {
    id: variation.id,
    name: variation.name,
    createdAt: variation.createdAt,
    updatedAt: variation.updatedAt,
    snapshot: variation.snapshot,
  };
}

export function upsertServerVariationToStorage(songId: string, variation: CifraVariation): void {
  const existing = loadCifraVariations(songId);
  // Ao sincronizar do servidor, remove cópias locais com o mesmo nome (IDs antigos só no device).
  const withoutSameName = existing.filter(
    (item) =>
      item.id === variation.id || item.name.toLowerCase() !== variation.name.toLowerCase(),
  );
  const merged = mergeCifraVariations(withoutSameName, [variation]);
  saveCifraVariations(songId, merged);
}

function parseVariationError(response: Response, fallback: string): Promise<never> {
  return response.json().catch(() => null).then((error) => {
    const payload = error as {
      error?: { message?: string };
      detail?: string | Array<{ msg?: string }>;
    } | null;
    const detail = payload?.detail;
    const detailMessage = Array.isArray(detail)
      ? detail.map((item) => item.msg).filter(Boolean).join("; ")
      : detail;
    throw new Error(payload?.error?.message ?? detailMessage ?? fallback);
  });
}

export async function saveCifraVariationToServer(
  songId: string,
  name: string,
  snapshot: CifraVariationSnapshot,
): Promise<CifraVariation> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome da variação é obrigatório");
  }

  const response = await authFetch(`/songs/${songId}/cifra-variations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: trimmed, snapshot }),
  });

  if (!response.ok) {
    await parseVariationError(response, "Falha ao salvar variação da cifra");
  }

  const data = (await response.json()) as {
    variation: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      snapshot: CifraVariationSnapshot;
    };
  };
  const variation = serverVariationToLocal(data.variation);
  upsertServerVariationToStorage(songId, variation);
  return variation;
}

export async function importCifraVariationFromUrl(
  songId: string,
  cifraClubUrl: string,
): Promise<CifraVariation> {
  const response = await authFetch(`/songs/${songId}/cifra-variations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cifra_club_url: cifraClubUrl.trim() }),
  });

  if (!response.ok) {
    await parseVariationError(response, "Falha ao importar cifra do Cifra Club");
  }

  const data = (await response.json()) as {
    variation: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      snapshot: CifraVariationSnapshot;
    };
  };
  const variation = serverVariationToLocal(data.variation);
  upsertServerVariationToStorage(songId, variation);
  return variation;
}

async function syncLocalOnlyVariations(
  songId: string,
  local: CifraVariation[],
  server: CifraVariation[],
): Promise<CifraVariation[]> {
  const serverIds = new Set(server.map((variation) => variation.id));
  const localOnly = local.filter((variation) => !serverIds.has(variation.id));
  if (localOnly.length === 0) {
    return server;
  }

  const synced = [...server];
  for (const variation of localOnly) {
    try {
      const saved = await saveCifraVariationToServer(songId, variation.name, variation.snapshot);
      const withoutSameName = synced.filter(
        (item) => item.name.toLowerCase() !== saved.name.toLowerCase(),
      );
      synced.length = 0;
      synced.push(...withoutSameName, saved);
    } catch {
      // Mantém a cópia local se o sync falhar (offline / permissão).
      synced.push(variation);
    }
  }
  return mergeCifraVariations([], synced);
}

export async function fetchCifraVariations(songId: string): Promise<CifraVariation[]> {
  const local = loadCifraVariations(songId);
  try {
    const response = await authFetch(`/songs/${songId}/cifra-variations`);
    if (!response.ok) {
      return local;
    }
    const data = (await response.json()) as {
      items: Array<{
        id: string;
        name: string;
        createdAt: string;
        updatedAt: string;
        snapshot: CifraVariationSnapshot;
      }>;
    };
    const server = data.items.map(serverVariationToLocal);
    const synced = await syncLocalOnlyVariations(songId, local, server);
    saveCifraVariations(songId, synced);
    return synced;
  } catch {
    return local;
  }
}

export function loadCifraVariations(songId: string): CifraVariation[] {
  try {
    const raw = localStorage.getItem(variationsStorageKey(songId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CifraVariation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCifraVariations(songId: string, variations: CifraVariation[]): void {
  localStorage.setItem(variationsStorageKey(songId), JSON.stringify(variations));
}

/** @deprecated Prefer saveCifraVariationToServer — mantido só para fallback offline. */
export function upsertCifraVariation(
  songId: string,
  name: string,
  snapshot: CifraVariationSnapshot,
): CifraVariation {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome da variação é obrigatório");
  }

  const variations = loadCifraVariations(songId);
  const now = new Date().toISOString();
  const existingIndex = variations.findIndex(
    (variation) => variation.name.toLowerCase() === trimmed.toLowerCase(),
  );

  if (existingIndex >= 0) {
    const existing = variations[existingIndex]!;
    const updated: CifraVariation = {
      ...existing,
      name: trimmed,
      updatedAt: now,
      snapshot,
    };
    variations[existingIndex] = updated;
    saveCifraVariations(songId, variations);
    return updated;
  }

  const created: CifraVariation = {
    id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    snapshot,
  };
  saveCifraVariations(songId, [...variations, created]);
  return created;
}

export function deleteCifraVariation(songId: string, variationId: string): void {
  const variations = loadCifraVariations(songId).filter((variation) => variation.id !== variationId);
  saveCifraVariations(songId, variations);
}
