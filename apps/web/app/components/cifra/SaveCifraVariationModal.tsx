import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { modalOverlayClass, modalPanelClass } from "../../lib/ui-classes";

interface SaveCifraVariationModalProps {
  open: boolean;
  defaultName?: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-green-500/60";

export function SaveCifraVariationModal({
  open,
  defaultName = "",
  onClose,
  onSave,
}: SaveCifraVariationModalProps) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (open) {
      setName(defaultName);
    }
  }, [open, defaultName]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <div className={modalOverlayClass}>
      <div
        className={`${modalPanelClass} max-w-md`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-variation-title"
      >
        <h2 id="save-variation-title" className="text-lg font-semibold text-slate-100">
          Salvar variação
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Guarde tom, capo e edições da cifra para trocar depois.
        </p>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-slate-300">
            Nome da variação
            <input
              autoFocus
              className={`${inputClass} mt-1.5`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Capo 2 · Tom G"
              maxLength={80}
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="sm-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
