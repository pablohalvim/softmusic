export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const PWA_VERSION_DISMISSED_KEY = "softmusic:pwa-update-dismissed";
export const SERVICE_WORKER_PATH = "/pwa-sw.js";

export function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !(window as Window & { MSStream?: unknown }).MSStream
  );
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

export async function registerPwaServiceWorker(
  scriptUrl = SERVICE_WORKER_PATH,
): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }
  try {
    let registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) {
      registration = await navigator.serviceWorker.register(scriptUrl, { scope: "/" });
    } else {
      await registration.update();
    }
    return registration;
  } catch {
    return undefined;
  }
}

export interface AppVersionManifest {
  version: string;
  builtAt?: string;
}

declare const __APP_VERSION__: string;

export function getBundledAppVersion(): string {
  return typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0 ? __APP_VERSION__ : "0.0.0";
}

export async function fetchDeployedAppVersion(): Promise<AppVersionManifest | null> {
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch(`/version.json?_=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as AppVersionManifest;
    return data?.version ? data : null;
  } catch {
    return null;
  }
}

function getDismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(PWA_VERSION_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdatePrompt(deployedVersion: string): void {
  try {
    localStorage.setItem(PWA_VERSION_DISMISSED_KEY, deployedVersion);
  } catch {
    /* ignore */
  }
}

function clearDismissedUpdatePrompt(): void {
  try {
    localStorage.removeItem(PWA_VERSION_DISMISSED_KEY);
  } catch {
    /* ignore */
  }
}

export async function applyAppUpdate(): Promise<void> {
  clearDismissedUpdatePrompt();

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
    for (const registration of registrations) {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    }
  }

  if (typeof window !== "undefined" && "caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  window.location.reload();
}

export async function checkAppUpdateAvailable(): Promise<{
  available: boolean;
  bundledVersion: string;
  deployedVersion?: string;
}> {
  const bundledVersion = getBundledAppVersion();
  const deployed = await fetchDeployedAppVersion();
  if (!deployed) {
    return { available: false, bundledVersion };
  }

  const available = bundledVersion.trim() !== deployed.version.trim();
  const dismissed = getDismissedUpdateVersion();
  if (available && dismissed === deployed.version) {
    return { available: false, bundledVersion, deployedVersion: deployed.version };
  }
  return { available, bundledVersion, deployedVersion: deployed.version };
}
