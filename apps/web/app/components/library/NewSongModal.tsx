import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { createCifraDraft, uploadSongForAnalysis } from "../../lib/api";
import { useToast } from "../../lib/toast";
import {
  btnGhost,
  btnPrimary,
  inputClass,
  labelClass,
  modalOverlayClass,
  modalPanelClass,
} from "../../lib/ui-classes";

interface NewSongModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewSongModal({ open, onClose }: NewSongModalProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shareToGlobal, setShareToGlobal] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setArtist("");
    setFile(null);
    setShareToGlobal(true);
    setError(null);
  }, [open]);

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
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        throw new Error("Informe o nome da música");
      }
      if (file) {
        return uploadSongForAnalysis({
          file,
          title: trimmedTitle,
          artist: artist.trim() || undefined,
          share_to_global: shareToGlobal,
        });
      }
      return createCifraDraft({
        title: trimmedTitle,
        artist: artist.trim() || undefined,
        share_to_global: shareToGlobal,
      });
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["songs"] });
      onClose();
      if (data.job_id) {
        toast.success("Música enviada para análise.");
        void navigate(`/songs/${data.song_id}`);
        return;
      }
      toast.success("Música criada. Você pode editar a cifra agora.");
      void navigate(`/songs/${data.song_id}/cifra`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  if (!open) return null;

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
        aria-labelledby="new-song-title"
      >
        <h2 id="new-song-title" className="text-lg font-semibold text-slate-100">
          Nova música
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Crie só com nome e autor para editar a cifra, ou anexe um áudio para analisar.
        </p>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label htmlFor="new-song-name" className={labelClass}>
            <span>Nome</span>
            <input
              id="new-song-name"
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

          <label htmlFor="new-song-artist" className={labelClass}>
            <span>Autor</span>
            <input
              id="new-song-artist"
              name="artist"
              maxLength={200}
              className={inputClass}
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              placeholder="Ex.: Fernandinho"
            />
          </label>

          <label htmlFor="new-song-audio" className={labelClass}>
            <span>Áudio (opcional)</span>
            <input
              id="new-song-audio"
              name="audio_file"
              type="file"
              accept="audio/*"
              className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-gradient-to-b file:from-red-400 file:to-red-600 file:px-4 file:py-2 file:font-medium file:text-white"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="text-xs text-slate-500">
              Sem áudio: cifra em branco para editar. Com áudio: inicia análise (stems, tom, etc.).
            </span>
          </label>

          <label
            htmlFor="new-song-share-global"
            className="flex items-start gap-2 text-sm text-slate-300"
          >
            <input
              id="new-song-share-global"
              name="share_to_global"
              type="checkbox"
              className="mt-1"
              checked={shareToGlobal}
              onChange={(event) => setShareToGlobal(event.target.checked)}
            />
            <span>
              <span className="block font-medium text-slate-200">Compartilhar na Biblioteca global</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Se excluir da banda depois, a música continua disponível para adicionar de novo.
              </span>
            </span>
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={btnGhost}
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !title.trim()}
              className={`${btnPrimary} disabled:opacity-50`}
            >
              {mutation.isPending
                ? file
                  ? "Enviando..."
                  : "Criando..."
                : file
                  ? "Criar e analisar"
                  : "Criar música"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
