import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { CifraViewer } from "../components/cifra/CifraViewer";
import { CifraPlaybackKeyProvider } from "../components/cifra/cifra-playback-key-context";
import { CifraScrollProvider } from "../components/cifra/cifra-scroll-context";
import { SongAudioPlayer } from "../components/audio/SongAudioPlayer";
import { authFetch, fetchSong } from "../lib/api";
import { useBand } from "../lib/band-context";
import { btnPrimary, panelClass } from "../lib/ui-classes";

function readInitialFooterMinimized(): boolean {
  try {
    return localStorage.getItem("softmusic:audio-footer-minimized") === "true";
  } catch {
    return false;
  }
}

export default function SongCifraPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const { activeBand } = useBand();
  const blocked = Boolean(activeBand?.is_blocked);
  const [blockModalOpen, setBlockModalOpen] = useState(blocked);
  const [searchParams] = useSearchParams();
  const initialVariationId = searchParams.get("variation") ?? undefined;
  const [audioFooterMinimized, setAudioFooterMinimized] = useState(readInitialFooterMinimized);

  useEffect(() => {
    if (blocked) setBlockModalOpen(true);
  }, [blocked]);

  const songQuery = useQuery({
    queryKey: ["song", songId],
    queryFn: () => fetchSong(songId!),
    enabled: Boolean(songId) && !blocked,
    refetchInterval: (query) => (query.state.data?.status === "completed" ? false : 5000),
  });

  const chordsQuery = useQuery({
    queryKey: ["chords", songId],
    queryFn: async () => {
      const response = await authFetch(`/songs/${songId}/chords`);
      if (!response.ok) throw new Error("Cifra indisponível");
      return response.json();
    },
    enabled: !blocked && songQuery.data?.status === "completed",
  });

  if (blockModalOpen) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center">
        <div className={`${panelClass} w-full max-w-md space-y-4 border-amber-400/30 p-5`}>
          <h2 className="text-lg font-semibold text-amber-100">Conteúdo indisponível</h2>
          <p className="text-sm text-slate-300">
            Não é possível acessar este conteúdo. A banda está bloqueada por falta de pagamento.
          </p>
          <button
            type="button"
            className={`${btnPrimary} w-full`}
            onClick={() => {
              setBlockModalOpen(false);
              navigate("/");
            }}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (songQuery.isLoading) {
    return <p className="text-slate-400">Carregando cifra...</p>;
  }

  if (songQuery.isError || !songQuery.data) {
    return (
      <div className="space-y-3">
        <p className="text-red-400">Não foi possível carregar a música.</p>
        <Link to="/library" className="text-green-300 underline">
          Voltar para biblioteca
        </Link>
      </div>
    );
  }

  if (songQuery.data.status !== "completed") {
    return (
      <div className="space-y-3">
        <p className="text-slate-400">Análise em processamento. A cifra ficará disponível em breve.</p>
        <Link to={`/songs/${songId}`} className="text-green-300 underline">
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
    <CifraPlaybackKeyProvider>
      <CifraScrollProvider bpm={chordsQuery.data.tempo_bpm} songId={songId!}>
        <section
          className={`min-w-0 max-w-full space-y-4 transition-[padding] duration-200 ${
            audioFooterMinimized
              ? "pb-28"
              : hasMetronomePadding(chordsQuery.data.tempo_bpm)
                ? "pb-[26rem]"
                : "pb-64"
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
    </CifraPlaybackKeyProvider>
  );
}

function hasMetronomePadding(bpm: number | null | undefined): boolean {
  return typeof bpm === "number" && bpm > 0;
}
