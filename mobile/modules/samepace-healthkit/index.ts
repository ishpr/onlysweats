import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { HealthDataType, HealthPage } from '../../../shared/health';

export type HealthReadOptions = {
  type: HealthDataType;
  anchor: string | null;
  /** Keep this boundary unchanged for the lifetime of the connection. */
  sinceAt: string;
  limit?: number;
};

type HealthKitModule = {
  isAvailable(): Promise<boolean>;
  requestAuthorization(types: HealthDataType[]): Promise<void>;
  readChanges(options: HealthReadOptions): Promise<HealthPage>;
};

const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<HealthKitModule>('SamePaceHealthKit')
  : null;

function unavailable(): never {
  throw new Error('Apple Health requires an iOS development or production build with HealthKit enabled.');
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

export default { isAvailable, requestAuthorization, readChanges };
