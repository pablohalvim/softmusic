import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface CifraPlaybackKeyContextValue {
  /** Tom sonoro da cifra (ignora capo). Null = ainda não definido. */
  soundingKey: string | null;
  sourceKey: string | null;
  useOriginalAudio: boolean;
  setSoundingKey: (key: string | null) => void;
  setSourceKey: (key: string | null) => void;
  setUseOriginalAudio: (value: boolean) => void;
}

const CifraPlaybackKeyContext = createContext<CifraPlaybackKeyContextValue | null>(null);

export function CifraPlaybackKeyProvider({ children }: { children: ReactNode }) {
  const [soundingKey, setSoundingKey] = useState<string | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [useOriginalAudio, setUseOriginalAudio] = useState(false);

  const value = useMemo(
    () => ({
      soundingKey,
      sourceKey,
      useOriginalAudio,
      setSoundingKey,
      setSourceKey,
      setUseOriginalAudio,
    }),
    [soundingKey, sourceKey, useOriginalAudio],
  );

  return (
    <CifraPlaybackKeyContext.Provider value={value}>{children}</CifraPlaybackKeyContext.Provider>
  );
}

export function useCifraPlaybackKey() {
  return useContext(CifraPlaybackKeyContext);
}

/** Safe setter used inside CifraViewer when provider may be absent (song detail page). */
export function useOptionalCifraPlaybackKeySync() {
  const ctx = useCifraPlaybackKey();
  const sync = useCallback(
    (soundingKey: string, sourceKey: string) => {
      if (!ctx) return;
      ctx.setSoundingKey(soundingKey);
      ctx.setSourceKey(sourceKey);
    },
    [ctx],
  );
  return { ctx, sync };
}
