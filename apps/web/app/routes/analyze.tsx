import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { JobStatusTracker } from "../components/analysis/JobStatusTracker";
import {
  serverVariationToLocal,
  upsertServerVariationToStorage,
} from "../components/cifra/cifra-variations";
import { authFetch } from "../lib/api";
import { useBand } from "../lib/band-context";
import { ANALYSIS_MEDIA_ACCEPT } from "../lib/media-upload";
import { useToast } from "../lib/toast";
import {
  alertInfoClass,
  alertWarnClass,
  btnAccent,
  inputClass,
  labelClass,
  linkClass,
  panelClass,
  segmentedActiveClass,
  segmentedIdleClass,
  segmentedWrapClass,
} from "../lib/ui-classes";

type AnalyzeMode = "upload" | "youtube";

type AnalyzeResponse = {
  duplicate?: boolean;
  job_id: string | null;
  song_id: string;
  message?: string | null;
  variation?: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    snapshot: Record<string, unknown>;
  } | null;
};

export default function Analyze() {
  const { activeBand } = useBand();
  const toast = useToast();
  const blocked = Boolean(activeBand?.is_blocked);
  const [mode, setMode] = useState<AnalyzeMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [songTitle, setSongTitle] = useState("");
  const [songArtist, setSongArtist] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [cifraClubUrl, setCifraClubUrl] = useState("");
  const [shareToGlobal, setShareToGlobal] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [songId, setSongId] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    message: string;
    songId: string;
    variationId?: string;
  } | null>(null);

  const onAnalyzeResult = (data: AnalyzeResponse) => {
    setSongId(data.song_id);
    if (data.duplicate) {
      setJobId(null);
      setDuplicateInfo({
        message: data.message ?? "Esta música do YouTube já foi importada.",
        songId: data.song_id,
        variationId: data.variation?.id,
      });
      if (data.variation) {
        upsertServerVariationToStorage(
          data.song_id,
          serverVariationToLocal({
            ...data.variation,
            snapshot: data.variation.snapshot as never,
          }),
        );
      }
      return;
    }

    setDuplicateInfo(null);
    setJobId(data.job_id);
  };

  const buildOptions = (extra?: Record<string, string>) => {
    const options: Record<string, string | boolean> = {
      educational_level: "intermediate",
      share_to_global: shareToGlobal,
      ...extra,
    };
    if (cifraClubUrl.trim()) {
      options.cifra_club_url = cifraClubUrl.trim();
    }
    return options;
  };

  const uploadMutation = useMutation({
    mutationFn: async ({
      selected,
      title,
      artist,
    }: {
      selected: File;
      title: string;
      artist: string;
    }) => {
      const formData = new FormData();
      formData.set("file", selected);
      const options = buildOptions({ title });
      if (artist.trim()) {
        options.artist = artist.trim();
      }
      formData.set("options", JSON.stringify(options));
      let response: Response;
      try {
        response = await authFetch("/songs/upload", {
          method: "POST",
          body: formData,
        });
      } catch {
        throw new Error(
          "Não foi possível conectar à API. Verifique se os containers api e python-ai estão rodando.",
        );
      }
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error?.message ?? "Falha no upload");
      }
      return response.json() as Promise<AnalyzeResponse>;
    },
    onSuccess: onAnalyzeResult,
  });

  const youtubeMutation = useMutation({
    mutationFn: async (url: string) => {
      let response: Response;
      try {
        response = await authFetch("/songs/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source: { type: "youtube", url },
            options: buildOptions(),
          }),
        });
      } catch {
        throw new Error(
          "Não foi possível conectar à API. Verifique se os containers api e python-ai estão rodando.",
        );
      }
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error?.message ?? "Falha ao iniciar análise do YouTube");
      }
      return response.json() as Promise<AnalyzeResponse>;
    },
    onSuccess: onAnalyzeResult,
  });

  const isPending = uploadMutation.isPending || youtubeMutation.isPending;
  const errorMessage =
    uploadMutation.error?.message ?? youtubeMutation.error?.message ?? null;
  const hasActiveJob = Boolean(jobId && songId);

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="sm-page-title">Analisar música</h1>
        <p className="sm-page-subtitle">
          Envie um arquivo ou cole um link do YouTube. O status aparece aqui em tempo real após o envio.
        </p>
      </div>

      {activeBand?.status === "trial" ? (
        <div className={`${alertWarnClass} px-4 py-3 text-sm`}>
          Período de trial: você pode visualizar cifras, mas não enviar músicas para análise até ativar a assinatura.
        </div>
      ) : null}

      {hasActiveJob ? <JobStatusTracker jobId={jobId!} songId={songId!} /> : null}

      {duplicateInfo ? (
        <div className={`${alertWarnClass} p-4 text-sm`}>
          <p>{duplicateInfo.message}</p>
          <p className="mt-2">
            <Link
              className={`${linkClass} underline`}
              to={
                duplicateInfo.variationId
                  ? `/songs/${duplicateInfo.songId}/cifra?variation=${duplicateInfo.variationId}`
                  : `/songs/${duplicateInfo.songId}/cifra`
              }
            >
              Abrir cifra da música
            </Link>
          </p>
        </div>
      ) : null}

      <div className={segmentedWrapClass}>
        <button
          type="button"
          onClick={() => setMode("upload")}
          disabled={isPending}
          className={mode === "upload" ? segmentedActiveClass : segmentedIdleClass}
        >
          Upload
        </button>
        <button
          type="button"
          onClick={() => setMode("youtube")}
          disabled={isPending}
          className={mode === "youtube" ? segmentedActiveClass : segmentedIdleClass}
        >
          YouTube
        </button>
      </div>

      <div className={`${panelClass} space-y-2`}>
        <label htmlFor="cifra-club-url" className={labelClass}>
          <span>Link do Cifra Club (opcional)</span>
          <input
            id="cifra-club-url"
            name="cifra-club-url"
            type="url"
            placeholder="https://www.cifraclub.com.br/artista/musica/"
            value={cifraClubUrl}
            onChange={(event) => setCifraClubUrl(event.target.value)}
            disabled={isPending}
            className={inputClass}
          />
        </label>
        <p className="text-xs text-slate-500">
          Se informado, a cifra com letra será importada do Cifra Club e usada na página de cifra em
          vez da detecção automática.
        </p>
        <label htmlFor="share-to-global" className="flex items-start gap-2 pt-2 text-sm text-slate-300">
          <input
            id="share-to-global"
            name="share-to-global"
            type="checkbox"
            className="mt-1"
            checked={shareToGlobal}
            disabled={isPending}
            onChange={(event) => setShareToGlobal(event.target.checked)}
          />
          <span>
            <span className="block font-medium text-slate-200">
              Compartilhar na Biblioteca global
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Se excluir da banda depois, a música continua disponível para adicionar de novo.
            </span>
          </span>
        </label>
      </div>

      {mode === "upload" ? (
        <form
          className={`${panelClass} space-y-4`}
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked) {
              toast.warn("Não é possível enviar música para análise com a banda bloqueada.");
              return;
            }
            const title = songTitle.trim();
            if (!title) {
              toast.warn("Informe o nome da música.");
              return;
            }
            if (file) {
              uploadMutation.mutate({
                selected: file,
                title,
                artist: songArtist.trim(),
              });
            }
          }}
        >
          <label htmlFor="song-title" className={labelClass}>
            <span>Nome da Música</span>
            <input
              id="song-title"
              name="song-title"
              type="text"
              required
              maxLength={200}
              placeholder="Ex.: Grande É o Senhor"
              value={songTitle}
              onChange={(event) => setSongTitle(event.target.value)}
              disabled={isPending}
              className={inputClass}
            />
          </label>
          <label htmlFor="song-artist" className={labelClass}>
            <span>Nome do Artista</span>
            <input
              id="song-artist"
              name="song-artist"
              type="text"
              maxLength={200}
              placeholder="Ex.: Fernandinho"
              value={songArtist}
              onChange={(event) => setSongArtist(event.target.value)}
              disabled={isPending}
              className={inputClass}
            />
          </label>
          <label htmlFor="audio-file" className={labelClass}>
            <span>Arquivo de áudio ou vídeo</span>
            <input
              id="audio-file"
              name="audio-file"
              type="file"
              accept={ANALYSIS_MEDIA_ACCEPT}
              className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-gradient-to-b file:from-red-400 file:to-red-600 file:px-4 file:py-2 file:font-medium file:text-white"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="text-xs text-slate-500">
              MP3, WAV, OPUS, WEBM, MP4 e similares — o áudio do vídeo é extraído na análise.
            </span>
          </label>
          <button
            type="submit"
            disabled={!file || !songTitle.trim() || isPending}
            className={`${btnAccent} disabled:opacity-50`}
          >
            {isPending ? "Enviando..." : "Iniciar análise"}
          </button>
        </form>
      ) : (
        <form
          className={`${panelClass} space-y-4`}
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked) {
              toast.warn("Não é possível enviar música para análise com a banda bloqueada.");
              return;
            }
            if (youtubeUrl.trim()) {
              youtubeMutation.mutate(youtubeUrl.trim());
            }
          }}
        >
          <label htmlFor="youtube-url" className={labelClass}>
            <span>Link do YouTube</span>
            <input
              id="youtube-url"
              name="youtube-url"
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              className={inputClass}
            />
          </label>
          <p className="text-xs text-slate-500">
            O áudio será baixado pelo worker, analisado e o título/canal serão extraídos automaticamente.
          </p>
          <button
            type="submit"
            disabled={!youtubeUrl.trim() || isPending}
            className={`${btnAccent} disabled:opacity-50`}
          >
            {isPending ? "Enviando para análise..." : "Analisar do YouTube"}
          </button>
        </form>
      )}

      {isPending ? (
        <div className={`${alertInfoClass} p-4 text-sm`}>
          Enviando requisição... Em instantes o progresso aparecerá acima.
        </div>
      ) : null}

      {errorMessage ? <p className="text-sm text-red-400">{errorMessage}</p> : null}

      <p className="text-sm text-slate-500">
        Todas as análises também ficam disponíveis em{" "}
        <Link className={`${linkClass} underline`} to="/library">
          Biblioteca
        </Link>
        .
      </p>
    </section>
  );
}
