import type { FormEvent } from "react";
import { useEffect, useState } from "react";

interface FoundChordsBarProps {
  chords: string[];
  onReplace: (fromDisplay: string, toDisplay: string) => void;
  editable?: boolean;
}

export function FoundChordsBar({ chords, onReplace, editable = false }: FoundChordsBarProps) {
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [replacement, setReplacement] = useState("");

  useEffect(() => {
    if (!editable) {
      setSelectedChord(null);
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-found-chord-menu]") || target.closest("[data-found-chord-trigger]")) {
        return;
      }
      setSelectedChord(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [editable]);

  if (chords.length === 0) return null;

  const openEditor = (chord: string) => {
    setSelectedChord(chord);
    setReplacement(chord);
  };

  const submitReplacement = (event?: FormEvent) => {
    event?.preventDefault();
    if (!selectedChord) return;
    const trimmed = replacement.trim();
    if (!trimmed || trimmed === selectedChord) {
      setSelectedChord(null);
      return;
    }
    onReplace(selectedChord, trimmed);
    setSelectedChord(null);
  };

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Acordes na cifra</p>
      <div className="flex flex-wrap gap-2 font-mono text-sm">
        {chords.map((chord) => {
          const isSelected = selectedChord === chord;
          return (
            <span key={chord} className="relative">
              {isSelected ? (
                <form
                  data-found-chord-menu
                  className="absolute bottom-full left-0 z-30 mb-1 flex min-w-[10rem] flex-col gap-2 rounded-lg border border-slate-600 bg-slate-900 p-2 shadow-xl"
                  onSubmit={submitReplacement}
                >
                  <p className="text-[10px] text-slate-400">
                    Trocar <strong className="text-orange-300">{chord}</strong> em toda a cifra
                  </p>
                  <input
                    autoFocus
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                    className="w-full rounded border border-orange-500/50 bg-slate-950 px-2 py-1 text-center font-bold text-orange-400 outline-none ring-1 ring-orange-500/30"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setSelectedChord(null);
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="rounded bg-orange-500 px-2 py-1 text-xs font-medium text-slate-950 hover:bg-orange-400"
                  >
                    Aplicar em toda cifra
                  </button>
                </form>
              ) : null}

              {editable ? (
                <button
                  type="button"
                  data-found-chord-trigger
                  className={`rounded-lg border px-2.5 py-1 font-bold transition ${
                    isSelected
                      ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                      : "border-slate-700 bg-slate-950/50 text-orange-400 hover:border-orange-500/40 hover:text-orange-300"
                  }`}
                  onClick={() => openEditor(chord)}
                  title="Clique para trocar este acorde em toda a cifra"
                >
                  {chord}
                </button>
              ) : (
                <span className="rounded-lg border border-slate-700 bg-slate-950/50 px-2.5 py-1 font-bold text-orange-400">
                  {chord}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
