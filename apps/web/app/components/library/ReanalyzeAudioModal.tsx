import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { reanalyzeSongAudio, reanalyzeSongYoutube, type SongSummary } from "../../lib/api";
import { ANALYSIS_MEDIA_ACCEPT } from "../../lib/media-upload";
import { useToast } from "../../lib/toast";
import {
  btnGhost,
  btnPrimary,
  inputClass,
  labelClass,
  modalOverlayClass,
  modalPanelClass,
  segmentedActiveClass,
  segmentedIdleClass,
  segmentedWrapClass,
} from "../../lib/ui-classes";

const YOUTUBE_URL_RE =
  /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/i;

type Mode = "upload" | "youtube";

interface ReanalyzeAudioModalProps {
  open: boolean;
  song: SongSummary;
  onClose: () => void;
  onStarted: () => void;
}

export function ReanalyzeAudioModal({
  open,
  song,
  onClose,
  onStarted,
}: ReanalyzeAudioModalProps) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const replace = Boolean(song.has_audio);
  const title = replace ? "Nova análise" : "Analisar áudio";

  useEffect(() => {
    if (!open) return;
    setMode("upload");
    setFile(null);
    setYoutubeUrl("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "upload") {
        if (!file) throw new Error("Selecione um arquivo de áudio");
        return reanalyzeSongAudio(song.id, file, { replace });
      }
      const url = youtubeUrl.trim();
      if (!url) throw new Error("Informe o link do YouTube");
      if (!YOUTUBE_URL_RE.test(url)) throw new Error("URL do YouTube inválida");
      return reanalyzeSongYoutube(song.id, url, { replace });
    },
    onSuccess: () => {
      toast.success(
        replace
          ? mode === "youtube"
            ? "Nova análise iniciada com o link do YouTube."
            : "Nova análise iniciada com o áudio enviado."
          : mode === "youtube"
            ? "Análise iniciada a partir do YouTube."
            : "Análise de áudio iniciada.",
      );
      onStarted();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  if (!open || typeof document === "undefined") return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return createPortal(
    <div className={modalOverlayClass} onClick={onClose}>
      <div
        className={`${modalPanelClass} max-w-lg`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reanalyze-audio-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="reanalyze-audio-title" className="text-lg font-semibold text-slate-100">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {replace
            ? "Substitua o áudio atual por um arquivo ou link do YouTube e rode a análise de novo."
            : "Anexe um arquivo ou cole um link do YouTube para analisar esta música."}
        </p>

        <div className={`${segmentedWrapClass} mt-4`}>
          <button
            type="button"
            className={mode === "upload" ? segmentedActiveClass : segmentedIdleClass}
            onClick={() => {
              setMode("upload");
              setError(null);
            }}
          >
            Arquivo
          </button>
          <button
            type="button"
            className={mode === "youtube" ? segmentedActiveClass : segmentedIdleClass}
            onClick={() => {
              setMode("youtube");
              setError(null);
            }}
          >
            YouTube
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {mode === "upload" ? (
            <label htmlFor={`reanalyze-file-${song.id}`} className={labelClass}>
              <span>Arquivo de áudio</span>
              <input
                id={`reanalyze-file-${song.id}`}
                name="file"
                type="file"
                accept={ANALYSIS_MEDIA_ACCEPT}
                required={mode === "upload"}
                className={inputClass}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <label htmlFor={`reanalyze-youtube-${song.id}`} className={labelClass}>
              <span>Link do YouTube</span>
              <input
                id={`reanalyze-youtube-${song.id}`}
                name="youtube_url"
                type="url"
                required={mode === "youtube"}
                placeholder="https://www.youtube.com/watch?v=..."
                className={inputClass}
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
              />
            </label>
          )}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              className={btnGhost}
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button type="submit" className={btnPrimary} disabled={mutation.isPending}>
              {mutation.isPending
                ? "Enviando..."
                : replace
                  ? "Substituir e analisar"
                  : "Analisar"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
