import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { formatDateTime } from "@softmusic/shared/datetime";

import { fetchGlobalSongs, linkSongToBand } from "../../lib/api";

interface GlobalLibraryModalProps {
  open: boolean;
  bandId: string | undefined;
  onClose: () => void;
}

export function GlobalLibraryModal({ open, bandId, onClose }: GlobalLibraryModalProps) {
  const queryClient = useQueryClient();

  const globalQuery = useQuery({
    queryKey: ["songs-global", bandId ?? null],
    queryFn: () => fetchGlobalSongs(100),
    enabled: open && Boolean(bandId),
  });

  const linkMutation = useMutation({
    mutationFn: (songId: string) => linkSongToBand(songId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["songs"] });
      queryClient.invalidateQueries({ queryKey: ["songs-global"] });
    },
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const songs = globalQuery.data?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-library-title"
      >
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 id="global-library-title" className="text-lg font-semibold text-slate-100">
            Biblioteca global
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Músicas já analisadas em outras bandas suas que ainda não estão nesta banda.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {globalQuery.isLoading ? (
            <p className="text-slate-400">Carregando...</p>
          ) : globalQuery.isError ? (
            <p className="text-red-400">Não foi possível carregar a biblioteca global.</p>
          ) : songs.length === 0 ? (
            <p className="text-slate-400">
              Nenhuma música disponível para adicionar. Analise músicas em outras bandas ou conclua
              análises pendentes.
            </p>
          ) : (
            <ul className="space-y-3">
              {songs.map((song) => {
                const isLinking =
                  linkMutation.isPending && linkMutation.variables === song.id;
                const title = song.title ?? "Sem título";
                const subtitle = [song.artist, formatDateTime(song.updated_at)]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <li
                    key={song.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-100">{title}</p>
                      <p className="text-sm text-slate-400">{subtitle}</p>
                    </div>
                    <button
                      type="button"
                      disabled={linkMutation.isPending}
                      onClick={() => linkMutation.mutate(song.id)}
                      className="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-400 disabled:opacity-50"
                    >
                      {isLinking ? "Adicionando..." : "Adicionar"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {linkMutation.isError ? (
            <p className="mt-3 text-sm text-red-400">{linkMutation.error.message}</p>
          ) : null}
        </div>

        <div className="border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
