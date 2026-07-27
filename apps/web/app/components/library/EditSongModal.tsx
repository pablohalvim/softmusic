import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";

import { updateSongMetadata, type SongSummary } from "../../lib/api";
import { useToast } from "../../lib/toast";
import {
  btnGhost,
  btnPrimary,
  inputClass,
  labelClass,
  modalOverlayClass,
  modalPanelClass,
} from "../../lib/ui-classes";

interface EditSongModalProps {
  open: boolean;
  song: SongSummary | null;
  onClose: () => void;
}

export function EditSongModal({ open, song, onClose }: EditSongModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !song) return;
    setTitle(song.title ?? "");
    setArtist(song.artist ?? "");
    setError(null);
  }, [open, song]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!song) throw new Error("Música inválida");
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        throw new Error("Informe o nome da música");
      }
      return updateSongMetadata(song.id, {
        title: trimmedTitle,
        artist: artist.trim() || null,
      });
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["songs"] });
      void queryClient.invalidateQueries({ queryKey: ["songs-global"] });
      void queryClient.invalidateQueries({ queryKey: ["song", updated.id] });
      toast.success("Nome e artista atualizados.");
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  if (!open || !song) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    <div className={modalOverlayClass}>
      <div
        className={`${modalPanelClass} max-w-lg`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-song-title"
      >
        <h2 id="edit-song-title" className="text-lg font-semibold text-slate-100">
          Editar música
        </h2>
        <p className="mt-1 text-sm text-slate-400">Altere o nome e o artista desta música.</p>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label htmlFor="edit-song-name" className={labelClass}>
            <span>Nome</span>
            <input
              id="edit-song-name"
              name="title"
              required
              maxLength={200}
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Grande É o Senhor"
              autoFocus
            />
          </label>

          <label htmlFor="edit-song-artist" className={labelClass}>
            <span>Artista</span>
            <input
              id="edit-song-artist"
              name="artist"
              maxLength={200}
              className={inputClass}
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              placeholder="Ex.: Fernandinho"
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className={btnGhost} onClick={onClose} disabled={mutation.isPending}>
              Cancelar
            </button>
            <button type="submit" className={btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
