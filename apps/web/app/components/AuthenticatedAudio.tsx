import { useEffect, useState } from "react";

import { resolveAuthenticatedMediaUrl } from "../lib/api";

interface AuthenticatedAudioProps {
  path: string;
  className?: string;
  label: string;
  downloadName?: string;
}

export function AuthenticatedAudio({
  path,
  className,
  label,
  downloadName,
}: AuthenticatedAudioProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setAudioUrl(null);
    setError(false);
    void resolveAuthenticatedMediaUrl(path)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.isObjectUrl) URL.revokeObjectURL(resolved.url);
          return;
        }
        if (resolved.isObjectUrl) objectUrl = resolved.url;
        setAudioUrl(resolved.url);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setAudioUrl(null);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path]);

  async function handleDownload() {
    const resolved = await resolveAuthenticatedMediaUrl(path);
    const anchor = document.createElement("a");
    anchor.href = resolved.url;
    anchor.download = downloadName ?? "audio.wav";
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    if (resolved.isObjectUrl) URL.revokeObjectURL(resolved.url);
  }

  if (error) {
    return <p className="mt-3 text-xs text-amber-300/80">Áudio indisponível.</p>;
  }

  if (!audioUrl) {
    return <p className="mt-3 text-xs text-slate-500">Carregando áudio...</p>;
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <audio controls preload="metadata" src={audioUrl} className={className} aria-label={label}>
        Seu navegador não suporta reprodução de áudio.
      </audio>
      {downloadName ? (
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-green-500/50 hover:text-green-200"
        >
          Salvar
        </button>
      ) : null}
    </div>
  );
}
