import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ApiError, type ApiSession } from "../api";
import type { SessionRequest } from "../session-transport";
import { validRun, type OfflineDocument } from "./offline-data";
import { createOfflineWorkoutStore } from "./offline-store";
import { createOfflineWorkoutSync, OfflineWorkoutRequestError } from "./offline-sync";

const KEY = "samepace.workout.offline.v1";
const directory = () => new Directory(Paths.document, "workout-offline-v1");
const MAX_BYTES = 1_500_000;
type Manifest = { file: string; key: string };
async function manifest(): Promise<Manifest | null> {
  if (Platform.OS === "web" || !(await SecureStore.isAvailableAsync()))
    throw new Error("Protected offline storage is unavailable on this device.");
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (
    typeof value.file !== "string" ||
    !/^[a-f0-9-]+\.bin$/.test(value.file) ||
    typeof value.key !== "string"
  )
    throw new Error("The saved workout file cannot be read.");
  return value;
}
async function removeStorage() {
  if (Platform.OS === "web") return;
  // Destroy the encryption key before deleting ciphertext, including orphan files.
  await SecureStore.deleteItemAsync(KEY);
  const folder = directory();
  if (folder.exists) folder.delete();
}
async function readStorage() {
  const ref = await manifest();
  if (!ref) return null;
  const file = new File(directory(), ref.file);
  if (!file.exists || file.size > MAX_BYTES)
    throw new Error("The saved workout file cannot be read.");
  const key = await Crypto.AESEncryptionKey.import(ref.key, "base64");
  const sealed = Crypto.AESSealedData.fromCombined(await file.bytes());
  const bytes = await Crypto.aesDecryptAsync(sealed, key);
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function writeStorage(value: OfflineDocument) {
  await manifest(); // Capability and protected-storage check before claiming durability.
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > MAX_BYTES - 100)
    throw new Error("Offline workout storage is full. Sync or remove another saved workout first.");
  const key = await Crypto.AESEncryptionKey.generate();
  const sealed = await Crypto.aesEncryptAsync(bytes, key);
  const folder = directory();
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `${Crypto.randomUUID()}.bin`);
  file.write(await sealed.combined());
  try {
    // One atomic, small keychain write commits the new complete file and key.
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify({ file: file.name, key: await key.encoded("base64") }),
      {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
  } catch (error) {
    file.delete();
    throw error;
  }
  for (const old of folder.list())
    if (old.name !== file.name) {
      try {
        old.delete();
      } catch {
        /* orphan ciphertext is harmless */
      }
    }
}

export const offlineWorkouts = createOfflineWorkoutStore({
  read: readStorage,
  write: writeStorage,
  remove: removeStorage,
  now: Date.now,
});
export function bindOfflineWorkoutSession(token: string | null) {
  offlineWorkouts.bind(
    token
      ? Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
      : Promise.resolve(null),
  );
}
export const clearOfflineWorkouts = () => offlineWorkouts.clear();
const workoutSync = createOfflineWorkoutSync({
  store: offlineWorkouts,
  mutationId: Crypto.randomUUID,
  status: (error) => (error instanceof ApiError ? error.status : undefined),
  isRun: validRun,
});
function transportError(error: unknown): never {
  if (error instanceof OfflineWorkoutRequestError) {
    throw new ApiError(
      error.code === "session_changed" ? 401 : error.code === "invalid_response" ? 502 : 0,
      error.message,
    );
  }
  throw error;
}

/** Verification and online-only actions share the same bounded captured-session transport. */
export async function boundedWorkoutRequest<T>(
  session: ApiSession,
  path: string,
  init: SessionRequest = {},
): Promise<T> {
  try {
    return await workoutSync.request<T>(session, path, init);
  } catch (error) {
    return transportError(error);
  }
}

/** Bounded live read; a confirmed deletion removes its device copy. */
export async function refreshOfflineWorkout(
  ownerId: string,
  runId: string,
  session: ApiSession,
  signal?: AbortSignal,
) {
  try {
    return await workoutSync.refresh(ownerId, runId, session, signal);
  } catch (error) {
    return transportError(error);
  }
}

/** Foreground, bounded retry. No background upload or automatic sharing permission. */
export async function syncOfflineWorkout(
  ownerId: string,
  runId: string,
  session: ApiSession,
  retry = false,
): Promise<void> {
  try {
    await workoutSync.sync(ownerId, runId, session, retry);
  } catch (error) {
    transportError(error);
  }
}
