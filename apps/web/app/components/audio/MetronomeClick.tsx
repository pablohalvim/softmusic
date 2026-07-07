import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { loadMetronomeVolume, saveMetronomeVolume } from "./volume-prefs";
import { VolumeControl } from "./VolumeControl";

export interface MetronomeClickHandle {
  start: () => Promise<void>;
  stop: () => void;
  isPlaying: () => boolean;
}

interface MetronomeClickProps {
  bpm: number;
  beatsPerMeasure?: number;
  className?: string;
}

function scheduleClick(
  context: AudioContext,
  time: number,
  accent: boolean,
  volume: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = accent ? 1200 : 880;
  const peak = (accent ? 0.5 : 0.32) * volume;
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.06);
}

export const MetronomeClick = forwardRef<MetronomeClickHandle, MetronomeClickProps>(
  function MetronomeClick({ bpm, beatsPerMeasure = 4, className }, ref) {
    const [playing, setPlaying] = useState(false);
    const [beat, setBeat] = useState(0);
    const [volume, setVolume] = useState(loadMetronomeVolume);

    const contextRef = useRef<AudioContext | null>(null);
    const timerRef = useRef<number | null>(null);
    const beatRef = useRef(0);
    const playingRef = useRef(false);
    const volumeRef = useRef(volume);

    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;

    useEffect(() => {
      volumeRef.current = volume;
    }, [volume]);

    const stop = useCallback(() => {
      playingRef.current = false;
      setPlaying(false);
      setBeat(0);
      beatRef.current = 0;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const playClick = useCallback((accent: boolean) => {
      const context = contextRef.current;
      if (!context) return;
      if (context.state === "suspended") {
        void context.resume();
      }
      scheduleClick(context, context.currentTime + 0.01, accent, volumeRef.current);
    }, []);

    const start = useCallback(async () => {
      if (playingRef.current) return;

      if (!contextRef.current) {
        contextRef.current = new AudioContext();
      }
      const context = contextRef.current;
      if (context.state === "suspended") {
        await context.resume();
      }

      beatRef.current = 0;
      setBeat(1);
      playClick(true);
      playingRef.current = true;
      setPlaying(true);

      const intervalMs = 60_000 / safeBpm;
      timerRef.current = window.setInterval(() => {
        if (!playingRef.current) return;
        beatRef.current = (beatRef.current % beatsPerMeasure) + 1;
        const currentBeat = beatRef.current;
        setBeat(currentBeat);
        playClick(currentBeat === 1);
      }, intervalMs);
    }, [beatsPerMeasure, playClick, safeBpm]);

    useImperativeHandle(
      ref,
      () => ({
        start,
        stop,
        isPlaying: () => playingRef.current,
      }),
      [start, stop],
    );

    const toggle = () => {
      if (playing) {
        stop();
        return;
      }
      void start();
    };

    const handleVolumeChange = (next: number) => {
      setVolume(next);
      saveMetronomeVolume(next);
    };

    useEffect(() => {
      stop();
    }, [safeBpm, beatsPerMeasure, stop]);

    useEffect(() => () => stop(), [stop]);

    return (
      <div className={className ?? "mt-4 border-t border-slate-800 pt-4"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-slate-200">Metrônomo</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {Math.round(safeBpm)} BPM · {beatsPerMeasure}/4
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              playing
                ? "bg-orange-500 text-white hover:bg-orange-400"
                : "border border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-600"
            }`}
          >
            {playing ? "Parar click" : "Play click"}
          </button>
        </div>

        <VolumeControl
          label="Volume do metrônomo"
          value={volume}
          onChange={handleVolumeChange}
          className="mt-3"
        />

        <div className="mt-3 flex items-center gap-2">
          {Array.from({ length: beatsPerMeasure }, (_, index) => {
            const measureBeat = index + 1;
            const active = playing && beat === measureBeat;
            return (
              <span
                key={measureBeat}
                className={`h-2.5 flex-1 rounded-full transition-colors ${
                  active
                    ? measureBeat === 1
                      ? "bg-orange-400"
                      : "bg-green-400"
                    : "bg-slate-800"
                }`}
              />
            );
          })}
        </div>
      </div>
    );
  },
);
