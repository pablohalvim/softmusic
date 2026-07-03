import { useCallback, useEffect, useState } from "react";

import {
  isAndroid,
  isIosDevice,
  isPwaStandalone,
  registerPwaServiceWorker,
  type BeforeInstallPromptEvent,
} from "./pwa";

export type PwaInstallResult = "installed" | "dismissed" | "instructions";

export interface UsePwaInstallOptions {
  registerServiceWorker?: boolean;
  serviceWorkerPath?: string;
}

export function usePwaInstall(options: UsePwaInstallOptions = {}) {
  const { registerServiceWorker = false, serviceWorkerPath = "/pwa-sw.js" } = options;

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    setIsStandalone(isPwaStandalone());
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobileViewport(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!registerServiceWorker) return;
    void registerPwaServiceWorker(serviceWorkerPath);
  }, [registerServiceWorker, serviceWorkerPath]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const canNativeInstall = Boolean(deferredPrompt);
  const isIos = isIosDevice();
  const showShortcut = !isStandalone && (canNativeInstall || isIos || isAndroid() || isMobileViewport);

  const install = useCallback(async (): Promise<PwaInstallResult> => {
    if (isStandalone) return "installed";

    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choice.outcome === "accepted") {
        setIsStandalone(isPwaStandalone());
        return "installed";
      }
      return "dismissed";
    }

    return "instructions";
  }, [deferredPrompt, isStandalone]);

  return {
    showShortcut,
    isStandalone,
    canNativeInstall,
    isIos,
    isAndroid: isAndroid(),
    install,
  };
}
