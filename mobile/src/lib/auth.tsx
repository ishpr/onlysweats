import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import {
  captureApiSession,
  setApiToken,
  setUnauthorizedHandler,
  captureLogoutCleanup,
  socialSignInRequest,
} from "./api";
import { capturePushLogout, fencePushRegistration } from "./push";
import { localFirstLogout, revokeAfterDeviceCleanup } from "./logout-cleanup";
import { clearWidgets } from "./widgets";
import { signOutOfGoogle, type SocialResult } from "./social";
import { createSerialWrites } from "./serial-writes";
import { clearWorkoutRecovery } from "./workout-plans/recovery";
import { bindOfflineWorkoutSession, clearOfflineWorkouts } from "./workout-plans/offline";
import { bindAppTermsSession, clearAppTermsReceipt } from "./app-terms";

const TOKEN_KEY = "pace.session-token";

// SecureStore is the device keychain/keystore. It has no web implementation, and
// web is only a dev convenience here, so fall back to memory there.
const serializeTokenWrite = createSerialWrites();
const store = {
  get: () => (Platform.OS === "web" ? Promise.resolve(null) : SecureStore.getItemAsync(TOKEN_KEY)),
  set: (v: string) =>
    serializeTokenWrite(() =>
      Platform.OS === "web" ? Promise.resolve() : SecureStore.setItemAsync(TOKEN_KEY, v),
    ),
  clear: () =>
    serializeTokenWrite(() =>
      Platform.OS === "web" ? Promise.resolve() : SecureStore.deleteItemAsync(TOKEN_KEY),
    ),
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
  const authOperation = useRef(0);

  const drop = useCallback(async () => {
    authOperation.current++;
    fencePushRegistration();
    // Nothing about the last member stays on the Home Screen or Lock Screen.
    clearWidgets();
    setApiToken(null);
    const offlineClearing = clearOfflineWorkouts();
    const recoveryClearing = clearWorkoutRecovery();
    const tokenClearing = store.clear();
    const termsClearing = clearAppTermsReceipt();
    setSignedIn(false);
    queryClient.clear();
    await Promise.all(
      [offlineClearing, recoveryClearing, tokenClearing, termsClearing].map((operation) =>
        operation.catch(() => undefined),
      ),
    );
  }, [queryClient]);

  useEffect(() => {
    let alive = true;
    const generation = authOperation.current;
    // Dev builds only: `EXPO_PUBLIC_DEV_TOKEN` (in the gitignored `.env.local`)
    // skips the sign-in form so simulators can be driven without typing passwords.
    const devToken = __DEV__ ? process.env.EXPO_PUBLIC_DEV_TOKEN : undefined;
    (devToken ? Promise.resolve(devToken) : store.get())
      .catch(() => null)
      .then((saved) => {
        if (!alive || generation !== authOperation.current) return;
        bindOfflineWorkoutSession(saved);
        setApiToken(saved);
        bindAppTermsSession(saved);
        if (!saved) void clearOfflineWorkouts().catch(() => undefined);
        if (!saved) void clearAppTermsReceipt().catch(() => undefined);
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
      const generation = ++authOperation.current;
      fencePushRegistration();
      setApiToken(null);
      setSignedIn(false);
      queryClient.clear();
      const offlineClearing = clearOfflineWorkouts();
      const recoveryClearing = clearWorkoutRecovery();
      const tokenClearing = store.clear();
      const termsClearing = clearAppTermsReceipt();
      await Promise.all([
        offlineClearing.catch(() => undefined),
        recoveryClearing.catch(() => undefined),
        tokenClearing,
        termsClearing.catch(() => undefined),
      ]);
      if (generation !== authOperation.current) return null;
      await store.set(token);
      if (generation !== authOperation.current) return null;
      bindOfflineWorkoutSession(token);
      setApiToken(token);
      bindAppTermsSession(token);
      setSignedIn(true);
      return captureApiSession();
    };
    return {
      signedIn,
      signInWithToken: async (result) => {
        if (!result) return;
        const generation = authOperation.current;
        const { token } = await socialSignInRequest(result.provider, result.idToken);
        if (generation !== authOperation.current) return;
        const accepted = await accept(token);
        if (!accepted) return;
        if (result.authorizationCode) {
          // Best effort: sign-in has already succeeded.
          void accepted
            .request("/me/apple-authorization", {
              method: "POST",
              json: { code: result.authorizationCode },
            })
            .catch(() => undefined);
        }
      },
      signOut: (opts) => {
        const cleanup = captureLogoutCleanup();
        let logoutGeneration = -1;
        let deviceCleanupOpen = true;
        // Capture and enqueue old-device cleanup without awaiting native/network work.
        const pushCleanup = capturePushLogout((pushToken) =>
          deviceCleanupOpen && authOperation.current === logoutGeneration
            ? cleanup.unregisterDevice(pushToken)
            : Promise.resolve(),
        );
        return localFirstLogout(
          () => {
            const local = drop(); // Fences UI, token, private queues synchronously.
            logoutGeneration = authOperation.current;
            return local;
          },
          async () => {
            const googleCleanup = signOutOfGoogle({
              revoke: opts?.accountDeleted,
              isCurrent: () => authOperation.current === logoutGeneration,
            });
            await revokeAfterDeviceCleanup(
              pushCleanup,
              () => {
                deviceCleanupOpen = false;
              },
              cleanup.revokeSession,
            );
            await googleCleanup;
          },
        );
      },
    };
  }, [signedIn, drop, queryClient]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
