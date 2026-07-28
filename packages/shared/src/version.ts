/** Versão do produto SoftMusic (semver). Patch sobe +1 a cada commit. */
export const APP_VERSION = "1.0.13";

export const APP_COPYRIGHT_YEAR = 2026;

export const APP_VENDOR = "MIND X Solutions";

export function formatAppFooter(): string {
  return `${APP_VENDOR} ® ${APP_COPYRIGHT_YEAR} - Version: ${APP_VERSION}`;
}
