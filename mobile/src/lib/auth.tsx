import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import {
  authRequest,
  setApiToken,
  setUnauthorizedHandler,
  signOutRequest,
  socialSignInRequest,
} from "./api";
import type { SocialResult } from "./social";

const TOKEN_KEY = "pace.session-token";

// SecureStore is the device keychain/keystore. It has no web implementation, and
// web is only a dev convenience here, so fall back to memory there.
const store = {
  get: () => (Platform.OS === "web" ? Promise.resolve(null) : SecureStore.getItemAsync(TOKEN_KEY)),
  set: (v: string) =>
    Platform.OS === "web" ? Promise.resolve() : SecureStore.setItemAsync(TOKEN_KEY, v),
  clear: () => (Platform.OS === "web" ? Promise.resolve() : SecureStore.deleteItemAsync(TOKEN_KEY)),
};

type AuthState = {
  /** `null` while the keychain is still being read. */
  signedIn: boolean | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  /** Finish an Apple/Google sign-in. A `null` result (they backed out) is a no-op. */
  signInWithToken: (result: SocialResult) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const queryClient = useQueryClient();

  const drop = useCallback(async () => {
    setApiToken(null);
    setSignedIn(false);
    queryClient.clear();
    await store.clear().catch(() => undefined);
  }, [queryClient]);

  useEffect(() => {
    let alive = true;
    // Dev builds only: `EXPO_PUBLIC_DEV_TOKEN` (in the gitignored `.env.local`)
    // skips the sign-in form so simulators can be driven without typing passwords.
    const devToken = __DEV__ ? process.env.EXPO_PUBLIC_DEV_TOKEN : undefined;
    (devToken ? Promise.resolve(devToken) : store.get())
      .catch(() => null)
      .then((saved) => {
        if (!alive) return;
        setApiToken(saved);
        setSignedIn(Boolean(saved));
      });
    setUnauthorizedHandler(() => void drop());
    return () => {
      alive = false;
      setUnauthorizedHandler(null);
    };
  }, [drop]);

  const value = useMemo<AuthState>(() => {
    const accept = async (token: string) => {
      setApiToken(token);
      await store.set(token);
      setSignedIn(true);
    };
    return {
      signedIn,
      signIn: async (email, password) => {
        const { token } = await authRequest("/sign-in/email", { email, password });
        await accept(token);
      },
      signUp: async (name, email, password) => {
        const { token } = await authRequest("/sign-up/email", { name, email, password });
        await accept(token);
      },
      signInWithToken: async (result) => {
        if (!result) return;
        const { token } = await socialSignInRequest(result.provider, result.idToken);
        await accept(token);
      },
      signOut: async () => {
        await signOutRequest();
        await drop();
      },
    };
  }, [signedIn, drop]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
