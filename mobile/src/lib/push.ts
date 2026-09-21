/**
 * Push notifications. The server decides what to send; this registers the device,
 * and opens the right screen when a notification is tapped.
 *
 * `expo-notifications` is a native module: it isn't in Expo Go, nor in a
 * development build made before it was added. It is loaded lazily, and when it's
 * missing everything here reports "unavailable" instead of throwing.
 */
import { requireOptionalNativeModule } from "expo";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { captureApiSession, captureLogoutCleanup } from "./api";
import { createPushRegistration, type PushStatus } from "./push-registration";
import { createPushDeviceLifecycle } from "./push-device-lifecycle";

type Notifications = typeof import("expo-notifications");

const TOKEN_KEY = "samepace.push-token";
let cached: Notifications | null | undefined;

function load(): Notifications | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return cached;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return cached;
  // Ask before loading: a failed `require` is fatal in development (see widgets.ts).
  if (!requireOptionalNativeModule("ExpoPushTokenManager")) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    const mod = require("expo-notifications") as Notifications;
    // Show a banner while the app is open too — a join or a message is worth seeing.
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

export async function pushStatus(): Promise<PushStatus> {
  const n = load();
  // Simulators and emulators can't get a push token.
  if (!n || !Device.isDevice) return "unavailable";
  const { status, canAskAgain } = await n.getPermissionsAsync();
  if (status === "granted") return "granted";
  return status === "denied" && !canAskAgain ? "denied" : "undetermined";
}

async function deviceToken(n: Notifications): Promise<string> {
  if (Platform.OS === "android") {
    // One channel per kind, so Android's own settings can mute them separately.
    const channels = [
      ["sessions", "Sessions", n.AndroidImportance.HIGH],
      ["messages", "Messages", n.AndroidImportance.HIGH],
      ["reminders", "Reminders", n.AndroidImportance.DEFAULT],
      ["substitutes", "Fill-in spots at your level", n.AndroidImportance.DEFAULT],
      ["account", "Fees, strikes and your account", n.AndroidImportance.HIGH],
      ["default", "Other", n.AndroidImportance.DEFAULT],
    ] as const;
    for (const [id, name, importance] of channels) {
      await n.setNotificationChannelAsync(id, { name, importance });
    }
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!projectId)
    throw new Error(
      "Push notifications aren’t configured in this build. Update the app and try again.",
    );
  const { data: token } = await n.getExpoPushTokenAsync({ projectId });
  return token;
}

const deviceLifecycle = createPushDeviceLifecycle({
  capture: captureApiSession,
  readToken: () => SecureStore.getItemAsync(TOKEN_KEY),
  writeToken: (token) => SecureStore.setItemAsync(TOKEN_KEY, token),
  clearToken: () => SecureStore.deleteItemAsync(TOKEN_KEY),
});

const registration = createPushRegistration({
  permission: async (request) => {
    const n = load();
    if (!n || !Device.isDevice) return "unavailable";
    if (request) await n.requestPermissionsAsync();
    return pushStatus();
  },
  register: async () => {
    const n = load();
    if (!n) throw new Error("Notifications aren’t available in this build.");
    await deviceLifecycle.register(() => deviceToken(n), Platform.OS === "ios" ? "ios" : "android");
  },
});

export const getPushState = registration.getSnapshot;
export const subscribePush = registration.subscribe;

/** Ask (the system prompt appears once) and register this device. */
export const enablePush = () => registration.sync(true);

/** Launch, foreground or retry: keep the token fresh without prompting. */
export const syncPush = () => registration.sync();

/** Synchronous fence at every auth boundary; no native lookup can adopt a new login. */
export function fencePushRegistration(): void {
  deviceLifecycle.fence();
  registration.reset();
}

/** Capture cleanup before local logout; remote work always uses the caller's old bearer. */
export function capturePushLogout(
  unregisterDevice: (token: string) => Promise<void>,
): Promise<void> {
  registration.reset();
  return deviceLifecycle.logout(unregisterDevice);
}

/** Compatibility entry point for callers that have not dropped their session yet. */
export function unregisterPush(): Promise<void> {
  const cleanup = captureLogoutCleanup();
  return capturePushLogout(cleanup.unregisterDevice);
}

/** The in-app route a notification carries. Only our own paths are ever opened. */
function routeOf(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  return typeof url === "string" && /^\/[a-z]/.test(url) && !url.startsWith("//") ? url : null;
}

/** Calls `open` for a tapped notification, including the one that launched the app. */
export function onNotificationOpened(open: (route: string) => void): () => void {
  const n = load();
  if (!n) return () => undefined;
  let last: string | null = null;
  const handle = (response: import("expo-notifications").NotificationResponse | null) => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (id === last) return;
    last = id;
    const route = routeOf(response.notification.request.content.data);
    if (route) open(route);
  };
  void n
    .getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => undefined);
  const sub = n.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

/** The app icon's badge follows the unread count in Activity. */
export function setBadge(count: number) {
  const n = load();
  if (n) void n.setBadgeCountAsync(Math.max(0, count)).catch(() => undefined);
}
