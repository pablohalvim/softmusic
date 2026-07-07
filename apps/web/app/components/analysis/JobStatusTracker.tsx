import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { fetchJob, fetchSong, isJobFinished } from "../../lib/api";
import { btnPrimary, linkClass, panelClass } from "../../lib/ui-classes";
import { JobProgressDetails } from "./StatusBadge";

export function JobStatusTracker({
  jobId,
  songId,
  compact = false,
}: {
  jobId: string;
  songId: string;
  compact?: boolean;
}) {
  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId),
    refetchInterval: (query) => (query.state.data && isJobFinished(query.state.data.status) ? false : 2000),
  });

  const songQuery = useQuery({
    queryKey: ["song", songId],
    queryFn: () => fetchSong(songId),
    refetchInterval: (query) =>
      query.state.data?.status === "completed" || query.state.data?.status === "failed" ? false : 3000,
  });

  const job = jobQuery.data;
  const song = songQuery.data;

  if (jobQuery.isLoading) {
    return <p className="text-sm text-slate-400">Carregando status da análise...</p>;
  }

  if (jobQuery.isError || !job) {
    return <p className="text-sm text-red-400">Não foi possível acompanhar o job.</p>;
  }

  const title = song?.title ?? "Música em análise";
  const artist = song?.artist;

  return (
    <div
      className={`${panelClass} ${
        job.status === "completed"
          ? "border-emerald-500/30"
          : job.status === "failed"
            ? "border-red-500/30"
            : "border-green-500/25"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Análise em andamento</p>
          <h2 className="mt-1 text-lg font-semibold">{title}</h2>
          {artist ? <p className="text-sm text-slate-400">{artist}</p> : null}
          {!compact ? (
            <p className="mt-2 text-xs text-slate-500">
              Job <code className="text-slate-400">{job.id}</code>
            </p>
          ) : null}
        </div>
        {job.status === "completed" ? (
          <div className="flex flex-wrap gap-2">
            <Link to={`/songs/${songId}`} className={`${btnPrimary} px-3 py-1.5 text-sm`}>
              Ver análise
            </Link>
            <Link to={`/songs/${songId}/cifra`} className={`${btnPrimary} px-3 py-1.5 text-sm`}>
              Abrir cifra
            </Link>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <JobProgressDetails
          status={job.status}
          stage={job.stage}
          progress={job.progress}
          error={job.error}
        />
      </div>

      {job.status === "completed" ? (
        <p className="mt-4 text-sm text-emerald-300">Análise concluída com sucesso.</p>
      ) : null}

      {job.status === "failed" ? (
        <p className="mt-4 text-sm text-red-300">
          A análise falhou. Tente enviar novamente ou confira os logs do worker.
        </p>
      ) : null}

      {!compact && job.status !== "completed" && job.status !== "failed" ? (
        <p className="mt-4 text-xs text-slate-500">
          Esta página atualiza automaticamente a cada poucos segundos. Você também pode acompanhar em{" "}
          <Link className={`${linkClass} underline`} to="/library">
            Biblioteca
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
