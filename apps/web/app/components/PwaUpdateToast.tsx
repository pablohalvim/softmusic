import { useCallback, useEffect, useState } from "react";

import {
  applyAppUpdate,
  checkAppUpdateAvailable,
  dismissUpdatePrompt,
  registerPwaServiceWorker,
} from "../lib/pwa";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function PwaUpdateToast() {
  const [deployedVersion, setDeployedVersion] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const checkForUpdate = useCallback(async () => {
    const result = await checkAppUpdateAvailable();
    setDeployedVersion(result.available && result.deployedVersion ? result.deployedVersion : null);
  }, []);

  useEffect(() => {
    void registerPwaServiceWorker();
    void checkForUpdate();

    const intervalId = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PWA_VERSION_ACTIVATED") void checkForUpdate();
    };
    const onControllerChange = () => window.location.reload();

    document.addEventListener("visibilitychange", onVisibilityChange);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onMessage);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
    };
  }, [checkForUpdate]);

  if (!deployedVersion) return null;

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await applyAppUpdate();
    } catch {
      setIsApplying(false);
    }
  };

  const handleDismiss = () => {
    dismissUpdatePrompt(deployedVersion);
    setDeployedVersion(null);
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[9998] flex justify-center px-4 sm:bottom-6 sm:justify-end sm:px-6"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-green-500/40 bg-slate-900 shadow-xl">
        <div className="h-1 w-full bg-gradient-to-r from-green-500 via-green-400 to-green-500" />
        <div className="flex items-start gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-100">Nova versão disponível</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">
              A versão {deployedVersion} já está no servidor. Atualize para carregar a versão mais recente.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={isApplying}
                className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              >
                {isApplying ? "Atualizando…" : "Atualizar agora"}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                disabled={isApplying}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 sm:text-sm"
              >
                Depois
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isApplying}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
            aria-label="Fechar aviso de atualização"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
