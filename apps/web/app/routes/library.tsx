import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useEffect, useState } from "react";

import { SongListItem } from "../components/analysis/SongListItem";
import { GlobalLibraryModal } from "../components/library/GlobalLibraryModal";
import { NewSongModal } from "../components/library/NewSongModal";
import { fetchSongs, isActiveSong } from "../lib/api";
import { useBand } from "../lib/band-context";
import { useToast } from "../lib/toast";
import {
  alertInfoClass,
  btnAccent,
  btnGhost,
  btnPrimary,
  inputClass,
  panelClass,
} from "../lib/ui-classes";

const PAGE_SIZE = 5;

export default function Library() {
  const { activeBand } = useBand();
  const toast = useToast();
  const [globalOpen, setGlobalOpen] = useState(false);
  const [newSongOpen, setNewSongOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const blocked = Boolean(activeBand?.is_blocked);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const songsQuery = useInfiniteQuery({
    queryKey: ["songs", activeBand?.id ?? null, searchQuery],
    queryFn: ({ pageParam }) =>
      fetchSongs({
        limit: PAGE_SIZE,
        offset: pageParam,
        q: searchQuery || undefined,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(activeBand?.id),
    refetchInterval: (query) => {
      const hasActive = query.state.data?.pages.some((page) =>
        page.items.some((song) => isActiveSong(song.status)),
      );
      return hasActive ? 5000 : false;
    },
  });

  const songs = songsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = songsQuery.data?.pages[0]?.total ?? 0;
  const activeCount = songs.filter((song) => isActiveSong(song.status)).length;
  const hasMore = Boolean(songsQuery.hasNextPage);

  const openNewSong = () => {
    if (blocked) {
      toast.warn("Banda bloqueada. Não é possível criar ou analisar música.");
      return;
    }
    setNewSongOpen(true);
  };

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
          <button
            type="button"
            onClick={openNewSong}
            disabled={!activeBand?.id}
            className={`${btnPrimary} disabled:opacity-50 ${blocked ? "opacity-50" : ""}`}
          >
            Nova música
          </button>
          {blocked ? (
            <button
              type="button"
              className={`${btnAccent} opacity-50`}
              onClick={() =>
                toast.warn("Banda bloqueada. Não é possível enviar música para análise.")
              }
            >
              Nova análise
            </button>
          ) : (
            <Link to="/analyze" className={btnAccent}>
              Nova análise
            </Link>
          )}
        </div>
      </div>

      <GlobalLibraryModal
        open={globalOpen}
        bandId={activeBand?.id}
        onClose={() => setGlobalOpen(false)}
      />
      <NewSongModal open={newSongOpen} onClose={() => setNewSongOpen(false)} />

      <label htmlFor="library-song-search" className="block space-y-1.5">
        <span className="text-sm text-slate-400">Pesquisar música</span>
        <input
          id="library-song-search"
          name="library-song-search"
          type="search"
          className={inputClass}
          placeholder="Digite o nome ou o artista..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          disabled={!activeBand?.id}
        />
      </label>

      {activeCount > 0 ? (
        <div className={`${alertInfoClass} px-4 py-3 text-sm`}>
          {activeCount} análise{activeCount > 1 ? "s" : ""} em andamento — atualizando automaticamente.
        </div>
      ) : null}

      {songsQuery.isLoading ? (
        <p className="text-slate-400">Carregando biblioteca...</p>
      ) : songsQuery.isError ? (
        <p className="text-red-400">Não foi possível carregar a biblioteca.</p>
      ) : total === 0 ? (
        <div className={`${panelClass} border-dashed p-10 text-center`}>
          <p className="text-slate-400">
            {searchQuery
              ? `Nenhuma música encontrada para “${searchQuery}”.`
              : "Nenhuma música na biblioteca ainda."}
          </p>
          {!searchQuery ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className={`${btnPrimary} inline-flex ${blocked ? "opacity-50" : ""}`}
                onClick={openNewSong}
              >
                Nova música
              </button>
              {blocked ? (
                <button
                  type="button"
                  className={`${btnAccent} inline-flex opacity-50`}
                  onClick={() =>
                    toast.warn("Banda bloqueada. Não é possível enviar música para análise.")
                  }
                >
                  Analisar com YouTube/áudio
                </button>
              ) : (
                <Link to="/analyze" className={`${btnAccent} inline-flex`}>
                  Analisar com YouTube/áudio
                </Link>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Exibindo {songs.length} de {total} música{total === 1 ? "" : "s"}
            {searchQuery ? ` para “${searchQuery}”` : ""}
          </p>
          {songs.map((song) => (
            <SongListItem key={song.id} song={song} />
          ))}
          {hasMore ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                className={`${btnGhost} px-4 py-2 text-sm disabled:opacity-50`}
                disabled={songsQuery.isFetchingNextPage}
                onClick={() => void songsQuery.fetchNextPage()}
              >
                {songsQuery.isFetchingNextPage ? "Carregando..." : "Carregar mais"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
