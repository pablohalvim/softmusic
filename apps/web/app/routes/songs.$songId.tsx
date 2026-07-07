import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  analyzeProgressionChords,
  summarizeProgressionDegrees,
} from "@softmusic/shared/harmony";

import { StemsPanel } from "../components/analysis/StemsPanel";
import { SongAudioPlayer } from "../components/audio/SongAudioPlayer";
import { HarmonicFieldPanel } from "../components/analysis/HarmonicFieldPanel";
import { MusicMapPanel } from "../components/analysis/MusicMapPanel";
import { RelatedKeysPanel } from "../components/analysis/RelatedKeysPanel";
import { JobProgressDetails, StatusBadge } from "../components/analysis/StatusBadge";
import {
  cancelSongAnalysis,
  deleteSong,
  fetchSong,
  fetchSongJob,
  authFetch,
  isActiveSong,
  isJobFinished,
  isSongFinished,
} from "../lib/api";

export default function SongDetail() {
  const { songId } = useParams();

  const songQuery = useQuery({
    queryKey: ["song", songId],
    queryFn: () => fetchSong(songId!),
    enabled: Boolean(songId),
    refetchInterval: (query) => (query.state.data && isSongFinished(query.state.data.status) ? false : 3000),
  });

  const jobQuery = useQuery({
    queryKey: ["song-job", songId],
    queryFn: () => fetchSongJob(songId!),
    enabled: Boolean(songId) && Boolean(songQuery.data) && !isSongFinished(songQuery.data!.status),
    refetchInterval: (query) => (query.state.data && isJobFinished(query.state.data.status) ? false : 2000),
  });

  const analysisQuery = useQuery({
    queryKey: ["analysis", songId],
    queryFn: async () => {
      const response = await authFetch(`/songs/${songId}/analysis`);
      if (!response.ok) throw new Error("Análise indisponível");
      return response.json();
    },
    enabled: songQuery.data?.status === "completed",
  });

  const waveformQuery = useQuery({
    queryKey: ["waveform", songId],
    queryFn: async () => {
      const response = await authFetch(`/songs/${songId}/waveform`);
      if (!response.ok) throw new Error("Waveform indisponível");
      return response.json();
    },
    enabled: songQuery.data?.status === "completed",
  });

  const stemsQuery = useQuery({
    queryKey: ["stems", songId],
    queryFn: async () => {
      const response = await authFetch(`/songs/${songId}/stems`);
      if (!response.ok) throw new Error("Stems indisponíveis");
      return response.json();
    },
    enabled: songQuery.data?.status === "completed",
  });

  const harmonicInsights = useMemo(() => {
    const analysis = analysisQuery.data;
    if (!analysis?.harmony) return null;

    const { key, mode } = analysis.harmony;
    const progression =
      analysis.guitar?.chord_progression ?? analysis.harmony.chord_progression ?? [];
    const analyzed = analyzeProgressionChords(progression, key, mode);
    const degreeUsage = summarizeProgressionDegrees(analyzed, key, mode);

    return { analyzed, degreeUsage, progression };
  }, [analysisQuery.data]);

  if (songQuery.isLoading) {
    return <p className="text-slate-400">Carregando...</p>;
  }

  if (songQuery.isError || !songQuery.data) {
    return <p className="text-red-400">Não foi possível carregar a música.</p>;
  }

  const song = songQuery.data;
  const job = jobQuery.data;
  const analysis = analysisQuery.data;
  const waveform = waveformQuery.data?.peaks?.slice(0, 64) ?? [];
  const isProcessing = song.status === "pending" || song.status === "processing";

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{song.title ?? "Música sem título"}</h1>
            <StatusBadge status={song.status} kind="song" />
          </div>
          <p className="mt-2 text-slate-400">
            {song.artist ? `${song.artist} · ` : null}
            {song.duration_seconds ? `${Math.round(song.duration_seconds)}s` : "Duração desconhecida"}
          </p>
        </div>
        {song.status === "completed" ? (
          <Link
            to={`/songs/${songId}/cifra`}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-400"
          >
            Abrir cifra
          </Link>
        ) : null}
      </div>

      {isProcessing && job ? (
        <div className="rounded-xl border border-green-900/50 bg-green-950/20 p-5">
          <h2 className="font-medium text-green-100">Progresso da análise</h2>
          <div className="mt-4">
            <JobProgressDetails
              status={job.status}
              stage={job.stage}
              progress={job.progress}
              error={job.error}
            />
          </div>
          <p className="mt-4 text-xs text-slate-500">Atualizando automaticamente...</p>
        </div>
      ) : isProcessing ? (
        <div className="rounded-xl border border-green-900/50 bg-green-950/20 p-5 text-slate-300">
          Análise em processamento. Aguardando atualização do worker...
        </div>
      ) : null}

      {song.status === "failed" && job?.error ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-5 text-red-200">
          <h2 className="font-medium">Erro na análise</h2>
          <p className="mt-2 text-sm">{job.error}</p>
        </div>
      ) : null}

      {song.status === "completed" ? (
        <SongAudioPlayer
          songId={songId!}
          title={song.title}
          bpm={analysis?.harmony?.tempo_bpm}
        />
      ) : null}

      {waveform.length > 0 ? (
        <div className="h-48 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waveform.map((peak: number, index: number) => ({ index, peak }))}>
              <XAxis dataKey="index" hide />
              <YAxis hide domain={[0, "dataMax"]} />
              <Bar dataKey="peak" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {analysis ? (
        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-slate-800 p-4">
            <h2 className="font-medium">Harmonia</h2>
            <p className="mt-2 text-slate-300">
              {analysis.harmony.key} {analysis.harmony.mode} · {analysis.harmony.tempo_bpm} BPM
            </p>
            {analysis.guitar?.separated ? (
              <p className="mt-2 text-xs text-emerald-400">
                Acordes estimados a partir do stem violão/teclado (Demucs)
              </p>
            ) : null}
            {harmonicInsights?.degreeUsage.length ? (
              <p className="mt-2 text-sm text-slate-400">
                Graus na progressão:{" "}
                {harmonicInsights.degreeUsage
                  .map((item) => `${item.degree}ª (${item.roman})`)
                  .join(" · ")}
              </p>
            ) : null}
          </article>
          <article className="rounded-xl border border-slate-800 p-4">
            <h2 className="font-medium">Estrutura</h2>
            <p className="mt-2 text-slate-300">
              {analysis.structure.sections.length} seções detectadas
            </p>
          </article>

          <HarmonicFieldPanel
            keyName={analysis.harmony.key}
            mode={analysis.harmony.mode}
            scale={analysis.harmony.scale}
            degreeUsage={harmonicInsights?.degreeUsage ?? []}
          />

          <RelatedKeysPanel
            keyName={analysis.harmony.key}
            mode={analysis.harmony.mode}
            relativeKey={analysis.harmony.relative_key}
            parallelKey={analysis.harmony.parallel_key}
          />

          <MusicMapPanel
            durationSeconds={song.duration_seconds ?? analysis.metadata.duration_seconds}
            sections={analysis.structure.sections}
            progression={harmonicInsights?.progression ?? analysis.harmony.chord_progression}
            keyName={analysis.harmony.key}
            mode={analysis.harmony.mode}
          />

          {stemsQuery.data && songId ? <StemsPanel songId={songId} stems={stemsQuery.data} /> : null}

          <article className="rounded-xl border border-slate-800 p-4 md:col-span-2">
            <h2 className="font-medium">Explicação educacional</h2>
            <p className="mt-2 text-slate-300">{analysis.educational?.[0]?.summary}</p>
          </article>
        </div>
      ) : isProcessing ? null : (
        <p className="text-slate-400">Resultado da análise indisponível.</p>
      )}
    </section>
  );
}
