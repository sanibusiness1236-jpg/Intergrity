import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

/**
 * Auth tokens are stored in sessionStorage (per-tab, NOT shared across tabs).
 * This is intentional: it lets one user be signed in as e.g. an Examiner in
 * tab A and a Student in tab B without one tab's session clobbering the
 * other's. sessionStorage survives page reloads but is cleared when the tab
 * is closed.
 */
const TOKEN_KEYS = { access: "accessToken", refresh: "refreshToken" } as const;

/** Reads the access token — sessionStorage first, then falls back to a
 *  one-time localStorage migration for users who were logged in before we
 *  switched storage strategies. */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const ss = sessionStorage.getItem(TOKEN_KEYS.access);
  if (ss) return ss;
  // One-time migration: move any old localStorage token into sessionStorage
  // so this tab adopts it and localStorage can't interfere with other tabs.
  const ls = localStorage.getItem(TOKEN_KEYS.access);
  if (ls) {
    const lsRefresh = localStorage.getItem(TOKEN_KEYS.refresh);
    sessionStorage.setItem(TOKEN_KEYS.access, ls);
    if (lsRefresh) sessionStorage.setItem(TOKEN_KEYS.refresh, lsRefresh);
    localStorage.removeItem(TOKEN_KEYS.access);
    localStorage.removeItem(TOKEN_KEYS.refresh);
  }
  return ls;
}
export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEYS.refresh) || localStorage.getItem(TOKEN_KEYS.refresh);
}
export function setAuthTokens(accessToken: string, refreshToken: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(TOKEN_KEYS.access, accessToken);
  sessionStorage.setItem(TOKEN_KEYS.refresh, refreshToken);
  localStorage.removeItem(TOKEN_KEYS.access);
  localStorage.removeItem(TOKEN_KEYS.refresh);
}
export function clearAuthTokens() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TOKEN_KEYS.access);
  sessionStorage.removeItem(TOKEN_KEYS.refresh);
  localStorage.removeItem(TOKEN_KEYS.access);
  localStorage.removeItem(TOKEN_KEYS.refresh);
}

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  // A free-tier backend can take 30-50s to wake from a cold start. Allow a
  // generous timeout so a waking server still completes instead of failing fast.
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 3000, 6000];

/**
 * Decide whether a failed request is worth retrying. We only retry on
 * transient conditions (no response = network/timeout, or 502/503/504 from a
 * waking/overloaded server) and only on operations that are safe to repeat:
 * all GETs plus the idempotent auth operations. Registration is excluded so a
 * retry can never double-consume an invite link.
 */
function isRetryable(error: { config?: { method?: string; url?: string }; response?: { status?: number }; code?: string }): boolean {
  const cfg = error.config;
  if (!cfg) return false;
  const status = error.response?.status;
  const transient =
    !error.response || // network error / timeout
    error.code === "ECONNABORTED" ||
    status === 502 ||
    status === 503 ||
    status === 504;
  if (!transient) return false;

  const method = (cfg.method || "get").toLowerCase();
  const url = cfg.url || "";
  const safeAuthOp = /\/auth\/(login|refresh|reset-password)$/.test(url);
  return method === "get" || safeAuthOp;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // ── Transient-failure retry (cold starts, brief 5xx, network blips) ──
    if (original && isRetryable(error)) {
      original.__retryCount = (original.__retryCount || 0) as number;
      if (original.__retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[original.__retryCount] ?? 6000;
        original.__retryCount += 1;
        await sleep(delay);
        return api(original);
      }
    }

    // A 401 from the auth endpoints themselves means bad credentials / expired
    // token — NOT an access-token expiry to silently refresh. Let the error
    // propagate so the login form can show "Invalid credentials".
    const isAuthEndpoint = /\/auth\//.test(original?.url || "");

    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        const refreshToken = getRefreshToken();
        if (!refreshToken) throw new Error("No refresh token");
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
        setAuthTokens(data.data.accessToken, data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch {
        clearAuthTokens();
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  },
);

export default api;
