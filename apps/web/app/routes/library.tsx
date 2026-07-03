import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { SongListItem } from "../components/analysis/SongListItem";
import { fetchSongs, isActiveSong } from "../lib/api";
import { useBand } from "../lib/band-context";

export default function Library() {
  const { activeBand } = useBand();
  const songsQuery = useQuery({
    queryKey: ["songs", activeBand?.id ?? null],
    queryFn: () => fetchSongs(50),
    enabled: Boolean(activeBand?.id),
    refetchInterval: (query) => {
      const hasActive = query.state.data?.items.some((song) => isActiveSong(song.status));
      return hasActive ? 3000 : false;
    },
  });

  const songs = songsQuery.data?.items ?? [];
  const activeCount = songs.filter((song) => isActiveSong(song.status)).length;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Biblioteca</h1>
          <p className="text-slate-400">
            Acompanhe o status de todas as músicas enviadas para análise.
          </p>
        </div>
        <Link
          to="/analyze"
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Nova análise
        </Link>
      </div>

      {activeCount > 0 ? (
        <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 px-4 py-3 text-sm text-indigo-200">
          {activeCount} análise{activeCount > 1 ? "s" : ""} em andamento — atualizando automaticamente.
        </div>
      ) : null}

      {songsQuery.isLoading ? (
        <p className="text-slate-400">Carregando biblioteca...</p>
      ) : songsQuery.isError ? (
        <p className="text-red-400">Não foi possível carregar a biblioteca.</p>
      ) : songs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
          <p className="text-slate-400">Nenhuma música analisada ainda.</p>
          <Link
            to="/analyze"
            className="mt-4 inline-block rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Analisar primeira música
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {songsQuery.data?.total ?? songs.length} música
            {(songsQuery.data?.total ?? songs.length) === 1 ? "" : "s"} no total
          </p>
          {songs.map((song) => (
            <SongListItem key={song.id} song={song} />
          ))}
        </div>
      )}
    </section>
  );
}
