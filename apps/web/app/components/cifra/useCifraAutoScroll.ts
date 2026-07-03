import { cifraScrollPixelsPerSecond } from "@softmusic/shared/cifra-scroll";
import { useEffect, useRef } from "react";

interface UseCifraAutoScrollOptions {
  playing: boolean;
  bpm: number;
  speedMultiplier: number;
  syncWithAudio: boolean;
  songId: string;
}

function getScrollElement(): HTMLElement {
  const element = document.scrollingElement ?? document.documentElement;
  return element as HTMLElement;
}

export function useCifraAutoScroll({
  playing,
  bpm,
  speedMultiplier,
  syncWithAudio,
  songId,
}: UseCifraAutoScrollOptions): void {
  const pausedByAudioRef = useRef(false);
  const pausedByUserRef = useRef(false);
  const resumeTimeoutRef = useRef<number | null>(null);
  const scrollRemainderRef = useRef(0);
  const pixelsPerSecondRef = useRef(
    cifraScrollPixelsPerSecond({ bpm, speedMultiplier }),
  );

  useEffect(() => {
    pixelsPerSecondRef.current = cifraScrollPixelsPerSecond({ bpm, speedMultiplier });
  }, [bpm, speedMultiplier]);

  useEffect(() => {
    if (!playing) {
      pausedByUserRef.current = false;
      scrollRemainderRef.current = 0;
      return;
    }

    let frameId = 0;
    let lastTimestamp = 0;

    const step = (timestamp: number) => {
      if (!lastTimestamp) {
        lastTimestamp = timestamp;
      }
      const deltaSeconds = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (!pausedByAudioRef.current && !pausedByUserRef.current) {
        const scrollElement = getScrollElement();
        const maxScroll = Math.max(0, scrollElement.scrollHeight - window.innerHeight);

        if (scrollElement.scrollTop < maxScroll - 0.5) {
          scrollRemainderRef.current += pixelsPerSecondRef.current * deltaSeconds;
          const pixelsToScroll = Math.floor(scrollRemainderRef.current);

          if (pixelsToScroll > 0) {
            scrollRemainderRef.current -= pixelsToScroll;
            scrollElement.scrollTop = Math.min(
              scrollElement.scrollTop + pixelsToScroll,
              maxScroll,
            );
          }
        } else {
          scrollRemainderRef.current = 0;
        }
      }

      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [playing]);

  useEffect(() => {
    if (!playing) return;

    const pauseForUserInteraction = (event: Event) => {
      if (!event.isTrusted) return;
      pausedByUserRef.current = true;
      if (resumeTimeoutRef.current !== null) {
        window.clearTimeout(resumeTimeoutRef.current);
      }
      resumeTimeoutRef.current = window.setTimeout(() => {
        pausedByUserRef.current = false;
        resumeTimeoutRef.current = null;
      }, 3000);
    };

    window.addEventListener("wheel", pauseForUserInteraction, { passive: true });
    window.addEventListener("touchstart", pauseForUserInteraction, { passive: true });
    return () => {
      window.removeEventListener("wheel", pauseForUserInteraction);
      window.removeEventListener("touchstart", pauseForUserInteraction);
      if (resumeTimeoutRef.current !== null) {
        window.clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, [playing]);

  useEffect(() => {
    if (!playing || !syncWithAudio) {
      pausedByAudioRef.current = false;
      return;
    }

    const audio = document.querySelector<HTMLAudioElement>(
      `[data-softmusic-song-audio="${songId}"]`,
    );
    if (!audio) return;

    const syncPausedState = () => {
      pausedByAudioRef.current = audio.paused;
    };

    syncPausedState();
    audio.addEventListener("play", syncPausedState);
    audio.addEventListener("pause", syncPausedState);
    audio.addEventListener("ended", syncPausedState);

    return () => {
      audio.removeEventListener("play", syncPausedState);
      audio.removeEventListener("pause", syncPausedState);
      audio.removeEventListener("ended", syncPausedState);
    };
  }, [playing, syncWithAudio, songId]);
}
