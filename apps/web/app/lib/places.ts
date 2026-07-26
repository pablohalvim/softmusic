import { authFetch } from "./api";

export type PlaceSelection = {
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string | null;
};

export type PlacePrediction = PlaceSelection & {
  description: string;
};

export async function fetchPlacePredictions(input: string): Promise<PlacePrediction[]> {
  const q = input.trim();
  if (q.length < 3) return [];

  const response = await authFetch(`/geo/autocomplete?q=${encodeURIComponent(q)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : "Não foi possível buscar endereços";
    throw new Error(detail);
  }
  const payload = (await response.json()) as { items?: PlacePrediction[] };
  const houseNumber = extractHouseNumber(q);
  return (payload.items ?? []).map((item) => {
    const base = item.formatted_address || item.description;
    const formatted = ensureHouseNumberInAddress(base, houseNumber);
    return {
      description: formatted,
      formatted_address: formatted,
      lat: Number(item.lat),
      lng: Number(item.lng),
      place_id: item.place_id ?? null,
    };
  });
}

/** Extrai número do imóvel digitado (ex.: "Rua X, 1720, Cidade"). */
export function extractHouseNumber(query: string): string | null {
  const matches = [
    ...query.matchAll(/(?:,\s*|\s+)(?:n[º°o]\.?\s*|n[uú]mero\s+)?(\d{1,5}[A-Za-z]?)\b(?!\s*-?\d{3})/gi),
  ];
  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 7) continue; // CEP
    return candidate;
  }
  return null;
}

function ensureHouseNumberInAddress(address: string, houseNumber: string | null): string {
  if (!houseNumber) return address;
  const escaped = houseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?<!\\d)${escaped}(?!\\d)`, "i").test(address)) {
    return address;
  }
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return `${address}, ${houseNumber}`;
  const [street, ...rest] = parts;
  return [street, houseNumber, ...rest].join(", ");
}

/** OSM já devolve lat/lng no autocomplete — normaliza e preserva o número digitado. */
export async function resolvePlaceDetails(
  prediction: PlacePrediction,
  queryHint?: string,
): Promise<PlaceSelection> {
  if (!Number.isFinite(prediction.lat) || !Number.isFinite(prediction.lng)) {
    throw new Error("Não foi possível obter a localização do endereço");
  }
  const houseNumber = extractHouseNumber(queryHint ?? "");
  const formatted = ensureHouseNumberInAddress(
    prediction.formatted_address || prediction.description,
    houseNumber,
  );
  return {
    formatted_address: formatted,
    lat: prediction.lat,
    lng: prediction.lng,
    place_id: prediction.place_id,
  };
}

export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
