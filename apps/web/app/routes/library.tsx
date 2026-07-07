import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useState } from "react";

import { SongListItem } from "../components/analysis/SongListItem";
import { GlobalLibraryModal } from "../components/library/GlobalLibraryModal";
import { fetchSongs, isActiveSong } from "../lib/api";
import { useBand } from "../lib/band-context";
import { alertInfoClass, btnAccent, btnGhost, linkClass, panelClass } from "../lib/ui-classes";

export default function Library() {
  const { activeBand } = useBand();
  const [globalOpen, setGlobalOpen] = useState(false);
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
          <h1 className="sm-page-title">Biblioteca</h1>
          <p className="sm-page-subtitle">
            Músicas da banda {activeBand?.name ? `"${activeBand.name}"` : "ativa"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setGlobalOpen(true)}
            disabled={!activeBand?.id}
            className={`${btnGhost} disabled:opacity-50`}
          >
            Adicionar da biblioteca global
          </button>
          <Link to="/analyze" className={btnAccent}>
            Nova análise
          </Link>
        </div>
      </div>

      <GlobalLibraryModal
        open={globalOpen}
        bandId={activeBand?.id}
        onClose={() => setGlobalOpen(false)}
      />

      {activeCount > 0 ? (
        <div className={`${alertInfoClass} px-4 py-3 text-sm`}>
          {activeCount} análise{activeCount > 1 ? "s" : ""} em andamento — atualizando automaticamente.
        </div>
      ) : null}

      {songsQuery.isLoading ? (
        <p className="text-slate-400">Carregando biblioteca...</p>
      ) : songsQuery.isError ? (
        <p className="text-red-400">Não foi possível carregar a biblioteca.</p>
      ) : songs.length === 0 ? (
        <div className={`${panelClass} border-dashed p-10 text-center`}>
          <p className="text-slate-400">Nenhuma música analisada ainda.</p>
          <Link to="/analyze" className={`${btnAccent} mt-4 inline-flex`}>
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
