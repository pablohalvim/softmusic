import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  fetchPlacePredictions,
  resolvePlaceDetails,
  type PlacePrediction,
  type PlaceSelection,
} from "../lib/places";
import { inputClass, labelClass } from "../lib/ui-classes";

type Props = {
  label: string;
  value: PlaceSelection | null;
  onChange: (value: PlaceSelection | null) => void;
  disabled?: boolean;
};

type DropdownCoords = {
  top: number;
  left: number;
  width: number;
};

export function PlacesAddressInput({ label, value, onChange, disabled }: Props) {
  const listId = useId();
  const inputId = useId();
  const [query, setQuery] = useState(value?.formatted_address ?? "");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyDetail, setBusyDetail] = useState(false);
  const [coords, setCoords] = useState<DropdownCoords | null>(null);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value?.formatted_address) {
      setQuery(value.formatted_address);
    }
  }, [value?.formatted_address, value?.place_id]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      const list = document.getElementById(listId);
      if (list?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [listId]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }

    const update = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };

    update();
    window.addEventListener("resize", update);
    // capture: acompanha scroll de qualquer container pai
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, predictions.length]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    if (value?.formatted_address && trimmed === value.formatted_address) {
      setPredictions([]);
      setOpen(false);
      return;
    }

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setLoading(true);
      void fetchPlacePredictions(trimmed)
        .then((items) => {
          setPredictions(items);
          setOpen(items.length > 0);
          setError(null);
        })
        .catch((err) => {
          setPredictions([]);
          setOpen(false);
          setError(err instanceof Error ? err.message : "Erro ao buscar endereços");
        })
        .finally(() => setLoading(false));
    }, 400);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [query, value?.formatted_address]);

  async function selectPrediction(prediction: PlacePrediction) {
    setBusyDetail(true);
    setOpen(false);
    try {
      const place = await resolvePlaceDetails(prediction, query);
      setQuery(place.formatted_address);
      setError(null);
      onChange(place);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao resolver endereço");
    } finally {
      setBusyDetail(false);
    }
  }

  const dropdown =
    open && predictions.length > 0 && coords
      ? createPortal(
          <ul
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              zIndex: 9999,
            }}
            className="max-h-56 overflow-auto rounded-xl border border-white/10 bg-[#0a1610] py-1 shadow-2xl shadow-black/50"
          >
            {predictions.map((item, index) => (
              <li key={item.place_id ?? `${item.lat},${item.lng},${index}`}>
                <button
                  type="button"
                  role="option"
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-green-500/15 hover:text-green-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void selectPrediction(item)}
                >
                  {item.description}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="relative space-y-1.5">
      <label htmlFor={inputId} className={labelClass}>
        <span>{label}</span>
        <input
          id={inputId}
          name="address-search"
          ref={inputRef}
          disabled={disabled || busyDetail}
          className={inputClass}
          placeholder="Digite o endereço e escolha uma sugestão"
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => {
            if (predictions.length > 0) setOpen(true);
          }}
        />
      </label>

      {dropdown}

      {loading || busyDetail ? (
        <p className="text-xs text-slate-500">{busyDetail ? "Confirmando localização..." : "Buscando..."}</p>
      ) : (
        <p className="text-xs text-slate-600">Sugestões via OpenStreetMap</p>
      )}

      {value ? (
        <p className="text-xs text-slate-500">
          Selecionado · {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs leading-relaxed text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
