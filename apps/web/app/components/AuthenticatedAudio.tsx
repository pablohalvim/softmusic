import { useEffect, useState } from "react";

import { authFetch, fetchAuthenticatedBlob } from "../lib/api";

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
    void fetchAuthenticatedBlob(path)
      .then((url) => {
        objectUrl = url;
        setAudioUrl(url);
        setError(false);
      })
      .catch(() => {
        setError(true);
        setAudioUrl(null);
      });
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path]);

  async function handleDownload() {
    const response = await authFetch(path);
    if (!response.ok) {
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadName ?? "audio.wav";
    anchor.click();
    URL.revokeObjectURL(url);
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
          className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-200"
        >
          Salvar
        </button>
      ) : null}
    </div>
  );
}
