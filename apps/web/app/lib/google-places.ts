export type PlaceSelection = {
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string | null;
};

type GoogleMapsNamespace = {
  maps: {
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        opts?: {
          fields?: string[];
          componentRestrictions?: { country: string | string[] };
        },
      ) => {
        addListener: (event: string, handler: () => void) => void;
        getPlace: () => {
          formatted_address?: string;
          name?: string;
          place_id?: string;
          geometry?: { location?: { lat: () => number; lng: () => number } };
        };
      };
    };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNamespace;
    __softmusicMapsReady?: Promise<void>;
  }
}

export function getGoogleMapsApiKey(): string {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps só no browser"));
  }
  if (window.google?.maps?.places) {
    return Promise.resolve();
  }
  if (window.__softmusicMapsReady) {
    return window.__softmusicMapsReady;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY não configurada"));
  }

  window.__softmusicMapsReady = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=pt-BR`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar Google Maps"));
    document.head.appendChild(script);
  });

  return window.__softmusicMapsReady;
}

export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
