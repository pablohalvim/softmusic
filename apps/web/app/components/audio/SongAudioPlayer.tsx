import { useEffect, useRef, useState } from "react";

import { fetchAuthenticatedBlob } from "../../lib/api";
import { CifraScrollControl } from "./CifraScrollControl";
import { MetronomeClick, type MetronomeClickHandle } from "./MetronomeClick";
import { loadAudioVolume, saveAudioVolume } from "./volume-prefs";
import { VolumeControl } from "./VolumeControl";

const SYNC_STORAGE_KEY = "softmusic:sync-metronome-audio";
const FOOTER_MINIMIZED_KEY = "softmusic:audio-footer-minimized";

type SongAudioPlayerLayout = "inline" | "fixed-footer";

interface SongAudioPlayerProps {
  songId: string;
  title?: string | null;
  bpm?: number | null;
  beatsPerMeasure?: number;
  className?: string;
  layout?: SongAudioPlayerLayout;
  showCifraScrollControl?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
}

function readFooterMinimized(): boolean {
  try {
    return localStorage.getItem(FOOTER_MINIMIZED_KEY) === "true";
  } catch {
    return false;
  }
}

export function SongAudioPlayer({
  songId,
  title,
  bpm,
  beatsPerMeasure = 4,
  className,
  layout = "inline",
  showCifraScrollControl = false,
  onMinimizedChange,
}: SongAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const hasMetronome = typeof bpm === "number" && bpm > 0;
  const isFixedFooter = layout === "fixed-footer";

  const audioRef = useRef<HTMLAudioElement>(null);
  const metronomeRef = useRef<MetronomeClickHandle>(null);
  const [syncMetronome, setSyncMetronome] = useState(false);
  const [audioVolume, setAudioVolume] = useState(loadAudioVolume);
  const [minimized, setMinimized] = useState(() => (isFixedFooter ? readFooterMinimized() : false));

  useEffect(() => {
    let objectUrl: string | null = null;
    void fetchAuthenticatedBlob(`/songs/${songId}/audio`)
      .then((url) => {
        objectUrl = url;
        setAudioUrl(url);
      })
      .catch(() => setAudioUrl(null));
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [songId]);

  useEffect(() => {
    try {
      setSyncMetronome(localStorage.getItem(SYNC_STORAGE_KEY) === "true");
    } catch {
      setSyncMetronome(false);
    }
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = audioVolume;
    }
  }, [audioVolume, songId]);

  useEffect(() => {
    if (!isFixedFooter) return;
    onMinimizedChange?.(minimized);
  }, [isFixedFooter, minimized, onMinimizedChange]);

  const handleSyncChange = (checked: boolean) => {
    setSyncMetronome(checked);
    try {
      localStorage.setItem(SYNC_STORAGE_KEY, String(checked));
    } catch {
      // ignore storage errors
    }
  };

  const handleAudioVolumeChange = (value: number) => {
    setAudioVolume(value);
    saveAudioVolume(value);
    if (audioRef.current) {
      audioRef.current.volume = value;
    }
  };

  const handleAudioPlay = () => {
    if (!syncMetronome) return;
    void metronomeRef.current?.start();
  };

  const handleAudioPause = () => {
    if (!syncMetronome) return;
    metronomeRef.current?.stop();
  };

  const setFooterMinimized = (next: boolean) => {
    setMinimized(next);
    try {
      localStorage.setItem(FOOTER_MINIMIZED_KEY, String(next));
    } catch {
      // ignore storage errors
    }
  };

  const volumeControl = (
    <VolumeControl
      label="Volume da música"
      value={audioVolume}
      onChange={handleAudioVolumeChange}
      className="mt-2"
    />
  );

  const audioElement = (
    <audio
      ref={audioRef}
      controls
      preload="metadata"
      src={audioUrl ?? undefined}
      data-softmusic-song-audio={songId}
      className={minimized && isFixedFooter ? "h-9 min-w-0 flex-1" : isFixedFooter ? "w-full" : "mt-3 w-full"}
      aria-label={title ? `Reproduzir ${title}` : "Reproduzir música"}
      onPlay={handleAudioPlay}
      onPause={handleAudioPause}
      onEnded={handleAudioPause}
    >
      Seu navegador não suporta reprodução de áudio.
    </audio>
  );

  const metronomeExtras = hasMetronome ? (
    <>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={syncMetronome}
          onChange={(event) => handleSyncChange(event.target.checked)}
          className="rounded border-slate-600 bg-slate-950 text-orange-500 focus:ring-orange-500/40"
        />
        Iniciar metrônomo junto com o áudio
      </label>
      <MetronomeClick
        ref={metronomeRef}
        bpm={bpm}
        beatsPerMeasure={beatsPerMeasure}
        className={isFixedFooter ? "mt-2 pt-0" : undefined}
      />
    </>
  ) : null;

  const scrollControl = showCifraScrollControl ? <CifraScrollControl compact={minimized && isFixedFooter} /> : null;

  if (isFixedFooter && minimized) {
    return (
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/50 bg-slate-950/75 backdrop-blur-sm ${className ?? ""}`}
      >
        <div className="mx-auto max-w-6xl px-4 py-2.5">
          <div className="flex items-center gap-3">
            {scrollControl}
            {audioElement}
            <button
              type="button"
              onClick={() => setFooterMinimized(false)}
              className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              aria-label="Expandir painel de áudio"
            >
              Expandir
            </button>
          </div>
        </div>
      </div>
    );
  }

  const panelBody = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-slate-100">Áudio</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Áudio protegido</span>
          {isFixedFooter ? (
            <button
              type="button"
              onClick={() => setFooterMinimized(true)}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              aria-label="Minimizar painel de áudio"
            >
              Minimizar
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {scrollControl}
        <div className="min-w-0 flex-1">{audioElement}</div>
      </div>
      {volumeControl}
      {metronomeExtras}
    </>
  );

  if (isFixedFooter) {
    return (
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/50 bg-slate-950/75 backdrop-blur-sm ${className ?? ""}`}
      >
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-4">
          {panelBody}
        </div>
      </div>
    );
  }

  return (
    <article className={`rounded-xl border border-slate-800 bg-slate-900/60 p-4 ${className ?? ""}`}>
      {panelBody}
    </article>
  );
}
