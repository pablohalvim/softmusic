import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { modalOverlayClass, modalPanelClass } from "../../lib/ui-classes";

interface ImportCifraVariationModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (cifraClubUrl: string) => Promise<void>;
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-green-500/60";

function isLikelyCifraClubUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname.replace(/^www\./, "") === "cifraclub.com.br";
  } catch {
    return false;
  }
}

export function ImportCifraVariationModal({
  open,
  onClose,
  onImport,
}: ImportCifraVariationModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, pending]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isLikelyCifraClubUrl(trimmed)) {
      setError("Informe um link válido do Cifra Club (cifraclub.com.br).");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onImport(trimmed);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Falha ao importar cifra");
      setPending(false);
    }
  };

  return (
    <div className={modalOverlayClass}>
      <div
        className={`${modalPanelClass} max-w-md`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-variation-title"
      >
        <h2 id="import-variation-title" className="text-lg font-semibold text-slate-100">
          Importar nova variação
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Cole o link do Cifra Club. A cifra será importada como uma nova variação salva nesta música.
        </p>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-slate-300">
            Link do Cifra Club
            <input
              autoFocus
              type="url"
              className={`${inputClass} mt-1.5`}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.cifraclub.com.br/artista/musica/"
              disabled={pending}
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
              onClick={onClose}
              disabled={pending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!url.trim() || pending}
              className="sm-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "Importando..." : "Importar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
