import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  authFetch,
  fetchJob,
  fetchMultitrack,
  fetchMultitracks,
  fetchSongKeys,
  isJobFinished,
  multitrackMatchesKey,
  normalizeMusicKeyLabel,
  requestSongKeyVariant,
  resolveAuthenticatedMediaUrl,
  songKeyAudioPath,
  songKeyStemAudioPath,
  songKeyStemsPath,
  updateMultitrack,
  updateMultitrackTrack,
} from "../../lib/api";
import { useCifraPlaybackKey } from "../cifra/cifra-playback-key-context";
import { useOptionalCifraScroll } from "../cifra/cifra-scroll-context";
import {
  MultitrackMixer,
  type MultitrackMixerHandle,
} from "../multitracks/MultitrackMixer";
import { useToast } from "../../lib/toast";
import {
  btnGhost,
  btnPrimary,
  cifraSelectClass,
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
type PlaybackMode = "original" | "stems" | "multitrack";

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
    const raw = localStorage.getItem(PLAYBACK_MODE_KEY);
    if (raw === "stems" || raw === "multitrack") return raw;
    return "original";
  } catch {
    return "original";
  }
}

type KeyAudioStatus = "original" | "ready" | "missing" | "queued" | "processing" | "failed";

interface KeyStemsManifest extends StemsManifest {
  status?: string;
  message?: string;
  job_id?: string | null;
  error?: string | null;
  target_key?: string;
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const playbackKey = useCifraPlaybackKey();
  const cifraScroll = useOptionalCifraScroll();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [stemsManifest, setStemsManifest] = useState<KeyStemsManifest | null>(null);
  const [stemUrls, setStemUrls] = useState<Record<string, string>>({});
  const [stemsLoading, setStemsLoading] = useState(false);
  const [stemsError, setStemsError] = useState<string | null>(null);
  const [keyAudioStatus, setKeyAudioStatus] = useState<KeyAudioStatus>("original");
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
  const multitrackMixerRef = useRef<MultitrackMixerHandle>(null);
  const [syncMetronome, setSyncMetronome] = useState(false);
  const [audioVolume, setAudioVolume] = useState(loadAudioVolume);
  const [minimized, setMinimized] = useState(() => (isFixedFooter ? readFooterMinimized() : false));
  const [multitrackPlaying, setMultitrackPlaying] = useState(false);
  const [multitrackReady, setMultitrackReady] = useState(false);
  const [multitrackCurrentTime, setMultitrackCurrentTime] = useState(0);
  const [multitrackDuration, setMultitrackDuration] = useState(0);
  const [multitrackMasterGain, setMultitrackMasterGain] = useState(1);
  /** Tom escolhido no dropdown (detalhes). null = original. Na cifra, o contexto tem prioridade. */
  const [manualAudioKey, setManualAudioKey] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["song-keys", songId],
    queryFn: () => fetchSongKeys(songId),
  });

  const multitracksQuery = useQuery({
    queryKey: ["multitracks", "song", songId],
    queryFn: () => fetchMultitracks({ songId, limit: 50 }),
    enabled: Boolean(songId),
  });

  const apiSourceKey = keysQuery.data?.source_key ?? null;
  const readyKeyOptions = useMemo(
    () =>
      (keysQuery.data?.variants ?? [])
        .filter((variant) => variant.status === "ready")
        .map((variant) => variant.target_key)
        // Não listar o próprio tom original como “convertido”.
        .filter((key) => !apiSourceKey || key !== apiSourceKey),
    [keysQuery.data?.variants, apiSourceKey],
  );

  const soundingKey = playbackKey?.soundingKey ?? null;
  const sourceKey = playbackKey?.sourceKey ?? apiSourceKey;
  const useOriginalAudio = playbackKey?.useOriginalAudio ?? false;
  const cifraAudioKey =
    playbackKey &&
    !useOriginalAudio &&
    soundingKey &&
    sourceKey &&
    soundingKey !== sourceKey
      ? soundingKey
      : null;
  // Na cifra o tom da cifra manda; nos detalhes, o dropdown.
  const activeAudioKey = playbackKey
    ? useOriginalAudio
      ? null
      : cifraAudioKey
    : manualAudioKey;
  const wantsKeyVariant = Boolean(activeAudioKey);

  const availableStems = useMemo(
    () => (stemsManifest?.stems ?? []).filter((stem) => stem.available !== false),
    [stemsManifest],
  );
  const stemsReady = availableStems.length > 0 && Object.keys(stemUrls).length > 0;
  const canUseStems = Boolean(stemsManifest?.separated && availableStems.length > 0);

  /** Tom desejado para Multitrack: na cifra acompanha o tom soante; senão o dropdown/original. */
  const desiredMultitrackKey = useMemo(() => {
    if (playbackKey) {
      if (useOriginalAudio) return sourceKey;
      return soundingKey ?? sourceKey;
    }
    return manualAudioKey ?? apiSourceKey;
  }, [playbackKey, useOriginalAudio, sourceKey, soundingKey, manualAudioKey, apiSourceKey]);

  const matchedMultitrackSummary = useMemo(() => {
    const items = multitracksQuery.data?.items ?? [];
    return (
      items.find(
        (item) =>
          (item.track_count ?? 0) > 0 && multitrackMatchesKey(item, desiredMultitrackKey),
      ) ?? null
    );
  }, [multitracksQuery.data?.items, desiredMultitrackKey]);

  const canUseMultitrack = Boolean(matchedMultitrackSummary);

  const multitrackDetailQuery = useQuery({
    queryKey: ["multitrack", matchedMultitrackSummary?.id],
    queryFn: () => fetchMultitrack(matchedMultitrackSummary!.id),
    enabled: Boolean(matchedMultitrackSummary?.id) && mode === "multitrack",
  });

  const matchedMultitrack = multitrackDetailQuery.data ?? null;
  const multitrackPlaybackKey = useMemo(() => {
    if (!matchedMultitrack || !desiredMultitrackKey) return null;
    const source = normalizeMusicKeyLabel(matchedMultitrack.source_key).toLowerCase();
    const desired = normalizeMusicKeyLabel(desiredMultitrackKey).toLowerCase();
    return source === desired ? null : desiredMultitrackKey;
  }, [matchedMultitrack, desiredMultitrackKey]);

  const effectiveMode: PlaybackMode =
    mode === "multitrack" && canUseMultitrack
      ? "multitrack"
      : mode === "stems" && canUseStems
        ? "stems"
        : "original";

  useEffect(() => {
    if (mode === "multitrack" && !canUseMultitrack) {
      setMode("original");
    }
  }, [mode, canUseMultitrack]);

  const keyJobId = stemsManifest?.job_id ?? null;
  const keyJobQuery = useQuery({
    queryKey: ["job", keyJobId],
    queryFn: () => fetchJob(keyJobId!),
    enabled:
      Boolean(keyJobId) &&
      (keyAudioStatus === "queued" || keyAudioStatus === "processing"),
    refetchInterval: (query) =>
      query.state.data && isJobFinished(query.state.data.status) ? false : 2500,
  });

  useEffect(() => {
    const job = keyJobQuery.data;
    if (!job || !isJobFinished(job.status)) return;
    void queryClient.invalidateQueries({ queryKey: ["song-keys", songId] });
    // Remonta stems/audio do tom.
    setStemsManifest((current) =>
      current ? { ...current, status: job.status === "completed" ? "ready" : "failed" } : current,
    );
  }, [keyJobQuery.data, queryClient, songId]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setAudioUrl(null);

    if (wantsKeyVariant && keyAudioStatus !== "ready") {
      return () => {
        cancelled = true;
      };
    }

    const path = activeAudioKey
      ? songKeyAudioPath(songId, activeAudioKey)
      : `/songs/${songId}/audio`;

    void resolveAuthenticatedMediaUrl(path)
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
  }, [songId, activeAudioKey, wantsKeyVariant, keyAudioStatus]);

  useEffect(() => {
    let cancelled = false;
    setStemsManifest(null);
    setStemUrls({});
    setStemsLoading(false);
    setStemsError(null);

    if (!activeAudioKey) {
      setKeyAudioStatus("original");
      void authFetch(`/songs/${songId}/stems`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Stems indisponíveis");
          const data = (await response.json()) as KeyStemsManifest;
          if (!cancelled) setStemsManifest(data);
        })
        .catch(() => {
          if (!cancelled) setStemsManifest({ song_id: songId, separated: false, stems: [] });
        });
      return () => {
        cancelled = true;
      };
    }

    setKeyAudioStatus("processing");
    void authFetch(songKeyStemsPath(songId, activeAudioKey))
      .then(async (response) => {
        if (!response.ok) throw new Error("Stems do tom indisponíveis");
        const data = (await response.json()) as KeyStemsManifest;
        if (cancelled) return;
        setStemsManifest(data);
        const status = (data.status ?? (data.separated ? "ready" : "missing")) as KeyAudioStatus;
        if (status === "ready" && data.separated) {
          setKeyAudioStatus("ready");
        } else if (status === "queued" || status === "processing") {
          setKeyAudioStatus(status);
        } else if (status === "failed") {
          setKeyAudioStatus("failed");
        } else {
          setKeyAudioStatus("missing");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStemsManifest({
            song_id: songId,
            separated: false,
            stems: [],
            status: "missing",
            message: "Não há faixas de música disponíveis neste tom",
          });
          setKeyAudioStatus("missing");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [songId, activeAudioKey, keyJobQuery.data?.status]);

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
        const path = activeAudioKey
          ? songKeyStemAudioPath(songId, activeAudioKey, name)
          : `/songs/${songId}/stems/${encodeURIComponent(name)}/audio`;
        const resolved = await resolveAuthenticatedMediaUrl(path);
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
  }, [songId, canUseStems, availableStemKey, activeAudioKey]);

  const generateKeyMutation = useMutation({
    mutationFn: async () => {
      if (!soundingKey) throw new Error("Tom inválido");
      return requestSongKeyVariant(songId, soundingKey);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["song-keys", songId] });
      toast.success(`Conversão para ${result.target_key} iniciada.`);
      setKeyAudioStatus(
        result.status === "ready" ? "ready" : result.status === "failed" ? "failed" : "queued",
      );
      setStemsManifest((current) => ({
        song_id: songId,
        separated: result.status === "ready",
        stems: current?.stems ?? [],
        status: result.status,
        job_id: result.job_id,
        target_key: result.target_key,
        message:
          result.status === "ready"
            ? undefined
            : "Conversão de tom em andamento",
      }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

  useEffect(() => {
    if (!isFixedFooter || minimized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFixedFooter, minimized]);

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
    if (effectiveMode === "multitrack") return;
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

  const lastSyncedAudioPlayingRef = useRef<boolean | null>(null);
  const syncScrollWithAudioPlayback = cifraScroll?.syncScrollWithAudioPlayback;
  const syncScrollEnabled = Boolean(cifraScroll?.syncWithAudio);

  useEffect(() => {
    if (!syncScrollWithAudioPlayback || !syncScrollEnabled) {
      lastSyncedAudioPlayingRef.current = null;
      return;
    }
    const audioPlaying = effectiveMode === "multitrack" ? multitrackPlaying : playing;
    // Só reage a mudanças do áudio — não força a rolagem de volta se o usuário pausou só a Rolagem.
    if (lastSyncedAudioPlayingRef.current === audioPlaying) return;
    lastSyncedAudioPlayingRef.current = audioPlaying;
    syncScrollWithAudioPlayback(audioPlaying);
  }, [syncScrollWithAudioPlayback, syncScrollEnabled, effectiveMode, playing, multitrackPlaying]);

  const handleModeChange = (next: PlaybackMode) => {
    if (next === mode) return;
    pauseEverything();
    if (syncMetronome) metronomeRef.current?.stop();
    multitrackMixerRef.current?.pause();
    setMultitrackPlaying(false);
    setMultitrackReady(false);
    setMode(next);
    if (next === "multitrack" && isFixedFooter) {
      setMinimized(false);
      onMinimizedChange?.(false);
      try {
        localStorage.setItem(FOOTER_MINIMIZED_KEY, "false");
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem(PLAYBACK_MODE_KEY, next);
    } catch {
      // ignore
    }
  };

  const showMultitrackPanel = effectiveMode === "multitrack";

  const handleManualKeyChange = (nextKey: string) => {
    const normalized = nextKey.trim() || null;
    if (normalized === manualAudioKey) return;
    pauseEverything();
    if (syncMetronome) metronomeRef.current?.stop();
    setManualAudioKey(normalized);
  };

  useEffect(() => {
    if (!manualAudioKey) return;
    if (!readyKeyOptions.includes(manualAudioKey)) {
      setManualAudioKey(null);
    }
  }, [manualAudioKey, readyKeyOptions]);

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
  const showStemsPanel = mode === "stems" && canUseStems && !showMultitrackPanel;
  // Dropdown de tons: nos detalhes (sem contexto da cifra) quando há variantes prontas.
  const showKeyDropdown = !playbackKey && readyKeyOptions.length > 0;
  const showModeToggle = canUseStems || canUseMultitrack;

  const modeToggle = showModeToggle ? (
    <div className={`${segmentedWrapClass} !p-1`} role="group" aria-label="Fonte de áudio">
      <button
        type="button"
        className={effectiveMode === "original" ? segmentedActiveClass : segmentedIdleClass}
        onClick={() => handleModeChange("original")}
      >
        Música original
      </button>
      {canUseStems ? (
        <button
          type="button"
          className={effectiveMode === "stems" ? segmentedActiveClass : segmentedIdleClass}
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
      ) : null}
      {canUseMultitrack ? (
        <button
          type="button"
          className={
            effectiveMode === "multitrack"
              ? "rounded-lg bg-amber-500/25 px-3 py-1.5 text-sm font-medium text-amber-100"
              : segmentedIdleClass
          }
          onClick={() => handleModeChange("multitrack")}
          aria-busy={multitrackDetailQuery.isLoading || undefined}
        >
          {multitrackDetailQuery.isLoading && mode === "multitrack" ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-r-transparent"
                aria-hidden
              />
              Carregando…
            </span>
          ) : (
            "Multitrack"
          )}
        </button>
      ) : null}
    </div>
  ) : null;

  const keyDropdown = showKeyDropdown ? (
    <label className="flex min-w-[8.5rem] flex-col gap-1">
      <span className="sr-only">Tom do áudio</span>
      <select
        id="song-audio-key"
        name="song-audio-key"
        aria-label="Tom do áudio"
        className={`${cifraSelectClass} !w-auto min-w-[8.5rem] py-1.5 text-sm`}
        value={manualAudioKey ?? ""}
        onChange={(event) => handleManualKeyChange(event.target.value)}
      >
        <option value="">
          {apiSourceKey ? `Original (${apiSourceKey})` : "Original"}
        </option>
        {readyKeyOptions.map((key) => (
          <option key={key} value={key}>
            Tom {key}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  const sourceControls =
    modeToggle || keyDropdown ? (
      <div className="flex flex-wrap items-center gap-2">
        {modeToggle}
        {keyDropdown}
      </div>
    ) : null;

  const multitrackPanel = showMultitrackPanel ? (
    <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-amber-200/80">Multitrack</p>
        {desiredMultitrackKey ? (
          <p className="text-xs text-slate-500">
            Tom <span className="text-amber-100">{desiredMultitrackKey}</span>
            {matchedMultitrack?.title ? ` · ${matchedMultitrack.title}` : ""}
          </p>
        ) : null}
      </div>
      {multitrackDetailQuery.isLoading ? (
        <p className="text-sm text-slate-400">Carregando faixas do Multitrack...</p>
      ) : multitrackDetailQuery.isError || !matchedMultitrack ? (
        <p className="text-sm text-red-300">Não foi possível carregar o Multitrack neste tom.</p>
      ) : (
        <MultitrackMixer
          ref={multitrackMixerRef}
          multitrackId={matchedMultitrack.id}
          tracks={matchedMultitrack.tracks ?? []}
          playbackKey={multitrackPlaybackKey}
          bpm={matchedMultitrack.bpm ?? bpm}
          timeSignature={matchedMultitrack.time_signature ?? "4/4"}
          onPlayingChange={setMultitrackPlaying}
          onReadyChange={setMultitrackReady}
          onProgressChange={(time, total) => {
            setMultitrackCurrentTime(time);
            setMultitrackDuration(total);
          }}
          onMasterGainChange={setMultitrackMasterGain}
          onBpmChange={(nextBpm) => {
            void updateMultitrack(matchedMultitrack.id, { bpm: nextBpm }).then(() => {
              void queryClient.invalidateQueries({
                queryKey: ["multitrack", matchedMultitrack.id],
              });
              void queryClient.invalidateQueries({ queryKey: ["multitracks", "song", songId] });
            });
          }}
          onTimeSignatureChange={(nextSignature) => {
            void updateMultitrack(matchedMultitrack.id, { time_signature: nextSignature }).then(
              () => {
                void queryClient.invalidateQueries({
                  queryKey: ["multitrack", matchedMultitrack.id],
                });
                void queryClient.invalidateQueries({ queryKey: ["multitracks", "song", songId] });
              },
            );
          }}
          onTrackMuteChange={(trackId, muted) => {
            void updateMultitrackTrack(matchedMultitrack.id, trackId, { muted });
          }}
          onTrackGainChange={(trackId, gain) => {
            void updateMultitrackTrack(matchedMultitrack.id, trackId, { gain });
          }}
        />
      )}
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

  const keyVariantBanner =
    playbackKey && wantsKeyVariant ? (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-slate-300">
        {keyAudioStatus === "ready" ? (
          <p>
            Tocando no tom <span className="text-green-300">{soundingKey}</span>
            {sourceKey ? (
              <span className="text-slate-500"> (original {sourceKey})</span>
            ) : null}
          </p>
        ) : keyAudioStatus === "queued" || keyAudioStatus === "processing" ? (
          <p className="inline-flex items-center gap-2">
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-green-400 border-r-transparent"
              aria-hidden
            />
            Gerando faixas em {soundingKey}
            {keyJobQuery.data ? ` · ${keyJobQuery.data.progress}%` : "…"}
          </p>
        ) : (
          <div className="space-y-2">
            <p>
              Não há faixas de música disponíveis neste tom
              {soundingKey ? (
                <>
                  {" "}
                  (<span className="text-green-300">{soundingKey}</span>)
                </>
              ) : null}
              .
            </p>
            {stemsManifest?.error ? (
              <p className="text-xs text-red-300">{stemsManifest.error}</p>
            ) : null}
            <button
              type="button"
              className={`${btnPrimary} px-3 py-1.5 text-xs`}
              disabled={generateKeyMutation.isPending}
              onClick={() => generateKeyMutation.mutate()}
            >
              {generateKeyMutation.isPending ? "Iniciando…" : "Gerar neste tom"}
            </button>
          </div>
        )}
      </div>
    ) : null;

  const useOriginalCheckbox = playbackKey ? (
    <label
      htmlFor="use-original-audio"
      className="flex cursor-pointer items-start gap-2 text-sm text-slate-300"
    >
      <input
        id="use-original-audio"
        name="use-original-audio"
        type="checkbox"
        checked={useOriginalAudio}
        onChange={(event) => playbackKey.setUseOriginalAudio(event.target.checked)}
        className="accent-brand mt-0.5 rounded border-white/20 bg-black/30"
      />
      <span>
        Usar original importada
        <span className="mt-0.5 block text-xs text-slate-500">
          Mantém o áudio no tom original mesmo se a cifra estiver transposta.
        </span>
      </span>
    </label>
  ) : null;

  // Áudio sempre no mesmo lugar do DOM — minimizar/expandir não pode remountar <audio>,
  // senão a reprodução para.
  const persistentAudio = (
    <>
      {originalAudio}
      {hiddenStemAudios}
    </>
  );

  const expandedBody = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <h2 className="font-medium text-slate-100">Áudio</h2>
          {sourceControls}
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

      {useOriginalCheckbox ? <div className="mt-2">{useOriginalCheckbox}</div> : null}
      {keyVariantBanner ? <div className="mt-2">{keyVariantBanner}</div> : null}
      {showKeyDropdown && manualAudioKey ? (
        <p className="mt-2 text-xs text-slate-500">
          Tocando no tom <span className="text-green-300">{manualAudioKey}</span>
          {apiSourceKey ? (
            <span className="text-slate-500"> (original {apiSourceKey})</span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
        {scrollControl}
        <div className="min-w-0 flex-1 space-y-3">
          {showMultitrackPanel ? null : transport}
          {multitrackPanel}
          {stemsPicker}
        </div>
      </div>
      {showMultitrackPanel ? null : volumeControl}
      {showMultitrackPanel ? null : metronomeExtras}
    </>
  );

  if (isFixedFooter) {
    const footerIsMultitrack = showMultitrackPanel;
    const footerCurrentTime = footerIsMultitrack ? multitrackCurrentTime : currentTime;
    const footerDuration = footerIsMultitrack ? multitrackDuration : duration;
    const footerProgressPercent =
      footerDuration > 0 ? Math.min(100, (footerCurrentTime / footerDuration) * 100) : 0;
    const footerVolume = footerIsMultitrack ? multitrackMasterGain : audioVolume;
    const footerPlaying = footerIsMultitrack ? multitrackPlaying : playing;
    const footerCanPlay = footerIsMultitrack
      ? Boolean(matchedMultitrack) && !multitrackDetailQuery.isLoading
      : effectiveMode === "original"
        ? Boolean(audioUrl)
        : stemsReady && enabledStems.size > 0 && !stemsLoading;

    const handleFooterPlayPause = () => {
      if (footerIsMultitrack) {
        void multitrackMixerRef.current?.toggle();
        return;
      }
      void togglePlay();
    };

    const handleFooterStop = () => {
      if (footerIsMultitrack) {
        multitrackMixerRef.current?.stop();
        return;
      }
      pauseEverything();
      seekAll(0);
      if (syncMetronome) metronomeRef.current?.stop();
    };

    const handleFooterSeek = (next: number) => {
      if (footerIsMultitrack) {
        multitrackMixerRef.current?.seek(next);
        return;
      }
      seekAll(next);
    };

    const handleFooterVolume = (next: number) => {
      if (footerIsMultitrack) {
        multitrackMixerRef.current?.setMasterGain(next);
        setMultitrackMasterGain(next);
        return;
      }
      handleAudioVolumeChange(next);
    };

    const minimizedBar = (
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 min-w-[5.5rem] tabular-nums text-[11px] text-slate-400">
            {formatPlaybackTime(footerCurrentTime)} / {formatPlaybackTime(footerDuration)}
          </span>
          <input
            id="footer-playback-progress"
            name="footer-playback-progress"
            type="range"
            min={0}
            max={Math.max(footerDuration, 0.1)}
            step={0.1}
            value={Math.min(footerCurrentTime, footerDuration || 0)}
            disabled={footerDuration <= 0}
            onChange={(event) => handleFooterSeek(Number(event.target.value))}
            className="accent-chord h-3 min-w-0 flex-1 cursor-pointer disabled:opacity-40"
            aria-label="Progresso da música"
            style={{
              background: `linear-gradient(to right, #4ade80 ${footerProgressPercent}%, rgba(255,255,255,0.12) ${footerProgressPercent}%)`,
            }}
          />
          <label
            htmlFor="footer-master-volume"
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400"
          >
            <span>Vol</span>
            <input
              id="footer-master-volume"
              name="footer-master-volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={footerVolume}
              onChange={(event) => handleFooterVolume(Number(event.target.value))}
              className="accent-chord h-3 w-16 cursor-pointer sm:w-24"
              aria-label="Volume geral"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          {scrollControl}
          <button
            type="button"
            onClick={handleFooterPlayPause}
            disabled={!footerCanPlay}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-green-500/40 bg-green-500/15 text-base text-green-300 transition hover:bg-green-500/25 disabled:opacity-40"
            aria-label={footerPlaying ? "Pausar" : "Reproduzir"}
            title={footerPlaying ? "Pausar" : "Play"}
          >
            <span aria-hidden>{footerPlaying ? "⏸" : "▶"}</span>
          </button>
          <button
            type="button"
            onClick={handleFooterStop}
            disabled={!footerCanPlay && footerCurrentTime <= 0}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 text-sm text-red-300 transition hover:bg-red-500/25 disabled:opacity-40"
            aria-label="Parar"
            title="Stop"
          >
            <span aria-hidden>■</span>
          </button>
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              footerIsMultitrack ? "text-amber-100/90" : "text-slate-400"
            }`}
          >
            {footerIsMultitrack
              ? `Multitrack${desiredMultitrackKey ? ` · ${desiredMultitrackKey}` : ""}`
              : effectiveMode === "stems"
                ? "Stems"
                : "Original"}
          </span>
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
    );

    return (
      <div
        className={
          minimized
            ? `fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[#020806]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl ${className ?? ""}`
            : `fixed inset-0 z-50 flex flex-col bg-[#020806] ${className ?? ""}`
        }
        data-song-audio-footer
        role={minimized ? undefined : "dialog"}
        aria-modal={minimized ? undefined : true}
        aria-label={minimized ? undefined : "Painel de áudio"}
      >
        {persistentAudio}

        {minimized ? (
          minimizedBar
        ) : (
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] bg-[#020806]/98 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
            <div className="min-w-0">
              <h2 className="font-medium text-slate-100">Áudio</h2>
              <p className="truncate text-xs text-slate-500">
                {showMultitrackPanel
                  ? desiredMultitrackKey
                    ? `Multitrack · tom ${desiredMultitrackKey}`
                    : "Multitrack"
                  : "Áudio protegido"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFooterMinimized(true)}
              className={`${btnGhost} shrink-0 px-3 py-1.5 text-xs`}
              aria-label="Minimizar painel de áudio"
            >
              Minimizar
            </button>
          </header>
        )}

        {/* Conteúdo (e MultitrackMixer) permanece montado ao minimizar — não usar display:none (quebra mídia). */}
        <div
          className={
            minimized
              ? "pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
              : `min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 ${
                  showMultitrackPanel || !hasMetronome
                    ? "pb-[max(1rem,env(safe-area-inset-bottom))]"
                    : ""
                }`
          }
          aria-hidden={minimized || undefined}
        >
          <div className="mx-auto max-w-6xl space-y-3">
            {sourceControls}
            {useOriginalCheckbox}
            {keyVariantBanner}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {scrollControl}
              <div className="min-w-0 flex-1 space-y-3">
                {showMultitrackPanel ? null : transport}
                {multitrackPanel}
                {stemsPicker}
              </div>
            </div>
            {showMultitrackPanel ? null : volumeControl}
          </div>
        </div>

        {hasMetronome && !showMultitrackPanel ? (
          <div
            className={
              minimized
                ? "hidden"
                : "shrink-0 border-t border-white/[0.06] px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            }
            aria-hidden={minimized || undefined}
          >
            <div className="mx-auto max-w-6xl">{metronomeExtras}</div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <article className={`${panelClass} ${className ?? ""}`}>
      {persistentAudio}
      {expandedBody}
    </article>
  );
}
