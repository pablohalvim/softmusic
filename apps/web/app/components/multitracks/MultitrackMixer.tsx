import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { MetronomeClick, type MetronomeClickHandle } from "../audio/MetronomeClick";
import {
  multitrackTrackAudioPath,
  resolveAuthenticatedMediaUrl,
  type MultitrackTimeSignature,
  type MultitrackTrack,
} from "../../lib/api";
import { btnGhost, btnPrimary } from "../../lib/ui-classes";

export type MultitrackMixerHandle = {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  toggle: () => Promise<void>;
  seek: (time: number) => void;
  setMasterGain: (gain: number) => void;
};

interface MultitrackMixerProps {
  multitrackId: string;
  tracks: MultitrackTrack[];
  playbackKey?: string | null;
  bpm?: number | null;
  timeSignature?: string | null;
  onBpmChange?: (bpm: number) => void;
  onTimeSignatureChange?: (timeSignature: MultitrackTimeSignature) => void;
  onTrackMuteChange?: (trackId: string, muted: boolean) => void;
  onTrackGainChange?: (trackId: string, gain: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onReadyChange?: (ready: boolean) => void;
  onProgressChange?: (currentTime: number, duration: number) => void;
  onMasterGainChange?: (gain: number) => void;
}

export const MultitrackMixer = forwardRef<MultitrackMixerHandle, MultitrackMixerProps>(
  function MultitrackMixer(
    {
      multitrackId,
      tracks,
      playbackKey,
      bpm,
      timeSignature,
      onBpmChange,
      onTimeSignatureChange,
      onTrackMuteChange,
      onTrackGainChange,
      onPlayingChange,
      onReadyChange,
      onProgressChange,
      onMasterGainChange,
    },
    ref,
  ) {
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const metronomeRef = useRef<MetronomeClickHandle>(null);
  const gainPersistTimers = useRef<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [masterGain, setMasterGain] = useState(1);
  const [localMute, setLocalMute] = useState<Record<string, boolean>>({});
  const [localGain, setLocalGain] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveBpm = Number.isFinite(bpm) && (bpm ?? 0) > 0 ? Number(bpm) : 120;
  const tracksKey = useMemo(
    () => tracks.map((track) => track.id).join("|"),
    [tracks],
  );
  const mediaKey = `${multitrackId}:${playbackKey ?? "source"}:${tracksKey}`;

  const applyTrackMix = (
    trackId: string,
    muted: boolean,
    gain: number,
    master: number,
  ) => {
    const audio = audioRefs.current[trackId];
    if (!audio) return;
    audio.muted = muted;
    audio.volume = Math.max(0, Math.min(1, gain * master));
  };

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    const trackList = tracks;

    async function load() {
      setLoading(true);
      setError(null);
      setPlaying(false);
      setCurrentTime(0);
      metronomeRef.current?.stop();
      const next: Record<string, string> = {};
      try {
        for (const track of trackList) {
          const path = multitrackTrackAudioPath(multitrackId, track.id, playbackKey);
          const resolved = await resolveAuthenticatedMediaUrl(path);
          if (resolved.revoke) objectUrls.push(resolved.url);
          next[track.id] = resolved.url;
        }
        if (!cancelled) setUrls(next);
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "Falha ao carregar áudios");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (trackList.length > 0) {
      void load();
    } else {
      setUrls({});
      setPlaying(false);
      setCurrentTime(0);
      metronomeRef.current?.stop();
    }

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
    // Só recarrega quando muda o conjunto de faixas / tom — não a cada PATCH de gain/mute.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mediaKey captura ids+tom
  }, [mediaKey]);

  useEffect(() => {
    setLocalMute((prev) => {
      const next: Record<string, boolean> = {};
      for (const track of tracks) {
        next[track.id] = prev[track.id] ?? track.muted;
      }
      return next;
    });
    setLocalGain((prev) => {
      const next: Record<string, number> = {};
      for (const track of tracks) {
        next[track.id] = prev[track.id] ?? track.gain;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando entram/saem faixas
  }, [tracksKey]);

  useEffect(() => {
    for (const track of tracks) {
      applyTrackMix(track.id, localMute[track.id] ?? track.muted, localGain[track.id] ?? track.gain, masterGain);
    }
  }, [tracks, localMute, localGain, masterGain, urls]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(gainPersistTimers.current)) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const syncSeek = (time: number) => {
    for (const track of tracks) {
      const audio = audioRefs.current[track.id];
      if (audio && Number.isFinite(time)) {
        audio.currentTime = time;
      }
    }
    setCurrentTime(time);
  };

  const handlePlay = async () => {
    const list = tracks
      .map((track) => audioRefs.current[track.id])
      .filter((audio): audio is HTMLAudioElement => Boolean(audio));
    if (list.length === 0) return;
    try {
      await Promise.all(list.map((audio) => audio.play()));
      setPlaying(true);
      void metronomeRef.current?.start();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Não foi possível reproduzir");
    }
  };

  const handlePause = () => {
    for (const track of tracks) {
      audioRefs.current[track.id]?.pause();
    }
    setPlaying(false);
    metronomeRef.current?.stop();
  };

  const handleStop = () => {
    handlePause();
    syncSeek(0);
  };

  const handleSetMasterGain = (gain: number) => {
    const next = Math.max(0, Math.min(1, gain));
    setMasterGain(next);
    onMasterGainChange?.(next);
  };

  useImperativeHandle(
    ref,
    () => ({
      play: handlePlay,
      pause: handlePause,
      stop: handleStop,
      toggle: async () => {
        if (playing) handlePause();
        else await handlePlay();
      },
      seek: syncSeek,
      setMasterGain: handleSetMasterGain,
    }),
    // handlers fecham sobre tracks/refs atuais
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playing, tracks, urls],
  );

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  useEffect(() => {
    const ready =
      !loading &&
      !error &&
      tracks.length > 0 &&
      tracks.every((track) => Boolean(urls[track.id]));
    onReadyChange?.(ready);
  }, [loading, error, tracks, urls, onReadyChange]);

  const maxDuration =
    duration ||
    Math.max(0, ...tracks.map((track) => track.duration_seconds ?? 0));

  useEffect(() => {
    onProgressChange?.(currentTime, maxDuration);
  }, [currentTime, maxDuration, onProgressChange]);

  useEffect(() => {
    onMasterGainChange?.(masterGain);
  }, [masterGain, onMasterGainChange]);

  const scheduleGainPersist = (trackId: string, gain: number) => {
    if (!onTrackGainChange) return;
    const existing = gainPersistTimers.current[trackId];
    if (existing) window.clearTimeout(existing);
    gainPersistTimers.current[trackId] = window.setTimeout(() => {
      onTrackGainChange(trackId, gain);
      delete gainPersistTimers.current[trackId];
    }, 250);
  };

  return (
    <div className="space-y-4">
      <MetronomeClick
        ref={metronomeRef}
        bpm={effectiveBpm}
        timeSignature={timeSignature ?? "4/4"}
        onBpmChange={onBpmChange}
        onTimeSignatureChange={onTimeSignatureChange}
        visualOnly
        className="rounded-xl border border-white/10 bg-black/20 p-4"
      />

      {tracks.map((track) => (
        <audio
          key={`${track.id}-${playbackKey ?? "source"}`}
          ref={(node) => {
            audioRefs.current[track.id] = node;
            if (node) {
              applyTrackMix(
                track.id,
                localMute[track.id] ?? track.muted,
                localGain[track.id] ?? track.gain,
                masterGain,
              );
            }
          }}
          src={urls[track.id]}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            if (media.duration && Number.isFinite(media.duration)) {
              setDuration((prev) => Math.max(prev, media.duration));
            }
          }}
          onTimeUpdate={(event) => {
            if (track.id === tracks[0]?.id) {
              setCurrentTime(event.currentTarget.currentTime);
            }
          }}
          onEnded={() => {
            if (track.id === tracks[0]?.id) {
              setPlaying(false);
              metronomeRef.current?.stop();
            }
          }}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={loading || tracks.length === 0 || playing}
          onClick={() => void handlePlay()}
        >
          Play
        </button>
        <button
          type="button"
          className={btnGhost}
          disabled={!playing}
          onClick={handlePause}
        >
          Pause
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Master
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterGain}
            onChange={(event) => handleSetMasterGain(Number(event.target.value))}
          />
        </label>
        <span className="text-xs text-slate-500">
          {formatTime(currentTime)} / {formatTime(maxDuration)}
        </span>
      </div>

      <input
        type="range"
        className="w-full"
        min={0}
        max={maxDuration || 1}
        step={0.01}
        value={Math.min(currentTime, maxDuration || 1)}
        disabled={tracks.length === 0}
        onChange={(event) => syncSeek(Number(event.target.value))}
      />

      {loading ? <p className="text-sm text-slate-400">Carregando faixas...</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <ul className="space-y-2">
        {tracks.map((track) => {
          const muted = localMute[track.id] ?? track.muted;
          const gain = localGain[track.id] ?? track.gain;
          return (
            <li
              key={track.id}
              className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">{track.name}</p>
                <p className="text-xs text-slate-500">
                  {track.role}
                  {!track.pitch_shift ? " · sem pitch" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setLocalMute((prev) => ({ ...prev, [track.id]: next }));
                      applyTrackMix(track.id, next, localGain[track.id] ?? track.gain, masterGain);
                      onTrackMuteChange?.(track.id, next);
                    }}
                  />
                  Mute
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  Vol
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.01}
                    value={gain}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setLocalGain((prev) => ({ ...prev, [track.id]: next }));
                      applyTrackMix(track.id, localMute[track.id] ?? track.muted, next, masterGain);
                      scheduleGainPersist(track.id, next);
                    }}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
  },
);

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
