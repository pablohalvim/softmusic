import { formatRelativeTime } from "@softmusic/shared/datetime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { StatusBadge } from "../components/analysis/StatusBadge";
import { fetchDashboardStats } from "../lib/api";
import { useBand } from "../lib/band-context";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

export default function Dashboard() {
  const { activeBand } = useBand();
  const statsQuery = useQuery({
    queryKey: ["dashboard-stats", activeBand?.id ?? null],
    queryFn: fetchDashboardStats,
    enabled: Boolean(activeBand?.id),
    refetchInterval: 10_000,
  });

  const stats = statsQuery.data;

  const cards = stats
    ? [
        {
          label: "Análises concluídas",
          value: String(stats.songs.completed),
          hint: `${stats.songs.total} músicas na biblioteca`,
        },
        {
          label: "Jobs em fila",
          value: String(stats.jobs.queued),
          hint:
            stats.jobs.processing > 0
              ? `${stats.jobs.processing} processando agora`
              : "Nenhum job em execução",
        },
        {
          label: "Tempo médio",
          value: formatDuration(stats.pipeline.average_duration_seconds),
          hint: "Pipeline completo · últimas 24h",
        },
        {
          label: "Taxa de sucesso",
          value: formatPercent(stats.pipeline.success_rate_24h),
          hint: `${stats.pipeline.completed_24h} ok · ${stats.pipeline.failed_24h} falhas (24h)`,
        },
      ]
    : [];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-400">Visão operacional da plataforma SoftMusic.</p>
        </div>
        {stats ? (
          <p className="text-xs text-slate-500">
            Atualizado {formatRelativeTime(stats.generated_at)} · refresh a cada 10s
          </p>
        ) : null}
      </div>

      {statsQuery.isLoading ? (
        <p className="text-slate-400">Carregando métricas...</p>
      ) : statsQuery.isError ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-red-200">
          Não foi possível carregar o dashboard. Verifique se a API está no ar.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <article
                key={card.label}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <p className="text-sm text-slate-400">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-slate-100">{card.value}</p>
                <p className="mt-2 text-xs text-slate-500">{card.hint}</p>
              </article>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Em processamento</h2>
                <Link to="/library" className="text-xs text-indigo-300 hover:text-indigo-200">
                  Ver biblioteca
                </Link>
              </div>
              {stats!.active_jobs.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma análise ativa no momento.</p>
              ) : (
                <ul className="space-y-3">
                  {stats!.active_jobs.map((job) => (
                    <li key={job.job_id}>
                      <Link
                        to={`/songs/${job.song_id}`}
                        className="block rounded-lg border border-slate-800 px-3 py-2 transition hover:border-slate-700 hover:bg-slate-950/50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-slate-200">
                            {job.title ?? "Música sem título"}
                          </span>
                          <StatusBadge status={job.status} kind="job" />
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-indigo-500 transition-all"
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">{job.progress}%</span>
                        </div>
                        {job.stage ? (
                          <p className="mt-1 text-xs text-slate-500">Etapa: {job.stage}</p>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Atividade recente</h2>
                <Link to="/analyze" className="text-xs text-orange-400 hover:text-orange-300">
                  Nova análise
                </Link>
              </div>
              {stats!.recent_songs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nenhuma música analisada ainda.{" "}
                  <Link to="/analyze" className="text-indigo-300 underline">
                    Começar agora
                  </Link>
                </p>
              ) : (
                <ul className="space-y-2">
                  {stats!.recent_songs.map((song) => (
                    <li key={song.id}>
                      <Link
                        to={`/songs/${song.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2 transition hover:border-slate-700 hover:bg-slate-950/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-200">
                            {song.title ?? "Música sem título"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {song.artist ?? "Artista desconhecido"} ·{" "}
                            {formatRelativeTime(song.updated_at)}
                          </p>
                        </div>
                        <StatusBadge status={song.status} kind="song" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm">
              <span className="text-slate-500">Pendentes</span>
              <p className="mt-1 text-xl font-semibold text-slate-200">{stats!.songs.pending}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm">
              <span className="text-slate-500">Falhas</span>
              <p className="mt-1 text-xl font-semibold text-red-300">{stats!.songs.failed}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm">
              <span className="text-slate-500">Processando</span>
              <p className="mt-1 text-xl font-semibold text-indigo-300">
                {stats!.songs.processing}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
