import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const DEVICE_KEY = "samepace.health.device.v1";
let pending: Promise<string> | null = null;
/** An installation identifier only. Health records and anchors never enter storage. */
export function getHealthDeviceId(): Promise<string> {
  if (!pending) {
    pending = (async () => {
      const stored = await SecureStore.getItemAsync(DEVICE_KEY);
      if (stored) return stored;
      const deviceId = Crypto.randomUUID();
      await SecureStore.setItemAsync(DEVICE_KEY, deviceId, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return deviceId;
    })().catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}
