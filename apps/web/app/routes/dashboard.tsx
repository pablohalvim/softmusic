import { formatRelativeTime } from "@softmusic/shared/datetime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { StatusBadge } from "../components/analysis/StatusBadge";
import { PendingInvitesCard } from "../components/PendingInvitesCard";
import { UpcomingScheduleCards } from "../components/UpcomingScheduleCards";
import { ShineStatCard } from "../components/ui/ShineStatCard";
import { fetchDashboardStats } from "../lib/api";
import { useBand } from "../lib/band-context";
import { btnPrimary, linkClass, listItemHoverClass, panelClass } from "../lib/ui-classes";

export default function Dashboard() {
  const { activeBand, bands, loading: bandsLoading } = useBand();
  const statsQuery = useQuery({
    queryKey: ["dashboard-stats", activeBand?.id ?? null],
    queryFn: fetchDashboardStats,
    enabled: Boolean(activeBand?.id),
    refetchInterval: 30_000,
  });

  const stats = statsQuery.data;

  if (bandsLoading) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (!activeBand) {
    return (
      <section className="space-y-4">
        <h1 className="sm-page-title">Dashboard</h1>
        <PendingInvitesCard />
        <UpcomingScheduleCards />
        <p className="sm-page-subtitle">
          {bands.length === 0
            ? "Crie uma banda para acompanhar suas análises."
            : "Selecione uma banda para ver o resumo."}
        </p>
        <Link to="/bandas" className={btnPrimary}>
          Ir para bandas
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PendingInvitesCard />
      <UpcomingScheduleCards />
      <div className="flex flex-wrap items-end justify-between gap-4 sm-animate-in">
        <div>
          <h1 className="sm-page-title">Dashboard</h1>
          <p className="sm-page-subtitle">
            Resumo da banda <span className="text-slate-200">{activeBand.name}</span>
          </p>
        </div>
        {stats ? (
          <p className="text-xs text-slate-500">
            Atualizado {formatRelativeTime(stats.generated_at)}
          </p>
        ) : null}
      </div>

      {statsQuery.isLoading ? (
        <p className="text-slate-400">Carregando métricas...</p>
      ) : statsQuery.isError || !stats ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-red-200">
          Não foi possível carregar o dashboard. Tente novamente em instantes.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <ShineStatCard
              className="md:col-span-2"
              tone="hero"
              label="Músicas analisadas"
              value={stats.analyzed_count}
              hint={`de ${stats.songs.total} na biblioteca desta banda`}
            />
            <ShineStatCard
              tone="brand"
              label="Em análise"
              value={stats.songs.pending + stats.songs.processing}
            />
            <ShineStatCard tone="muted" label="Concluídas" value={stats.songs.completed} />
          </div>
          {stats.songs.failed > 0 ? (
            <ShineStatCard tone="danger" label="Com falha" value={stats.songs.failed} />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <article className={panelClass}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Últimas músicas</h2>
                <Link to="/library" className={`text-xs ${linkClass}`}>
                  Ver biblioteca
                </Link>
              </div>
              {stats.recent_songs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nenhuma música ainda.{" "}
                  <Link to="/analyze" className={`${linkClass} underline`}>
                    Analisar primeira música
                  </Link>
                </p>
              ) : (
                <ul className="space-y-2">
                  {stats.recent_songs.map((song) => (
                    <li key={song.id}>
                      <Link
                        to={`/songs/${song.id}`}
                        className={`${listItemHoverClass} flex items-center justify-between gap-3`}
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

            <article className={panelClass}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Em andamento</h2>
                <Link to="/analyze" className="text-xs text-red-400 transition hover:text-red-300">
                  Nova análise
                </Link>
              </div>
              {stats.in_progress_songs.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma análise em andamento.</p>
              ) : (
                <ul className="space-y-2">
                  {stats.in_progress_songs.map((song) => (
                    <li key={song.id}>
                      <Link
                        to={`/songs/${song.id}`}
                        className={`${listItemHoverClass} flex items-center justify-between gap-3`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-200">
                            {song.title ?? "Música sem título"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
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
        </>
      )}
    </section>
  );
}
