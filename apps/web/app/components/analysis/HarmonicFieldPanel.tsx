import {
  buildHarmonicField,
  degreeLabel,
  type HarmonicFieldDegree,
  type ProgressionDegreeSummary,
} from "@softmusic/shared/harmony";

interface HarmonicFieldPanelProps {
  keyName: string;
  mode: string;
  scale: string[];
  degreeUsage: ProgressionDegreeSummary[];
}

const FUNCTION_COLORS: Record<string, string> = {
  tonic: "border-emerald-700/60 bg-emerald-950/30 text-emerald-200",
  subdominant: "border-blue-700/60 bg-blue-950/30 text-blue-200",
  dominant: "border-orange-700/60 bg-orange-950/30 text-orange-200",
  other: "border-slate-700/60 bg-slate-900/40 text-slate-300",
};

function isDegreeUsed(degree: number, usage: ProgressionDegreeSummary[]): boolean {
  return usage.some((item) => item.degree === degree);
}

function DegreeBadge({ degree, active }: { degree: number; active: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-500"
      }`}
    >
      {degreeLabel(degree)}
    </span>
  );
}

function FieldRow({ item, active }: { item: HarmonicFieldDegree; active: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        active ? "border-indigo-600/70 bg-indigo-950/20" : "border-slate-800 bg-slate-900/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <DegreeBadge degree={item.degree} active={active} />
        <span className="font-mono text-sm font-medium text-white">{item.chord}</span>
        <span className="text-xs text-slate-500">{item.roman}</span>
      </div>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${FUNCTION_COLORS[item.function]}`}>
        {item.functionLabel}
      </span>
    </div>
  );
}

export function HarmonicFieldPanel({ keyName, mode, scale, degreeUsage }: HarmonicFieldPanelProps) {
  const field = buildHarmonicField(keyName, mode);
  const scaleText = scale.length > 0 ? scale.join(" · ") : field.map((item) => item.note).join(" · ");

  return (
    <article className="rounded-xl border border-slate-800 p-4 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Campo harmônico</h2>
          <p className="mt-1 text-sm text-slate-400">
            {keyName} {mode} — escala: {scaleText}
          </p>
        </div>
        {degreeUsage.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {degreeUsage.map((item) => (
              <span
                key={item.degree}
                className="rounded-full border border-indigo-700/50 bg-indigo-950/40 px-2.5 py-1 text-xs text-indigo-100"
              >
                {degreeLabel(item.degree)} ({item.roman}) · {item.percentage}%
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Graus destacados aparecem na progressão detectada (1ª = tônica, 3ª = mediana, 6ª = submediante).
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {field.map((item) => (
          <FieldRow key={item.degree} item={item} active={isDegreeUsed(item.degree, degreeUsage)} />
        ))}
      </div>
    </article>
  );
}
