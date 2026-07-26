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
  return (payload.items ?? []).map((item) => ({
    description: item.description || item.formatted_address,
    formatted_address: item.formatted_address || item.description,
    lat: Number(item.lat),
    lng: Number(item.lng),
    place_id: item.place_id ?? null,
  }));
}

/** Photon já devolve lat/lng no autocomplete — só normaliza a seleção. */
export async function resolvePlaceDetails(prediction: PlacePrediction): Promise<PlaceSelection> {
  if (!Number.isFinite(prediction.lat) || !Number.isFinite(prediction.lng)) {
    throw new Error("Não foi possível obter a localização do endereço");
  }
  return {
    formatted_address: prediction.formatted_address || prediction.description,
    lat: prediction.lat,
    lng: prediction.lng,
    place_id: prediction.place_id,
  };
}

export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
