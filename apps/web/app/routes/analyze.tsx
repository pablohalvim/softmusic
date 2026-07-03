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
  const [mode, setMode] = useState<AnalyzeMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [cifraClubUrl, setCifraClubUrl] = useState("");
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

  const buildOptions = () => {
    const options: Record<string, string> = { educational_level: "intermediate" };
    if (cifraClubUrl.trim()) {
      options.cifra_club_url = cifraClubUrl.trim();
    }
    return options;
  };

  const uploadMutation = useMutation({
    mutationFn: async (selected: File) => {
      const formData = new FormData();
      formData.set("file", selected);
      formData.set("options", JSON.stringify(buildOptions()));
      let response: Response;
      try {
        response = await authFetch("/songs/upload", {
          method: "POST",
          body: formData,
        });
      } catch {
        throw new Error(
          "Não foi possível conectar à API (http://localhost:8080). Verifique se os containers api e python-ai estão rodando.",
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
          "Não foi possível conectar à API (http://localhost:8080). Verifique se os containers api e python-ai estão rodando.",
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
        <h1 className="text-2xl font-semibold">Analisar música</h1>
        <p className="text-slate-400">
          Envie um arquivo ou cole um link do YouTube. O status aparece aqui em tempo real após o envio.
        </p>
      </div>

      {activeBand?.status === "trial" ? (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          Período de trial: você pode visualizar cifras, mas não enviar músicas para análise até ativar a assinatura.
        </div>
      ) : null}

      {hasActiveJob ? (
        <JobStatusTracker jobId={jobId!} songId={songId!} />
      ) : null}

      {duplicateInfo ? (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-100">
          <p>{duplicateInfo.message}</p>
          <p className="mt-2">
            <Link
              className="text-indigo-300 underline"
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

      <div className="flex gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-1">
        <button
          type="button"
          onClick={() => setMode("upload")}
          disabled={isPending}
          className={`flex-1 rounded-md px-3 py-2 text-sm ${
            mode === "upload" ? "bg-indigo-500 text-white" : "text-slate-300 hover:text-white"
          }`}
        >
          Upload
        </button>
        <button
          type="button"
          onClick={() => setMode("youtube")}
          disabled={isPending}
          className={`flex-1 rounded-md px-3 py-2 text-sm ${
            mode === "youtube" ? "bg-indigo-500 text-white" : "text-slate-300 hover:text-white"
          }`}
        >
          YouTube
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <label className="block space-y-2 text-sm">
          <span className="text-slate-300">Link do Cifra Club (opcional)</span>
          <input
            type="url"
            placeholder="https://www.cifraclub.com.br/artista/musica/"
            value={cifraClubUrl}
            onChange={(event) => setCifraClubUrl(event.target.value)}
            disabled={isPending}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500"
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Se informado, a cifra com letra será importada do Cifra Club e usada na página de cifra em
          vez da detecção automática.
        </p>
      </div>

      {mode === "upload" ? (
        <form
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (file) {
              uploadMutation.mutate(file);
            }
          }}
        >
          <input
            type="file"
            accept="audio/*"
            className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-500 file:px-4 file:py-2 file:text-white"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="submit"
            disabled={!file || isPending}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? "Enviando..." : "Iniciar análise"}
          </button>
        </form>
      ) : (
        <form
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (youtubeUrl.trim()) {
              youtubeMutation.mutate(youtubeUrl.trim());
            }
          }}
        >
          <label className="block space-y-2 text-sm">
            <span className="text-slate-300">Link do YouTube</span>
            <input
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500"
            />
          </label>
          <p className="text-xs text-slate-500">
            O áudio será baixado pelo worker, analisado e o título/canal serão extraídos automaticamente.
          </p>
          <button
            type="submit"
            disabled={!youtubeUrl.trim() || isPending}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? "Enviando para análise..." : "Analisar do YouTube"}
          </button>
        </form>
      )}

      {isPending ? (
        <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-4 text-sm text-indigo-200">
          Enviando requisição... Em instantes o progresso aparecerá acima.
        </div>
      ) : null}

      {errorMessage ? <p className="text-sm text-red-400">{errorMessage}</p> : null}

      <p className="text-sm text-slate-500">
        Todas as análises também ficam disponíveis em{" "}
        <Link className="text-indigo-300 underline" to="/library">
          Biblioteca
        </Link>
        .
      </p>
    </section>
  );
}
