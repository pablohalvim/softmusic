import { AuthenticatedAudio } from "../AuthenticatedAudio";

interface StemInfo {
  name: string;
  file: string;
  duration_seconds: number;
  role: string;
  available?: boolean;
}

interface StemsResponse {
  song_id: string;
  separated: boolean;
  model?: string;
  backend?: string;
  stems: StemInfo[];
  message?: string;
}

const STEM_LABELS: Record<string, string> = {
  drums: "Bateria",
  bass: "Baixo",
  vocals: "Vocal",
  guitar: "Guitarra / Violão",
  piano: "Teclado / Piano",
  other: "Outros instrumentos",
};

interface StemsPanelProps {
  songId: string;
  stems: StemsResponse;
}

export function StemsPanel({ songId, stems }: StemsPanelProps) {
  if (!stems.separated || stems.stems.length === 0) {
    return (
      <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:col-span-2">
        <h2 className="font-medium">Separação de stems</h2>
        <p className="mt-2 text-sm text-slate-400">
          {stems.message ??
            "Stems ainda não gerados. Reprocesse a análise para ativar Demucs (bateria, baixo, guitarra/violão, teclado/piano, vocal e outros)."}
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Stems separados (Demucs)</h2>
          <p className="mt-1 text-sm text-slate-400">
            Modelo {stems.model ?? "htdemucs"} · backend {stems.backend ?? "cpu"}
          </p>
        </div>
        <span className="rounded-full border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-1 text-xs text-emerald-200">
          {stems.stems.length} faixas
        </span>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {stems.stems.map((stem) => {
          const label = STEM_LABELS[stem.name] ?? stem.name;
          const isAvailable = stem.available !== false;
          const audioPath = `/songs/${songId}/stems/${encodeURIComponent(stem.name)}/audio`;

          return (
            <li
              key={stem.name}
              className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-slate-100">{label}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {Math.round(stem.duration_seconds)}s · {stem.role}
                </p>
              </div>

              {isAvailable ? (
                <AuthenticatedAudio
                  path={audioPath}
                  className="h-9 min-w-0 flex-1"
                  label={`Reproduzir stem ${label}`}
                  downloadName={stem.file}
                />
              ) : (
                <p className="mt-3 text-xs text-amber-300/80">Arquivo indisponível no storage.</p>
              )}

              <p className="mt-2 font-mono text-[11px] text-slate-600">{stem.file}</p>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
