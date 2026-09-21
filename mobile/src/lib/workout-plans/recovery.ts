import * as SecureStore from "expo-secure-store";
import { createWorkoutRecoveryStore } from "./recovery-store";

const KEY = "samepace.workout.pending.v1";
const store = createWorkoutRecoveryStore({
  available: () => SecureStore.isAvailableAsync(),
  read: () => SecureStore.getItemAsync(KEY),
  write: (value) =>
    SecureStore.setItemAsync(KEY, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: () => SecureStore.deleteItemAsync(KEY),
});

/** One encrypted, expiring pending form; no raw sensor samples or saved workout history. */
export const saveWorkoutRecovery = store.save;
export const loadWorkoutRecovery = store.load;
/** Clearing an account fences pending writes immediately, before keychain IO finishes. */
export const clearWorkoutRecovery = store.clear;
