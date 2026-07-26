export type PlaceSelection = {
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string | null;
};

export type PlacePrediction = {
  description: string;
  place_id: string;
};

type LatLng = { lat: () => number; lng: () => number };

type GoogleMapsNamespace = {
  maps: {
    places: {
      AutocompleteService: new () => {
        getPlacePredictions: (
          request: {
            input: string;
            componentRestrictions?: { country: string | string[] };
            types?: string[];
          },
          callback: (
            predictions: Array<{ description: string; place_id: string }> | null,
            status: string,
          ) => void,
        ) => void;
      };
      PlacesService: new (attrContainer: HTMLDivElement) => {
        getDetails: (
          request: { placeId: string; fields: string[] },
          callback: (
            place: {
              formatted_address?: string;
              name?: string;
              place_id?: string;
              geometry?: { location?: LatLng };
            } | null,
            status: string,
          ) => void,
        ) => void;
      };
      PlacesServiceStatus: { OK: string; ZERO_RESULTS: string };
    };
    event?: { clearInstanceListeners?: (instance: unknown) => void };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNamespace;
    __softmusicMapsReady?: Promise<void>;
    __softmusicMapsAuthFailed?: boolean;
    gm_authFailure?: () => void;
  }
}

type AuthFailureListener = (message: string) => void;
const authFailureListeners = new Set<AuthFailureListener>();

export const MAPS_AUTH_ERROR =
  "Google Maps recusou a chave nesta origem. No Cloud Console: ative Maps JavaScript API + Places API, vincule billing e libere o referrer (ex.: http://localhost:5173/* e https://app.softmusic.com.br/*).";

export function onGoogleMapsAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  if (typeof window !== "undefined" && window.__softmusicMapsAuthFailed) {
    listener(MAPS_AUTH_ERROR);
  }
  return () => {
    authFailureListeners.delete(listener);
  };
}

function notifyAuthFailure() {
  if (typeof window === "undefined") return;
  window.__softmusicMapsAuthFailed = true;
  for (const listener of authFailureListeners) {
    listener(MAPS_AUTH_ERROR);
  }
  // Remove o diálogo branco padrão do Google (não dá para estilizar).
  queueMicrotask(() => {
    document.querySelectorAll("div").forEach((el) => {
      const text = el.textContent ?? "";
      if (
        text.includes("não carregou o Google Maps corretamente") ||
        text.includes("didn't load Google Maps correctly")
      ) {
        const dialog = el.closest("[role='dialog']") ?? el.parentElement;
        if (dialog instanceof HTMLElement && dialog !== document.body) {
          dialog.style.display = "none";
        }
      }
    });
  });
}

export function getGoogleMapsApiKey(): string {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps só no browser"));
  }
  if (window.__softmusicMapsAuthFailed) {
    return Promise.reject(new Error(MAPS_AUTH_ERROR));
  }
  if (window.google?.maps?.places) {
    return Promise.resolve();
  }
  if (window.__softmusicMapsReady) {
    return window.__softmusicMapsReady;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY não configurada no build da web."));
  }

  // Callback global oficial do Google — precisa existir antes do script.
  window.gm_authFailure = () => {
    notifyAuthFailure();
  };

  window.__softmusicMapsReady = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=pt-BR&loading=async`;
    script.async = true;
    script.onload = () => {
      if (window.__softmusicMapsAuthFailed) {
        reject(new Error(MAPS_AUTH_ERROR));
        return;
      }
      // Auth failure às vezes chega logo após o load.
      window.setTimeout(() => {
        if (window.__softmusicMapsAuthFailed) {
          reject(new Error(MAPS_AUTH_ERROR));
        } else if (!window.google?.maps?.places) {
          reject(new Error("Google Places não disponível nesta chave"));
        } else {
          resolve();
        }
      }, 100);
    };
    script.onerror = () => {
      window.__softmusicMapsReady = undefined;
      reject(new Error("Falha ao carregar o script do Google Maps"));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    window.__softmusicMapsReady = undefined;
    throw err;
  });

  return window.__softmusicMapsReady;
}

export async function fetchPlacePredictions(input: string): Promise<PlacePrediction[]> {
  await loadGoogleMaps();
  if (window.__softmusicMapsAuthFailed) {
    throw new Error(MAPS_AUTH_ERROR);
  }
  const service = new window.google!.maps.places.AutocompleteService();
  return new Promise((resolve, reject) => {
    service.getPlacePredictions(
      {
        input,
        componentRestrictions: { country: "br" },
      },
      (predictions, status) => {
        if (window.__softmusicMapsAuthFailed) {
          reject(new Error(MAPS_AUTH_ERROR));
          return;
        }
        if (status === "ZERO_RESULTS" || !predictions?.length) {
          resolve([]);
          return;
        }
        if (status !== "OK") {
          reject(new Error(`Falha na busca de endereços (${status})`));
          return;
        }
        resolve(
          predictions.map((item) => ({
            description: item.description,
            place_id: item.place_id,
          })),
        );
      },
    );
  });
}

export async function resolvePlaceDetails(placeId: string): Promise<PlaceSelection> {
  await loadGoogleMaps();
  const holder = document.createElement("div");
  const service = new window.google!.maps.places.PlacesService(holder);
  return new Promise((resolve, reject) => {
    service.getDetails(
      {
        placeId,
        fields: ["formatted_address", "geometry", "place_id", "name"],
      },
      (place, status) => {
        if (status !== "OK" || !place?.geometry?.location) {
          reject(new Error("Não foi possível obter a localização do endereço"));
          return;
        }
        resolve({
          formatted_address: place.formatted_address || place.name || "",
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          place_id: place.place_id ?? placeId,
        });
      },
    );
  });
}

export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
