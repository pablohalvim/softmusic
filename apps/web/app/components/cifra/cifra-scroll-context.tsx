import { cifraScrollPixelsPerSecond } from "@softmusic/shared/cifra-scroll";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /** Play/Pause do áudio liga/desliga a rolagem quando a sync estiver ativa. */
  syncScrollWithAudioPlayback: (audioPlaying: boolean) => void;
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
  const syncWithAudioRef = useRef(syncWithAudio);
  syncWithAudioRef.current = syncWithAudio;

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

  const syncScrollWithAudioPlayback = useCallback((audioPlaying: boolean) => {
    if (!syncWithAudioRef.current) return;
    setPlaying((prev) => (prev === audioPlaying ? prev : audioPlaying));
  }, []);

  /** Só liga/desliga a rolagem da cifra — nunca toca ou pausa o áudio. */
  const togglePlaying = useCallback(() => {
    setPlaying((prev) => !prev);
  }, []);

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
      syncScrollWithAudioPlayback,
    }),
    [
      playing,
      togglePlaying,
      stopPlaying,
      speedMultiplier,
      syncWithAudio,
      pixelsPerSecond,
      bpm,
      syncScrollWithAudioPlayback,
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
