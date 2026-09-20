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
  api,
  setApiToken,
  setUnauthorizedHandler,
  signOutRequest,
  socialSignInRequest,
} from "./api";
import { unregisterPush } from "./push";
import { clearWidgets } from "./widgets";
import { signOutOfGoogle, type SocialResult } from "./social";

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
  /** Finish an Apple/Google sign-in. A `null` result (they backed out) is a no-op. */
  signInWithToken: (result: SocialResult) => Promise<void>;
  /** `accountDeleted` also withdraws the app's access to the Google account. */
  signOut: (opts?: { accountDeleted?: boolean }) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const queryClient = useQueryClient();

  const drop = useCallback(async () => {
    // Nothing about the last member stays on the Home Screen or Lock Screen.
    clearWidgets();
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
      signInWithToken: async (result) => {
        if (!result) return;
        const { token } = await socialSignInRequest(result.provider, result.idToken);
        await accept(token);
        if (result.authorizationCode) {
          // Best effort: sign-in has already succeeded.
          void api("/me/apple-authorization", {
            method: "POST",
            json: { code: result.authorizationCode },
          }).catch(() => undefined);
        }
      },
      signOut: async (opts) => {
        // While the token still works: this phone stops getting my notifications.
        await unregisterPush();
        await signOutRequest();
        await signOutOfGoogle({ revoke: opts?.accountDeleted });
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
