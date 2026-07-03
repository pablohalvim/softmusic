const ACCESS_KEY = "softmusic:access_token";
const REFRESH_KEY = "softmusic:refresh_token";
const BAND_KEY = "softmusic:active_band_id";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export function loadTokens(): AuthTokens | null {
  try {
    const access_token = localStorage.getItem(ACCESS_KEY);
    const refresh_token = localStorage.getItem(REFRESH_KEY);
    if (!access_token || !refresh_token) {
      return null;
    }
    return { access_token, refresh_token };
  } catch {
    return null;
  }
}

export function saveTokens(tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function loadActiveBandId(): string | null {
  try {
    return localStorage.getItem(BAND_KEY);
  } catch {
    return null;
  }
}

export function saveActiveBandId(bandId: string): void {
  localStorage.setItem(BAND_KEY, bandId);
}

export function clearActiveBandId(): void {
  localStorage.removeItem(BAND_KEY);
}
