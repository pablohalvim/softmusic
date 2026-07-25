import { useEffect, useRef, useState } from "react";

import { getGoogleMapsApiKey, loadGoogleMaps, type PlaceSelection } from "../lib/google-places";
import { inputClass, labelClass } from "../lib/ui-classes";

type Props = {
  label: string;
  value: PlaceSelection | null;
  onChange: (value: PlaceSelection | null) => void;
  disabled?: boolean;
};

export function PlacesAddressInput({ label, value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    if (!getGoogleMapsApiKey()) {
      setError("Configure VITE_GOOGLE_MAPS_API_KEY para buscar endereços.");
      return;
    }
    void loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current || !window.google?.maps?.places) return;
        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          fields: ["formatted_address", "geometry", "place_id", "name"],
          componentRestrictions: { country: "br" },
        });
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const loc = place.geometry?.location;
          if (!loc) {
            setError("Selecione um endereço da lista do Google");
            return;
          }
          setError(null);
          onChangeRef.current({
            formatted_address: place.formatted_address || place.name || "",
            lat: loc.lat(),
            lng: loc.lng(),
            place_id: place.place_id ?? null,
          });
        });
        setReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar Maps");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <label className={labelClass}>
      <span>{label}</span>
      <input
        ref={inputRef}
        disabled={disabled || !ready}
        className={inputClass}
        placeholder="Digite e selecione o endereço"
        defaultValue={value?.formatted_address ?? ""}
        onChange={() => {
          if (value) onChange(null);
        }}
      />
      {value ? (
        <span className="text-xs text-slate-500">
          Selecionado · {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </span>
      ) : null}
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </label>
  );
}
