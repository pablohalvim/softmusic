import { formatRelativeTime } from "@softmusic/shared/datetime";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { StatusBadge } from "../components/analysis/StatusBadge";
import { fetchDashboardStats } from "../lib/api";
import { useBand } from "../lib/band-context";

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
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-slate-400">
          {bands.length === 0
            ? "Crie uma banda para acompanhar suas análises."
            : "Selecione uma banda para ver o resumo."}
        </p>
        <Link
          to="/bandas"
          className="inline-block rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Ir para bandas
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-400">
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
          <div className="rounded-2xl border border-indigo-900/40 bg-indigo-950/20 p-6">
            <p className="text-sm text-indigo-200/80">Músicas analisadas</p>
            <p className="mt-2 text-5xl font-bold text-indigo-100">{stats.analyzed_count}</p>
            <p className="mt-2 text-sm text-slate-400">
              de {stats.songs.total} na biblioteca desta banda
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-sm text-slate-400">Em análise</p>
              <p className="mt-2 text-2xl font-semibold text-indigo-300">
                {stats.songs.pending + stats.songs.processing}
              </p>
            </article>
            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-sm text-slate-400">Concluídas</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-300">{stats.songs.completed}</p>
            </article>
            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-sm text-slate-400">Com falha</p>
              <p className="mt-2 text-2xl font-semibold text-red-300">{stats.songs.failed}</p>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Últimas músicas</h2>
                <Link to="/library" className="text-xs text-indigo-300 hover:text-indigo-200">
                  Ver biblioteca
                </Link>
              </div>
              {stats.recent_songs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nenhuma música ainda.{" "}
                  <Link to="/analyze" className="text-indigo-300 underline">
                    Analisar primeira música
                  </Link>
                </p>
              ) : (
                <ul className="space-y-2">
                  {stats.recent_songs.map((song) => (
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

            <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">Em andamento</h2>
                <Link to="/analyze" className="text-xs text-orange-400 hover:text-orange-300">
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
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2 transition hover:border-slate-700 hover:bg-slate-950/50"
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
