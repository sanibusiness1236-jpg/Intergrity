import { create } from "zustand";
import api, { setAuthTokens, clearAuthTokens } from "@/lib/api";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<User | undefined>;
  register: (data: Record<string, string>) => Promise<User | undefined>;
  logout: () => void;
  fetchProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuthTokens(data.data.accessToken, data.data.refreshToken);
      set({ user: data.data.user, isAuthenticated: true });
      return data.data.user;
    } finally {
      set({ isLoading: false });
    }
  },

  register: async (formData) => {
    set({ isLoading: true });
    try {
      // Send every non-empty field. The role is decided server-side by the
      // invite token, so we must NOT strip studentId/program/gender here — the
      // backend already ignores those fields for non-student roles. Stripping
      // them on the client previously dropped the student ID entirely, which
      // broke the self-service password reset.
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(formData)) {
        if (typeof v === "string" && v.trim() === "") continue;
        payload[k] = v;
      }
      const { data } = await api.post("/auth/register", payload);
      setAuthTokens(data.data.accessToken, data.data.refreshToken);
      set({ user: data.data.user, isAuthenticated: true });
      return data.data.user;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: () => {
    clearAuthTokens();
    set({ user: null, isAuthenticated: false });
  },

  fetchProfile: async () => {
    try {
      const { data } = await api.get("/auth/profile");
      set({ user: data.data, isAuthenticated: true });
    } catch {
      set({ user: null, isAuthenticated: false });
    }
  },
}));
