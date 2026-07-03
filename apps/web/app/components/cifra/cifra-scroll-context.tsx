import { cifraScrollPixelsPerSecond } from "@softmusic/shared/cifra-scroll";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  loadCifraAutoScrollPrefs,
  saveCifraAutoScrollPrefs,
} from "./cifra-auto-scroll-prefs";
import { useCifraAutoScroll } from "./useCifraAutoScroll";

interface CifraScrollContextValue {
  playing: boolean;
  togglePlaying: () => void;
  stopPlaying: () => void;
  speedMultiplier: number;
  setSpeedMultiplier: (value: number) => void;
  syncWithAudio: boolean;
  setSyncWithAudio: (value: boolean) => void;
  pixelsPerSecond: number;
  bpm: number;
}

const CifraScrollContext = createContext<CifraScrollContextValue | null>(null);

export function CifraScrollProvider({
  bpm,
  songId,
  children,
}: {
  bpm: number;
  songId: string;
  children: ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(
    () => loadCifraAutoScrollPrefs().speedMultiplier,
  );
  const [syncWithAudio, setSyncWithAudio] = useState(
    () => loadCifraAutoScrollPrefs().syncWithAudio,
  );

  const pixelsPerSecond = useMemo(
    () => cifraScrollPixelsPerSecond({ bpm, speedMultiplier }),
    [bpm, speedMultiplier],
  );

  useCifraAutoScroll({
    playing,
    bpm,
    speedMultiplier,
    syncWithAudio,
    songId,
  });

  useEffect(() => {
    saveCifraAutoScrollPrefs({ speedMultiplier, syncWithAudio });
  }, [speedMultiplier, syncWithAudio]);

  const togglePlaying = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    if (syncWithAudio) {
      const audio = document.querySelector<HTMLAudioElement>(
        `[data-softmusic-song-audio="${songId}"]`,
      );
      if (audio?.paused) {
        void audio.play().catch(() => {
          // Autoplay pode ser bloqueado até outro gesto do usuário.
        });
      }
    }
  }, [playing, songId, syncWithAudio]);

  const stopPlaying = useCallback(() => setPlaying(false), []);

  const value = useMemo(
    () => ({
      playing,
      togglePlaying,
      stopPlaying,
      speedMultiplier,
      setSpeedMultiplier,
      syncWithAudio,
      setSyncWithAudio,
      pixelsPerSecond,
      bpm,
    }),
    [
      playing,
      togglePlaying,
      stopPlaying,
      speedMultiplier,
      syncWithAudio,
      pixelsPerSecond,
      bpm,
    ],
  );

  return <CifraScrollContext.Provider value={value}>{children}</CifraScrollContext.Provider>;
}

export function useCifraScroll(): CifraScrollContextValue {
  const context = useContext(CifraScrollContext);
  if (!context) {
    throw new Error("useCifraScroll deve ser usado dentro de CifraScrollProvider");
  }
  return context;
}

export function useOptionalCifraScroll(): CifraScrollContextValue | null {
  return useContext(CifraScrollContext);
}
