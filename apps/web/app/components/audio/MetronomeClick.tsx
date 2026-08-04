import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import {
  MULTITRACK_TIME_SIGNATURES,
  parseTimeSignature,
  type MultitrackTimeSignature,
} from "../../lib/api";
import { btnPrimary, cifraSelectClass } from "../../lib/ui-classes";
import { loadMetronomeVolume, saveMetronomeVolume } from "./volume-prefs";
import { VolumeControl } from "./VolumeControl";

export interface MetronomeClickHandle {
  start: () => Promise<void>;
  stop: () => void;
  isPlaying: () => boolean;
}

interface MetronomeClickProps {
  bpm: number;
  /** @deprecated Prefira timeSignature. Mantido para SongAudioPlayer. */
  beatsPerMeasure?: number;
  /** Ex.: "4/4", "6/8". Controla quantas barras acendem. */
  timeSignature?: string | null;
  className?: string;
  /** Se informado, permite editar o BPM no próprio card. */
  onBpmChange?: (bpm: number) => void;
  /** Se informado, permite escolher o compasso. */
  onTimeSignatureChange?: (timeSignature: MultitrackTimeSignature) => void;
  bpmMin?: number;
  bpmMax?: number;
  /**
   * Só anima as barras (sem áudio sintético).
   * Útil no Multitrack, onde o click já vem importado nas faixas.
   */
  visualOnly?: boolean;
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

function accentBeatsFor(beats: number, unit: number): Set<number> {
  // Em compassos compostos (x/8 divisível por 3), acento a cada 3 tempos.
  if (unit === 8 && beats % 3 === 0) {
    const accents = new Set<number>();
    for (let beat = 1; beat <= beats; beat += 3) accents.add(beat);
    return accents;
  }
  return new Set([1]);
}

export const MetronomeClick = forwardRef<MetronomeClickHandle, MetronomeClickProps>(
  function MetronomeClick(
    {
      bpm,
      beatsPerMeasure,
      timeSignature,
      className,
      onBpmChange,
      onTimeSignatureChange,
      bpmMin = 20,
      bpmMax = 400,
      visualOnly = false,
    },
    ref,
  ) {
    const parsed = useMemo(() => {
      if (timeSignature) return parseTimeSignature(timeSignature);
      if (beatsPerMeasure && beatsPerMeasure > 0) {
        return {
          beats: beatsPerMeasure,
          unit: 4,
          label: `${beatsPerMeasure}/4` as MultitrackTimeSignature,
        };
      }
      return parseTimeSignature("4/4");
    }, [timeSignature, beatsPerMeasure]);

    const [playing, setPlaying] = useState(false);
    const [beat, setBeat] = useState(0);
    const [volume, setVolume] = useState(loadMetronomeVolume);
    const [bpmDraft, setBpmDraft] = useState(String(Math.round(bpm || 120)));

    const contextRef = useRef<AudioContext | null>(null);
    const timerRef = useRef<number | null>(null);
    const beatRef = useRef(0);
    const playingRef = useRef(false);
    const volumeRef = useRef(volume);
    const visualOnlyRef = useRef(visualOnly);
    const accents = useMemo(
      () => accentBeatsFor(parsed.beats, parsed.unit),
      [parsed.beats, parsed.unit],
    );
    const accentsRef = useRef(accents);

    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;

    useEffect(() => {
      setBpmDraft(String(Math.round(safeBpm)));
    }, [safeBpm]);

    useEffect(() => {
      volumeRef.current = volume;
    }, [volume]);

    useEffect(() => {
      visualOnlyRef.current = visualOnly;
    }, [visualOnly]);

    useEffect(() => {
      accentsRef.current = accents;
    }, [accents]);

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
      if (visualOnlyRef.current) return;
      const context = contextRef.current;
      if (!context) return;
      if (context.state === "suspended") {
        void context.resume();
      }
      scheduleClick(context, context.currentTime + 0.01, accent, volumeRef.current);
    }, []);

    const start = useCallback(async () => {
      if (playingRef.current) return;

      if (!visualOnlyRef.current) {
        if (!contextRef.current) {
          contextRef.current = new AudioContext();
        }
        const context = contextRef.current;
        if (context.state === "suspended") {
          await context.resume();
        }
      }

      beatRef.current = 0;
      setBeat(1);
      playClick(true);
      playingRef.current = true;
      setPlaying(true);

      const intervalMs = 60_000 / safeBpm;
      const beats = parsed.beats;
      timerRef.current = window.setInterval(() => {
        if (!playingRef.current) return;
        beatRef.current = (beatRef.current % beats) + 1;
        const currentBeat = beatRef.current;
        setBeat(currentBeat);
        playClick(accentsRef.current.has(currentBeat));
      }, intervalMs);
    }, [parsed.beats, playClick, safeBpm]);

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
    }, [safeBpm, parsed.beats, parsed.unit, stop]);

    useEffect(() => () => stop(), [stop]);

    const commitBpm = () => {
      if (!onBpmChange) return;
      const value = Number(bpmDraft.replace(",", "."));
      if (!Number.isFinite(value)) {
        setBpmDraft(String(Math.round(safeBpm)));
        return;
      }
      const next = Math.min(bpmMax, Math.max(bpmMin, Math.round(value)));
      setBpmDraft(String(next));
      if (next !== Math.round(safeBpm)) onBpmChange(next);
    };

    return (
      <div className={className ?? "mt-4 border-t border-white/10 pt-4"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-sm font-medium text-slate-200">Metrônomo</h3>
            <div className="flex flex-wrap items-end gap-3">
              {onBpmChange ? (
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  BPM
                  <input
                    type="number"
                    min={bpmMin}
                    max={bpmMax}
                    step={1}
                    value={bpmDraft}
                    onChange={(event) => setBpmDraft(event.target.value)}
                    onBlur={commitBpm}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-16 rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-slate-100 outline-none focus:border-green-500/50"
                  />
                </label>
              ) : (
                <p className="text-xs text-slate-500">{Math.round(safeBpm)} BPM</p>
              )}
              {onTimeSignatureChange ? (
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Compasso
                  <select
                    className={`${cifraSelectClass} !w-auto min-w-[5.5rem] py-1 text-sm`}
                    value={parsed.label}
                    onChange={(event) =>
                      onTimeSignatureChange(event.target.value as MultitrackTimeSignature)
                    }
                  >
                    {MULTITRACK_TIME_SIGNATURES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-slate-500">{parsed.label}</p>
              )}
            </div>
            {visualOnly ? (
              <p className="text-xs text-slate-500">
                Só visual — o click vem da faixa importada.
              </p>
            ) : null}
          </div>
          {visualOnly ? null : (
            <button
              type="button"
              onClick={toggle}
              className={
                playing
                  ? `${btnPrimary} px-4 py-2 text-sm`
                  : "rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-green-500/30 hover:text-green-300"
              }
            >
              {playing ? "Parar click" : "Play click"}
            </button>
          )}
        </div>

        {visualOnly ? null : (
          <VolumeControl
            label="Volume do metrônomo"
            value={volume}
            onChange={handleVolumeChange}
            className="mt-3"
          />
        )}

        <div className="mt-3 flex items-center gap-1.5">
          {Array.from({ length: parsed.beats }, (_, index) => {
            const measureBeat = index + 1;
            const active = playing && beat === measureBeat;
            const accent = accents.has(measureBeat);
            return (
              <span
                key={measureBeat}
                className={`h-2.5 flex-1 rounded-full transition-colors ${
                  active
                    ? accent
                      ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"
                      : "bg-green-500/70"
                    : "bg-white/10"
                }`}
              />
            );
          })}
        </div>
      </div>
    );
  },
);
