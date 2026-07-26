import { useEffect, useState } from "react";

import { authFetch } from "../../lib/api";
import { panelClass } from "../../lib/ui-classes";
import { stemLabel, type StemsManifest } from "../audio/stem-labels";

interface StemsPanelProps {
  songId: string;
  stems: StemsManifest;
}

export function StemsPanel({ songId, stems }: StemsPanelProps) {
  if (!stems.separated || stems.stems.length === 0) {
    return (
      <article className={`${panelClass} md:col-span-2`}>
        <h2 className="font-medium">Separação de stems</h2>
        <p className="mt-2 text-sm text-slate-400">
          {stems.message ??
            "Stems ainda não gerados. Reprocesse a análise para ativar Demucs (bateria, baixo, guitarra/violão, teclado/piano, vocal e outros)."}
        </p>
      </article>
    );
  }

  return (
    <article className={`${panelClass} md:col-span-2`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Stems separados (Demucs)</h2>
          <p className="mt-1 text-sm text-slate-400">
            Modelo {stems.model ?? "htdemucs"} · backend {stems.backend ?? "cpu"}
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Para treinar (ex.: sem baixo), use o player acima no modo <span className="text-green-300">Stems</span>{" "}
            e marque as faixas desejadas — elas tocam juntas com uma barra de tempo única.
          </p>
        </div>
        <span className="rounded-full border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1 text-xs text-emerald-200">
          {stems.stems.length} faixas
        </span>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {stems.stems.map((stem) => {
          const label = stemLabel(stem.name);
          const isAvailable = stem.available !== false;
          const audioPath = `/songs/${songId}/stems/${encodeURIComponent(stem.name)}/audio`;

          return (
            <li
              key={stem.name}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-100">{label}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {Math.round(stem.duration_seconds)}s · {stem.role}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-slate-600">{stem.file}</p>
                </div>
                {isAvailable ? (
                  <StemDownloadButton path={audioPath} downloadName={stem.file} />
                ) : (
                  <p className="text-xs text-amber-300/80">Indisponível</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function StemDownloadButton({ path, downloadName }: { path: string; downloadName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [path]);

  async function handleDownload() {
    setBusy(true);
    setError(false);
    try {
      const response = await authFetch(path);
      if (!response.ok) {
        setError(true);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={busy}
        className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-green-500/50 hover:text-green-200 disabled:opacity-50"
      >
        {busy ? "…" : "Salvar"}
      </button>
      {error ? <p className="mt-1 text-[11px] text-amber-300/80">Falha</p> : null}
    </div>
  );
}
