import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import type { MeResponse, TokenResponse } from "contract";
import { API_BASE_URL } from "./config";

// expo-secure-store (Keychain/Keystore) — never AsyncStorage, which is
// plaintext on disk. Non-negotiable per
// docs/product/mobile-technical-plan-2026-09.md §2.5.
const TOKEN_KEY = "narrata.session.token";

interface AuthState {
  token: string | null;
  user: MeResponse["user"] | null;
  /** True only during the cold-start "is there already a stored session" check. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MeResponse["user"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!stored) {
        if (!cancelled) setLoading(false);
        return;
      }
      // Re-derive the user from /me rather than trusting a persisted copy —
      // cheap, and catches a token that's since been revoked or expired.
      try {
        const res = await fetch(`${API_BASE_URL}/api/mobile/v1/me`, {
          headers: { Authorization: `Bearer ${stored}` },
        });
        if (cancelled) return;
        if (res.ok) {
          const me: MeResponse = await res.json();
          setToken(stored);
          setUser(me.user);
        } else {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
        }
      } catch {
        // Offline at cold start: keep the stored token and let the user in
        // rather than forcing a login screen because the network hiccuped
        // once. The Review queue's own offline handling (mobile-app-ux-plan
        // §5.5) is the real answer for working disconnected; this is just
        // "don't punish a bad first request."
        setToken(stored);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error ?? "Couldn't sign in.");
    }
    const data = body as TokenResponse;
    await SecureStore.setItemAsync(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const current = token;
    setToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    if (current) {
      // Fire-and-forget: the client-side sign-out (clearing the stored
      // token) is what actually matters for this device; a failed revoke
      // just leaves an orphaned Session row expiring on its own schedule.
      fetch(`${API_BASE_URL}/api/auth/token/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${current}` },
      }).catch(() => {});
    }
  }, [token]);

  return <AuthContext.Provider value={{ token, user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within AuthProvider");
  return ctx;
}
