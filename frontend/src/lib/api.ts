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
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
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
