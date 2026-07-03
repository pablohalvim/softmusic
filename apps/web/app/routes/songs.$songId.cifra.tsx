import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";

import { CifraViewer } from "../components/cifra/CifraViewer";
import { CifraScrollProvider } from "../components/cifra/cifra-scroll-context";
import { SongAudioPlayer } from "../components/audio/SongAudioPlayer";
import { authFetch, fetchSong } from "../lib/api";

function readInitialFooterMinimized(): boolean {
  try {
    return localStorage.getItem("softmusic:audio-footer-minimized") === "true";
  } catch {
    return false;
  }
}

export default function SongCifraPage() {
  const { songId } = useParams();
  const [searchParams] = useSearchParams();
  const initialVariationId = searchParams.get("variation") ?? undefined;
  const [audioFooterMinimized, setAudioFooterMinimized] = useState(readInitialFooterMinimized);

  const songQuery = useQuery({
    queryKey: ["song", songId],
    queryFn: () => fetchSong(songId!),
    enabled: Boolean(songId),
    refetchInterval: (query) => (query.state.data?.status === "completed" ? false : 3000),
  });

  const chordsQuery = useQuery({
    queryKey: ["chords", songId],
    queryFn: async () => {
      const response = await authFetch(`/songs/${songId}/chords`);
      if (!response.ok) throw new Error("Cifra indisponível");
      return response.json();
    },
    enabled: songQuery.data?.status === "completed",
  });

  if (songQuery.isLoading) {
    return <p className="text-slate-400">Carregando cifra...</p>;
  }

  if (songQuery.isError || !songQuery.data) {
    return (
      <div className="space-y-3">
        <p className="text-red-400">Não foi possível carregar a música.</p>
        <Link to="/library" className="text-indigo-300 underline">
          Voltar para biblioteca
        </Link>
      </div>
    );
  }

  if (songQuery.data.status !== "completed") {
    return (
      <div className="space-y-3">
        <p className="text-slate-400">Análise em processamento. A cifra ficará disponível em breve.</p>
        <Link to={`/songs/${songId}`} className="text-indigo-300 underline">
          Acompanhar análise
        </Link>
      </div>
    );
  }

  if (chordsQuery.isLoading) {
    return <p className="text-slate-400">Gerando cifra...</p>;
  }

  if (chordsQuery.isError || !chordsQuery.data) {
    return <p className="text-red-400">Não foi possível carregar a cifra.</p>;
  }

  return (
    <CifraScrollProvider bpm={chordsQuery.data.tempo_bpm} songId={songId!}>
      <section
        className={`min-w-0 max-w-full space-y-4 transition-[padding] duration-200 ${
          audioFooterMinimized ? "pb-28" : hasMetronomePadding(chordsQuery.data.tempo_bpm) ? "pb-[26rem]" : "pb-64"
        }`}
      >
        <CifraViewer
          songId={songId!}
          songTitle={songQuery.data.title ?? chordsQuery.data.title ?? "Música sem título"}
          artist={songQuery.data.artist ?? chordsQuery.data.artist}
          chordData={chordsQuery.data}
          initialVariationId={initialVariationId}
        />
      </section>
      <SongAudioPlayer
        songId={songId!}
        title={songQuery.data.title ?? chordsQuery.data.title}
        bpm={chordsQuery.data.tempo_bpm}
        layout="fixed-footer"
        showCifraScrollControl
        onMinimizedChange={setAudioFooterMinimized}
      />
    </CifraScrollProvider>
  );
}

function hasMetronomePadding(bpm: number | null | undefined): boolean {
  return typeof bpm === "number" && bpm > 0;
}
