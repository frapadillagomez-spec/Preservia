import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { router } from "expo-router";

import { api, TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  provider: string;
  is_admin?: boolean;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  googleBusy: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthContext);

const AUTH_URL = "https://auth.emergentagent.com/";

function extractSessionId(url: string): string | null {
  const frag = url.includes("#") ? url.split("#")[1] : "";
  const query = url.includes("?") ? url.split("?")[1].split("#")[0] : "";
  for (const part of [frag, query]) {
    const params = new URLSearchParams(part);
    const sid = params.get("session_id");
    if (sid) return sid;
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);

  const persist = useCallback(async (resp: { access_token: string; user: User }) => {
    await storage.secureSet(TOKEN_KEY, resp.access_token);
    setUser(resp.user);
  }, []);

  const processSessionId = useCallback(
    async (sessionId: string) => {
      setGoogleBusy(true);
      try {
        const resp = await api.post("/auth/google", { session_id: sessionId }, false);
        await persist(resp);
        router.replace("/(tabs)");
      } finally {
        setGoogleBusy(false);
      }
    },
    [persist],
  );

  // Bootstrap: existing session + web redirect handling
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const sid = extractSessionId(window.location.href);
          if (sid) {
            await processSessionId(sid);
            window.history.replaceState(null, "", window.location.pathname);
            return;
          }
        }
        const token = await storage.secureGet<string>(TOKEN_KEY, "");
        if (token) {
          const resp = await api.get("/auth/me");
          setUser(resp.user);
        }
      } catch {
        await storage.secureRemove(TOKEN_KEY);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const resp = await api.post("/auth/login", { email, password }, false);
      await persist(resp);
    },
    [persist],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const resp = await api.post("/auth/register", { name, email, password }, false);
      await persist(resp);
    },
    [persist],
  );

  const loginWithGoogle = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin + "/"
        : Linking.createURL("auth");
    const authUrl = `${AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = authUrl;
      return;
    }
    setGoogleBusy(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === "success" && result.url) {
        const sid = extractSessionId(result.url);
        if (sid) await processSessionId(sid);
      }
    } finally {
      setGoogleBusy(false);
    }
  }, [processSessionId]);

  const logout = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
    router.replace("/login");
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, googleBusy, login, register, loginWithGoogle, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
