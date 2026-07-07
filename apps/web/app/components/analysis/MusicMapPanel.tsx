import { buildMusicMap, degreeLabel, type MusicMap } from "@softmusic/shared/harmony";
import type { ReactNode } from "react";

interface MusicMapPanelProps {
  durationSeconds: number;
  sections: Array<{
    type: string;
    start_seconds: number;
    end_seconds: number;
  }>;
  progression: Array<{
    start_seconds: number;
    end_seconds: number;
    chord: string;
  }>;
  keyName: string;
  mode: string;
}

const SECTION_COLORS: Record<string, string> = {
  intro: "bg-slate-500",
  verse: "bg-green-500",
  pre_chorus: "bg-violet-500",
  chorus: "bg-orange-500",
  bridge: "bg-purple-500",
  instrumental: "bg-cyan-600",
  solo: "bg-pink-500",
  interlude: "bg-teal-600",
  break: "bg-yellow-600",
  build_up: "bg-amber-500",
  drop: "bg-red-500",
  ending: "bg-slate-600",
  outro: "bg-slate-600",
};

const CHORD_COLORS: Record<string, string> = {
  tonic: "bg-emerald-600",
  subdominant: "bg-blue-600",
  dominant: "bg-orange-600",
  other: "bg-slate-600",
};

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function TimelineRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <div className="relative h-10 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
        {children}
      </div>
    </div>
  );
}

function SectionBlock({ item }: { item: MusicMap["sections"][number] }) {
  return (
    <div
      className={`absolute top-0 flex h-full items-center justify-center overflow-hidden border-r border-slate-950/40 px-1 text-[10px] font-medium text-white ${SECTION_COLORS[item.type] ?? "bg-slate-600"}`}
      style={{ left: `${item.leftPercent}%`, width: `${item.widthPercent}%` }}
      title={`${item.label} (${formatTime(item.start_seconds)} – ${formatTime(item.end_seconds)})`}
    >
      <span className="truncate">{item.label}</span>
    </div>
  );
}

function ChordBlock({ item }: { item: MusicMap["chords"][number] }) {
  const degreeText = item.degree ? degreeLabel(item.degree) : "?";
  return (
    <div
      className={`absolute top-0 flex h-full flex-col items-center justify-center overflow-hidden border-r border-slate-950/40 px-0.5 text-[10px] text-white ${CHORD_COLORS[item.function]}`}
      style={{ left: `${item.leftPercent}%`, width: `${item.widthPercent}%` }}
      title={`${item.chord} (${item.roman}) — ${degreeText} grau`}
    >
      <span className="truncate font-semibold">{item.chord}</span>
      <span className="truncate opacity-80">{item.roman}</span>
    </div>
  );
}

export function MusicMapPanel({
  durationSeconds,
  sections,
  progression,
  keyName,
  mode,
}: MusicMapPanelProps) {
  const map = buildMusicMap({
    duration_seconds: durationSeconds,
    sections,
    progression,
    key: keyName,
    mode,
  });

  return (
    <article className="rounded-xl border border-slate-800 p-4 md:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-medium">Mapa da música</h2>
          <p className="mt-1 text-sm text-slate-400">
            Estrutura formal e acordes ao longo de {formatTime(map.duration_seconds)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-green-500" /> Seções
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-600" /> Tônica
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-blue-600" /> Subdominante
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-orange-600" /> Dominante
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <TimelineRow label="Estrutura">
          {map.sections.map((section) => (
            <SectionBlock key={section.id} item={section} />
          ))}
        </TimelineRow>

        <TimelineRow label="Harmonia (acordes detectados)">
          {map.chords.length > 0 ? (
            map.chords.map((chord, index) => <ChordBlock key={`${chord.chord}-${index}`} item={chord} />)
          ) : (
            <div className="flex h-full items-center px-3 text-xs text-slate-500">
              Nenhum acorde detectado na progressão.
            </div>
          )}
        </TimelineRow>
      </div>

      {map.sections.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {map.sections.map((section) => (
            <li
              key={section.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm"
            >
              <span>{section.label}</span>
              <span className="text-xs text-slate-500">
                {formatTime(section.start_seconds)} – {formatTime(section.end_seconds)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
