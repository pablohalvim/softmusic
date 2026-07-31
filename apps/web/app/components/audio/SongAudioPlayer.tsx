import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authFetch, resolveAuthenticatedMediaUrl } from "../../lib/api";
import {
  btnGhost,
  panelClass,
  segmentedActiveClass,
  segmentedIdleClass,
  segmentedWrapClass,
} from "../../lib/ui-classes";
import { CifraScrollControl } from "./CifraScrollControl";
import { MetronomeClick, type MetronomeClickHandle } from "./MetronomeClick";
import {
  formatPlaybackTime,
  stemLabel,
  type StemsManifest,
} from "./stem-labels";
import { loadAudioVolume, saveAudioVolume } from "./volume-prefs";
import { VolumeControl } from "./VolumeControl";

const SYNC_STORAGE_KEY = "softmusic:sync-metronome-audio";
const FOOTER_MINIMIZED_KEY = "softmusic:audio-footer-minimized";
const PLAYBACK_MODE_KEY = "softmusic:audio-playback-mode";

type SongAudioPlayerLayout = "inline" | "fixed-footer";
type PlaybackMode = "original" | "stems";

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

function readPlaybackMode(): PlaybackMode {
  try {
    return localStorage.getItem(PLAYBACK_MODE_KEY) === "stems" ? "stems" : "original";
  } catch {
    return "original";
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
  const [stemsManifest, setStemsManifest] = useState<StemsManifest | null>(null);
  const [stemUrls, setStemUrls] = useState<Record<string, string>>({});
  const [stemsLoading, setStemsLoading] = useState(false);
  const [stemsError, setStemsError] = useState<string | null>(null);
  const [mode, setMode] = useState<PlaybackMode>(readPlaybackMode);
  const [enabledStems, setEnabledStems] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const hasMetronome = typeof bpm === "number" && bpm > 0;
  const isFixedFooter = layout === "fixed-footer";

  const audioRef = useRef<HTMLAudioElement>(null);
  const stemAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const metronomeRef = useRef<MetronomeClickHandle>(null);
  const [syncMetronome, setSyncMetronome] = useState(false);
  const [audioVolume, setAudioVolume] = useState(loadAudioVolume);
  const [minimized, setMinimized] = useState(() => (isFixedFooter ? readFooterMinimized() : false));

  const availableStems = useMemo(
    () => (stemsManifest?.stems ?? []).filter((stem) => stem.available !== false),
    [stemsManifest],
  );
  const stemsReady = availableStems.length > 0 && Object.keys(stemUrls).length > 0;
  const canUseStems = Boolean(stemsManifest?.separated && availableStems.length > 0);
  const effectiveMode: PlaybackMode = mode === "stems" && canUseStems ? "stems" : "original";

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setAudioUrl(null);
    void resolveAuthenticatedMediaUrl(`/songs/${songId}/audio`)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.isObjectUrl) URL.revokeObjectURL(resolved.url);
          return;
        }
        if (resolved.isObjectUrl) objectUrl = resolved.url;
        setAudioUrl(resolved.url);
      })
      .catch(() => {
        if (!cancelled) setAudioUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [songId]);

  useEffect(() => {
    let cancelled = false;
    setStemsManifest(null);
    setStemUrls({});
    setStemsLoading(false);
    setStemsError(null);
    void authFetch(`/songs/${songId}/stems`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Stems indisponíveis");
        const data = (await response.json()) as StemsManifest;
        if (!cancelled) setStemsManifest(data);
      })
      .catch(() => {
        if (!cancelled) setStemsManifest({ song_id: songId, separated: false, stems: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const availableStemKey = availableStems.map((stem) => stem.name).join("|");

  useEffect(() => {
    if (!canUseStems || !availableStemKey) {
      setStemsLoading(false);
      return;
    }
    const names = availableStemKey.split("|");
    setEnabledStems(new Set(names));

    let cancelled = false;
    const objectUrls: string[] = [];
    setStemsLoading(true);
    setStemsError(null);
    setStemUrls({});

    void Promise.all(
      names.map(async (name) => {
        const resolved = await resolveAuthenticatedMediaUrl(
          `/songs/${songId}/stems/${encodeURIComponent(name)}/audio`,
        );
        if (resolved.isObjectUrl) objectUrls.push(resolved.url);
        return [name, resolved.url] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) {
          for (const url of objectUrls) URL.revokeObjectURL(url);
          return;
        }
        setStemUrls(Object.fromEntries(entries));
        setStemsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        for (const url of objectUrls) URL.revokeObjectURL(url);
        setStemUrls({});
        setStemsLoading(false);
        setStemsError("Não foi possível carregar os stems.");
      });

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [songId, canUseStems, availableStemKey]);

  useEffect(() => {
    try {
      setSyncMetronome(localStorage.getItem(SYNC_STORAGE_KEY) === "true");
    } catch {
      setSyncMetronome(false);
    }
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = audioVolume;
    for (const el of stemAudioRefs.current.values()) {
      el.volume = audioVolume;
    }
  }, [audioVolume, songId, stemUrls]);

  useEffect(() => {
    if (!isFixedFooter) return;
    onMinimizedChange?.(minimized);
  }, [isFixedFooter, minimized, onMinimizedChange]);

  const pauseEverything = useCallback(() => {
    audioRef.current?.pause();
    for (const el of stemAudioRefs.current.values()) {
      el.pause();
    }
    setPlaying(false);
  }, []);

  const getMasterStem = useCallback((): HTMLAudioElement | null => {
    for (const name of enabledStems) {
      const el = stemAudioRefs.current.get(name);
      if (el && stemUrls[name]) return el;
    }
    for (const name of Object.keys(stemUrls)) {
      const el = stemAudioRefs.current.get(name);
      if (el) return el;
    }
    return null;
  }, [enabledStems, stemUrls]);

  const seekAll = useCallback(
    (time: number) => {
      const safe = Math.max(0, time);
      if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
        audioRef.current.currentTime = Math.min(safe, audioRef.current.duration || safe);
      }
      for (const el of stemAudioRefs.current.values()) {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          el.currentTime = Math.min(safe, el.duration);
        } else {
          el.currentTime = safe;
        }
      }
      setCurrentTime(safe);
    },
    [],
  );

  const playOriginal = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    for (const el of stemAudioRefs.current.values()) el.pause();
    await audio.play();
    setPlaying(true);
  }, []);

  const playStems = useCallback(async () => {
    audioRef.current?.pause();
    const master = getMasterStem();
    const t = master?.currentTime ?? currentTime;
    const selected = [...enabledStems].filter((name) => stemUrls[name]);
    if (selected.length === 0) return;

    for (const [name, el] of stemAudioRefs.current.entries()) {
      if (!selected.includes(name)) {
        el.pause();
        continue;
      }
      if (Number.isFinite(el.duration) && el.duration > 0) {
        el.currentTime = Math.min(t, el.duration);
      } else {
        el.currentTime = t;
      }
      el.volume = audioVolume;
    }

    await Promise.all(
      selected.map(async (name) => {
        const el = stemAudioRefs.current.get(name);
        if (el) await el.play();
      }),
    );
    setPlaying(true);
  }, [audioVolume, currentTime, enabledStems, getMasterStem, stemUrls]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      pauseEverything();
      if (syncMetronome) metronomeRef.current?.stop();
      return;
    }
    try {
      if (effectiveMode === "stems") {
        await playStems();
      } else {
        await playOriginal();
      }
      if (syncMetronome) void metronomeRef.current?.start();
    } catch {
      setPlaying(false);
    }
  }, [effectiveMode, pauseEverything, playOriginal, playStems, playing, syncMetronome]);

  const handleModeChange = (next: PlaybackMode) => {
    if (next === mode) return;
    pauseEverything();
    if (syncMetronome) metronomeRef.current?.stop();
    setMode(next);
    try {
      localStorage.setItem(PLAYBACK_MODE_KEY, next);
    } catch {
      // ignore
    }
  };

  const handleSyncChange = (checked: boolean) => {
    setSyncMetronome(checked);
    try {
      localStorage.setItem(SYNC_STORAGE_KEY, String(checked));
    } catch {
      // ignore
    }
  };

  const handleAudioVolumeChange = (value: number) => {
    setAudioVolume(value);
    saveAudioVolume(value);
    if (audioRef.current) audioRef.current.volume = value;
    for (const el of stemAudioRefs.current.values()) {
      el.volume = value;
    }
  };

  const setFooterMinimized = (next: boolean) => {
    setMinimized(next);
    try {
      localStorage.setItem(FOOTER_MINIMIZED_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const toggleStem = (name: string) => {
    setEnabledStems((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  useEffect(() => {
    if (effectiveMode !== "stems" || !playing) return;
    const selected = [...enabledStems].filter((name) => stemUrls[name]);
    if (selected.length === 0) {
      pauseEverything();
      if (syncMetronome) metronomeRef.current?.stop();
      return;
    }
    void playStems();
    // Reaplica play só quando a seleção de faixas muda durante a reprodução.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledStems, effectiveMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || effectiveMode !== "original") return;

    const onTime = () => {
      setCurrentTime(audio.currentTime || 0);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      if (syncMetronome) metronomeRef.current?.stop();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [effectiveMode, audioUrl, syncMetronome]);

  useEffect(() => {
    if (effectiveMode !== "stems") return;
    const master = getMasterStem();
    if (!master) return;

    const onTime = () => {
      setCurrentTime(master.currentTime || 0);
      if (Number.isFinite(master.duration) && master.duration > 0) {
        setDuration(master.duration);
      }
    };
    const onEnded = () => {
      pauseEverything();
      if (syncMetronome) metronomeRef.current?.stop();
    };

    master.addEventListener("timeupdate", onTime);
    master.addEventListener("loadedmetadata", onTime);
    master.addEventListener("ended", onEnded);

    const driftTimer = window.setInterval(() => {
      if (!playing) return;
      const lead = getMasterStem();
      if (!lead) return;
      const t = lead.currentTime;
      for (const [name, el] of stemAudioRefs.current.entries()) {
        if (!enabledStems.has(name) || el === lead) continue;
        if (Math.abs(el.currentTime - t) > 0.08) {
          el.currentTime = t;
        }
      }
    }, 400);

    return () => {
      master.removeEventListener("timeupdate", onTime);
      master.removeEventListener("loadedmetadata", onTime);
      master.removeEventListener("ended", onEnded);
      window.clearInterval(driftTimer);
    };
  }, [effectiveMode, enabledStems, getMasterStem, pauseEverything, playing, stemUrls, syncMetronome]);

  useEffect(() => {
    if (effectiveMode === "stems") {
      const master = getMasterStem();
      if (master && Number.isFinite(master.duration) && master.duration > 0) {
        setDuration(master.duration);
      } else if (availableStems[0]?.duration_seconds) {
        setDuration(availableStems[0].duration_seconds);
      }
    }
  }, [availableStems, effectiveMode, getMasterStem, stemUrls]);

  const registerStemRef = (name: string, el: HTMLAudioElement | null) => {
    if (el) {
      stemAudioRefs.current.set(name, el);
      el.volume = audioVolume;
    } else {
      stemAudioRefs.current.delete(name);
    }
  };

  const masterStemName = useMemo(() => {
    for (const name of enabledStems) {
      if (stemUrls[name]) return name;
    }
    return availableStems[0]?.name ?? "";
  }, [availableStems, enabledStems, stemUrls]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const transport = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void togglePlay()}
          disabled={
            effectiveMode === "original"
              ? !audioUrl
              : !stemsReady || enabledStems.size === 0 || stemsLoading
          }
          className={`${btnGhost} shrink-0 px-3 py-1.5 text-xs disabled:opacity-40`}
          aria-label={playing ? "Pausar" : "Reproduzir"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="min-w-[4.5rem] tabular-nums text-xs text-slate-400">
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
        </span>
        <input
          id="playback-progress"
          name="playback-progress"
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          disabled={duration <= 0}
          onChange={(event) => {
            const next = Number(event.target.value);
            seekAll(next);
          }}
          className="accent-chord h-3 min-w-0 flex-1 cursor-pointer disabled:opacity-40"
          aria-label="Progresso da música"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          style={{
            background: `linear-gradient(to right, #4ade80 ${progressPercent}%, rgba(255,255,255,0.12) ${progressPercent}%)`,
          }}
        />
      </div>
    </div>
  );

  const stemsBusy = stemsLoading && !stemsReady;
  const showStemsPanel = mode === "stems" && canUseStems;

  const modeToggle = canUseStems ? (
    <div className={`${segmentedWrapClass} !p-1`} role="group" aria-label="Fonte de áudio">
      <button
        type="button"
        className={mode === "original" ? segmentedActiveClass : segmentedIdleClass}
        onClick={() => handleModeChange("original")}
      >
        Música original
      </button>
      <button
        type="button"
        className={mode === "stems" ? segmentedActiveClass : segmentedIdleClass}
        onClick={() => handleModeChange("stems")}
        aria-busy={stemsBusy || undefined}
      >
        {stemsBusy ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-r-transparent"
              aria-hidden
            />
            Carregando…
          </span>
        ) : (
          "Stems"
        )}
      </button>
    </div>
  ) : null;

  const stemsPicker = showStemsPanel ? (
      <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Faixas (Demucs)</p>
          {!stemsBusy ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs text-green-300 hover:text-green-200"
                onClick={() => setEnabledStems(new Set(availableStems.map((s) => s.name)))}
              >
                Todas
              </button>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-200"
                onClick={() => setEnabledStems(new Set())}
              >
                Nenhuma
              </button>
            </div>
          ) : null}
        </div>
        {stemsBusy ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-4 text-sm text-slate-300"
            role="status"
            aria-live="polite"
          >
            <span
              className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-green-400 border-r-transparent"
              aria-hidden
            />
            <span>Carregando faixas separadas…</span>
          </div>
        ) : null}
        {stemsError ? <p className="text-xs text-amber-300">{stemsError}</p> : null}
        {!stemsBusy ? (
          <>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {availableStems.map((stem) => {
                const checked = enabledStems.has(stem.name);
                const loaded = Boolean(stemUrls[stem.name]);
                return (
                  <li key={stem.name}>
                    <label
                      htmlFor={`stem-${stem.name}`}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-white/[0.04]"
                    >
                      <input
                        id={`stem-${stem.name}`}
                        name={`stem-${stem.name}`}
                        type="checkbox"
                        checked={checked}
                        disabled={!loaded}
                        onChange={() => toggleStem(stem.name)}
                        className="accent-brand rounded border-white/20 bg-black/30"
                      />
                      <span className={!loaded ? "text-slate-500" : undefined}>
                        {stemLabel(stem.name)}
                        {!loaded ? "…" : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {enabledStems.size === 0 ? (
              <p className="text-xs text-amber-300/90">Marque ao menos uma faixa para tocar.</p>
            ) : (
              <p className="text-xs text-slate-500">
                As faixas marcadas tocam juntas. Desmarque o instrumento que você toca para treinar.
              </p>
            )}
          </>
        ) : null}
      </div>
    ) : null;

  const hiddenStemAudios = availableStems.map((stem) => {
    const url = stemUrls[stem.name];
    if (!url) return null;
    const isMaster = effectiveMode === "stems" && stem.name === masterStemName;
    return (
      <audio
        key={stem.name}
        ref={(el) => registerStemRef(stem.name, el)}
        preload="metadata"
        src={url}
        data-softmusic-song-audio={isMaster ? songId : undefined}
        className="hidden"
        aria-hidden
      />
    );
  });

  const originalAudio = (
    <audio
      ref={audioRef}
      preload="metadata"
      src={audioUrl ?? undefined}
      data-softmusic-song-audio={effectiveMode === "original" ? songId : undefined}
      className="hidden"
      aria-label={title ? `Reproduzir ${title}` : "Reproduzir música"}
      onPlay={() => {
        if (syncMetronome && effectiveMode === "original") void metronomeRef.current?.start();
      }}
      onPause={() => {
        if (syncMetronome && effectiveMode === "original") metronomeRef.current?.stop();
      }}
      onEnded={() => {
        if (syncMetronome && effectiveMode === "original") metronomeRef.current?.stop();
      }}
    >
      Seu navegador não suporta reprodução de áudio.
    </audio>
  );

  const volumeControl = (
    <VolumeControl
      label="Volume da música"
      value={audioVolume}
      onChange={handleAudioVolumeChange}
      className="mt-2"
    />
  );

  const metronomeExtras = hasMetronome ? (
    <>
      <label
        htmlFor="sync-metronome"
        className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-300"
      >
        <input
          id="sync-metronome"
          name="sync-metronome"
          type="checkbox"
          checked={syncMetronome}
          onChange={(event) => handleSyncChange(event.target.checked)}
          className="accent-brand rounded border-white/20 bg-black/30"
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

  const scrollControl = showCifraScrollControl ? (
    <CifraScrollControl compact={minimized && isFixedFooter} />
  ) : null;

  if (isFixedFooter && minimized) {
    return (
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#020806]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl ${className ?? ""}`}
      >
        <div className="mx-auto max-w-6xl px-4 py-2.5">
          <div className="flex items-center gap-3">
            {scrollControl}
            <div className="min-w-0 flex-1">
              {originalAudio}
              {hiddenStemAudios}
              {transport}
            </div>
            <button
              type="button"
              onClick={() => setFooterMinimized(false)}
              className={`${btnGhost} shrink-0 px-3 py-1.5 text-xs`}
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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <h2 className="font-medium text-slate-100">Áudio</h2>
          {modeToggle}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Áudio protegido</span>
          {isFixedFooter ? (
            <button
              type="button"
              onClick={() => setFooterMinimized(true)}
              className={`${btnGhost} px-2.5 py-1 text-xs`}
              aria-label="Minimizar painel de áudio"
            >
              Minimizar
            </button>
          ) : null}
        </div>
      </div>

      {originalAudio}
      {hiddenStemAudios}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
        {scrollControl}
        <div className="min-w-0 flex-1 space-y-3">
          {transport}
          {stemsPicker}
        </div>
      </div>
      {volumeControl}
      {metronomeExtras}
    </>
  );

  if (isFixedFooter) {
    return (
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#020806]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl ${className ?? ""}`}
      >
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-4">{panelBody}</div>
      </div>
    );
  }

  return <article className={`${panelClass} ${className ?? ""}`}>{panelBody}</article>;
}
