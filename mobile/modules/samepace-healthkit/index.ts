import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import type { HealthDataType, HealthPage } from "../../../shared/health";

export type HealthReadOptions = {
  type: HealthDataType;
  anchor: string | null;
  /** Keep this boundary unchanged for the lifetime of the connection. */
  sinceAt: string;
  limit?: number;
  zoneTypes?: ("heart_rate" | "cycling_power")[];
};

export type WatchMirrorSnapshot = {
  sessionId: string;
  state: "running" | "paused" | "stopped" | "ended";
  activity: "run" | "walk" | "ride" | "strength" | "other";
  startAt: string;
  elapsedSeconds: number;
  heartRateBpm: number | null;
  heartRateAt: string | null;
  distanceMeters: number | null;
  activeEnergyKilocalories: number | null;
  zoneIndex: number | null;
  zoneSource: "system" | "user" | "app" | null;
  receivedAt: string;
};
type HealthKitModule = {
  supportedTypes(): Promise<HealthDataType[]>;
  setObservation(types: HealthDataType[], enabled: boolean): Promise<void>;
  pendingChanges(): Promise<number>;
  acknowledgeChanges(revision: number): Promise<void>;
  addListener(event: "onHealthChange", listener: () => void): { remove(): void };
  addListener(
    event: "onWatchWorkout",
    listener: (event: { snapshot: WatchMirrorSnapshot | null }) => void,
  ): { remove(): void };
  setWatchVisible(visible: boolean): Promise<void>;
  watchSnapshot(): Promise<WatchMirrorSnapshot | null>;
  openWatch(activity: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  requestAuthorization(types: HealthDataType[]): Promise<void>;
  readChanges(options: HealthReadOptions): Promise<HealthPage>;
};

const native =
  Platform.OS === "ios" ? requireOptionalNativeModule<HealthKitModule>("SamePaceHealthKit") : null;

function unavailable(): never {
  throw new Error(
    "Apple Health requires an iOS development or production build with HealthKit enabled.",
  );
}

export async function isAvailable(): Promise<boolean> {
  return native ? native.isAvailable() : false;
}

/** Completion means the request finished, not that read access was granted. */
export async function requestAuthorization(types: HealthDataType[]): Promise<void> {
  if (!native) return unavailable();
  await native.requestAuthorization(types);
}

/** The caller persists the returned anchor only after the whole page is saved. */
export async function readChanges(options: HealthReadOptions): Promise<HealthPage> {
  if (!native) return unavailable();
  return native.readChanges(options);
}

export async function supportedTypes(): Promise<HealthDataType[]> {
  return native ? native.supportedTypes() : [];
}
export async function setObservation(types: HealthDataType[], enabled: boolean): Promise<void> {
  if (native) await native.setObservation(types, enabled);
}
export async function pendingChanges(): Promise<number> {
  return native ? native.pendingChanges() : 0;
}
export async function acknowledgeChanges(revision: number): Promise<void> {
  if (native) await native.acknowledgeChanges(revision);
}
export function observeChanges(listener: () => void): () => void {
  const subscription = native?.addListener("onHealthChange", listener);
  return () => subscription?.remove();
}

export default {
  isAvailable,
  supportedTypes,
  requestAuthorization,
  readChanges,
  setObservation,
  pendingChanges,
  acknowledgeChanges,
  observeChanges,
};

export async function openWatch(
  activity: "run" | "walk" | "ride" | "strength" = "run",
): Promise<void> {
  if (!native) return unavailable();
  await native.openWatch(activity);
}
export async function setWatchVisible(visible: boolean): Promise<void> {
  if (native) await native.setWatchVisible(visible);
}
export function observeWatch(listener: (snapshot: WatchMirrorSnapshot | null) => void): () => void {
  const subscription = native?.addListener("onWatchWorkout", ({ snapshot }) => listener(snapshot));
  return () => subscription?.remove();
}
