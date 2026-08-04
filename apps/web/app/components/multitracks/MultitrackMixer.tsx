import { useEffect, useRef, useState } from "react";

import {
  multitrackTrackAudioPath,
  resolveAuthenticatedMediaUrl,
  type MultitrackTrack,
} from "../../lib/api";
import { btnGhost, btnPrimary } from "../../lib/ui-classes";

interface MultitrackMixerProps {
  multitrackId: string;
  tracks: MultitrackTrack[];
  playbackKey?: string | null;
  onTrackMuteChange?: (trackId: string, muted: boolean) => void;
  onTrackGainChange?: (trackId: string, gain: number) => void;
}

export function MultitrackMixer({
  multitrackId,
  tracks,
  playbackKey,
  onTrackMuteChange,
  onTrackGainChange,
}: MultitrackMixerProps) {
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [masterGain, setMasterGain] = useState(1);
  const [localMute, setLocalMute] = useState<Record<string, boolean>>({});
  const [localGain, setLocalGain] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function load() {
      setLoading(true);
      setError(null);
      setPlaying(false);
      setCurrentTime(0);
      const next: Record<string, string> = {};
      try {
        for (const track of tracks) {
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

    if (tracks.length > 0) {
      void load();
    } else {
      setUrls({});
    }

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [multitrackId, tracks, playbackKey]);

  useEffect(() => {
    const muteMap: Record<string, boolean> = {};
    const gainMap: Record<string, number> = {};
    for (const track of tracks) {
      muteMap[track.id] = track.muted;
      gainMap[track.id] = track.gain;
    }
    setLocalMute(muteMap);
    setLocalGain(gainMap);
  }, [tracks]);

  useEffect(() => {
    for (const track of tracks) {
      const audio = audioRefs.current[track.id];
      if (!audio) continue;
      const muted = localMute[track.id] ?? track.muted;
      const gain = localGain[track.id] ?? track.gain;
      audio.muted = muted;
      audio.volume = Math.max(0, Math.min(1, gain * masterGain));
    }
  }, [tracks, localMute, localGain, masterGain, urls]);

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
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Não foi possível reproduzir");
    }
  };

  const handlePause = () => {
    for (const track of tracks) {
      audioRefs.current[track.id]?.pause();
    }
    setPlaying(false);
  };

  const maxDuration =
    duration ||
    Math.max(0, ...tracks.map((track) => track.duration_seconds ?? 0));

  return (
    <div className="space-y-4">
      {tracks.map((track) => (
        <audio
          key={`${track.id}-${playbackKey ?? "source"}`}
          ref={(node) => {
            audioRefs.current[track.id] = node;
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
            if (track.id === tracks[0]?.id) setPlaying(false);
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
            onChange={(event) => setMasterGain(Number(event.target.value))}
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
                      onTrackGainChange?.(track.id, next);
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
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
