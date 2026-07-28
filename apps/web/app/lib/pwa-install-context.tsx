import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  isAndroid,
  isIosDevice,
  isPwaStandalone,
  type BeforeInstallPromptEvent,
} from "./pwa";
import type { PwaInstallResult } from "./use-pwa-install";

interface PwaInstallContextValue {
  showShortcut: boolean;
  isStandalone: boolean;
  canNativeInstall: boolean;
  isIos: boolean;
  isAndroid: boolean;
  install: () => Promise<PwaInstallResult>;
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

/**
 * Um único listener de beforeinstallprompt no app.
 * Evita preventDefault duplicado (ex.: botão Instalar no desktop + menu mobile).
 */
export function PwaInstallProvider({ children }: { children: ReactNode }) {
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
    const onBeforeInstallPrompt = (event: Event) => {
      // Necessário para instalar via botão customizado ("Instalar app").
      // O Chrome loga um aviso informativo até chamar prompt() — é o fluxo oficial de PWA.
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

  const value = useMemo<PwaInstallContextValue>(() => {
    const canNativeInstall = Boolean(deferredPrompt);
    const ios = isIosDevice();
    return {
      showShortcut: !isStandalone && (canNativeInstall || ios || isAndroid() || isMobileViewport),
      isStandalone,
      canNativeInstall,
      isIos: ios,
      isAndroid: isAndroid(),
      install,
    };
  }, [deferredPrompt, install, isMobileViewport, isStandalone]);

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

export function usePwaInstallContext(): PwaInstallContextValue {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    throw new Error("usePwaInstallContext deve ser usado dentro de PwaInstallProvider");
  }
  return ctx;
}
