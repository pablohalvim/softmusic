import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { modalOverlayClass, modalPanelClass } from "../../lib/ui-classes";

interface CifraLineModalProps {
  open: boolean;
  mode: "add" | "edit";
  initialNotas?: string;
  initialLetra?: string;
  onClose: () => void;
  onSave: (notas: string, letra: string) => void;
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-green-500/60";

const textareaClass =
  "w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-green-500/60";

export function CifraLineModal({
  open,
  mode,
  initialNotas = "",
  initialLetra = "",
  onClose,
  onSave,
}: CifraLineModalProps) {
  const [notas, setNotas] = useState(initialNotas);
  const [letra, setLetra] = useState(initialLetra);

  useEffect(() => {
    if (open) {
      setNotas(initialNotas);
      setLetra(initialLetra);
    }
  }, [open, initialNotas, initialLetra]);

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

  const canSubmit = notas.trim().length > 0 || letra.trim().length > 0;
  const isEdit = mode === "edit";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSave(notas, letra);
    onClose();
  };

  return (
    <div className={modalOverlayClass}>
      <div
        className={`${modalPanelClass} max-w-lg`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cifra-line-modal-title"
      >
        <h2 id="cifra-line-modal-title" className="text-lg font-semibold text-slate-100">
          {isEdit ? "Editar linha" : "Adicionar linha"}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {isEdit
            ? "Altere os acordes (separados por espaço) e o texto da linha."
            : "A nova linha será incluída ao final da última seção."}
        </p>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-slate-300">
            Notas
            <input
              autoFocus
              className={`${inputClass} mt-1.5 font-mono`}
              value={notas}
              onChange={(event) => setNotas(event.target.value)}
              placeholder="Ex.: Am G F C"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Letra
            <textarea
              className={`${textareaClass} mt-1.5 min-h-[5rem]`}
              value={letra}
              onChange={(event) => setLetra(event.target.value)}
              placeholder="Texto da linha (opcional se houver só acordes)"
              rows={3}
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
              disabled={!canSubmit}
              className="sm-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isEdit ? "Salvar" : "Adicionar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** @deprecated Use CifraLineModal */
export function AddCifraLineModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (notas: string, letra: string) => void;
}) {
  return (
    <CifraLineModal open={open} mode="add" onClose={onClose} onSave={onAdd} />
  );
}
