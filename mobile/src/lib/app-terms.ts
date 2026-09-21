import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ApiError, type ApiSession } from "./api";
import type { SessionRequest } from "./session-transport";
import { createAppTermsStore } from "./app-terms-store";

const KEY = "pace.app-terms-receipt";
export const appTermsReceipt = createAppTermsStore({
  read: () => (Platform.OS === "web" ? Promise.resolve(null) : SecureStore.getItemAsync(KEY)),
  write: (value) =>
    Platform.OS === "web"
      ? Promise.resolve()
      : SecureStore.setItemAsync(KEY, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
  clear: () => (Platform.OS === "web" ? Promise.resolve() : SecureStore.deleteItemAsync(KEY)),
});
export const bindAppTermsSession = (token: string | null) =>
  appTermsReceipt.bind(
    token ? Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token) : null,
  );
export const clearAppTermsReceipt = () => appTermsReceipt.clear();

/** Onboarding has a deadline even when the transport ignores cancellation. */
export async function requestAppTerms<T>(
  session: ApiSession,
  init: SessionRequest = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = () => controller.abort();
  init.signal?.addEventListener("abort", cancelled, { once: true });
  if (init.signal?.aborted) controller.abort();
  try {
    const result = await Promise.race([
      session.request<T>("/me/terms", { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new ApiError(
              0,
              "Connect to the internet to confirm your SamePace terms, then try again.",
            ),
          );
        }, 15_000);
      }),
    ]);
    if (!session.isCurrent() || controller.signal.aborted)
      throw new Error("Sign in again to continue.");
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancelled);
  }
}
