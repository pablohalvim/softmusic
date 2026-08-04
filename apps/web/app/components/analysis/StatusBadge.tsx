import { labelJobStatus, labelJobStage, labelQueuePosition, statusTone } from "../../lib/status-labels";

const toneClasses = {
  neutral: "border-slate-700 bg-slate-800/60 text-slate-300",
  active: "border-green-700/60 bg-green-950/40 text-green-200",
  success: "border-emerald-800/60 bg-emerald-950/30 text-emerald-200",
  error: "border-red-800/60 bg-red-950/30 text-red-200",
} as const;

export function StatusBadge({
  status,
  kind = "job",
}: {
  status: string;
  kind?: "job" | "song";
}) {
  const tone = statusTone(status as never);
  const label =
    kind === "song"
      ? status === "pending"
        ? "Aguardando"
        : status === "processing"
          ? "Processando"
          : status === "completed"
            ? "Concluída"
            : status === "failed"
              ? "Falhou"
              : status
      : labelJobStatus(status as never);

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-green-500 transition-all duration-500"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

export function JobProgressDetails({
  status,
  stage,
  progress,
  error,
  queuePosition,
  queueTotal,
}: {
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  queuePosition?: number | null;
  queueTotal?: number | null;
}) {
  const queueLabel =
    status === "queued" ? labelQueuePosition(queuePosition, queueTotal) : null;
  const stageLabel =
    status === "queued" && queueLabel
      ? queueLabel
      : labelJobStage(stage);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {queueLabel ? (
            <span className="inline-flex rounded-full border border-amber-700/50 bg-amber-950/30 px-2.5 py-0.5 text-xs font-medium text-amber-200">
              {queuePosition}º na fila
            </span>
          ) : null}
        </div>
        <span className="text-slate-400">{progress}%</span>
      </div>
      <ProgressBar value={progress} />
      <p className="text-sm text-slate-300">{stageLabel}</p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
