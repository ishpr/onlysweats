/**
 * Push notifications. The server decides what to send; this registers the device,
 * and opens the right screen when a notification is tapped.
 *
 * `expo-notifications` is a native module: it isn't in Expo Go, nor in a
 * development build made before it was added. It is loaded lazily, and when it's
 * missing everything here reports "unavailable" instead of throwing.
 */
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { api } from "./api";

type Notifications = typeof import("expo-notifications");
export type PushStatus = "granted" | "denied" | "undetermined" | "unavailable";

const TOKEN_KEY = "samepace.push-token";
let cached: Notifications | null | undefined;

function load(): Notifications | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return cached;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return cached;
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

async function register(n: Notifications): Promise<boolean> {
  if (Platform.OS === "android") {
    // One channel per kind, so Android's own settings can mute them separately.
    const channels = [
      ["sessions", "Sessions", n.AndroidImportance.HIGH],
      ["messages", "Messages", n.AndroidImportance.HIGH],
      ["reminders", "Reminders", n.AndroidImportance.DEFAULT],
      ["substitutes", "Open seats at your level", n.AndroidImportance.DEFAULT],
      ["account", "Fees, strikes and your account", n.AndroidImportance.HIGH],
      ["default", "Other", n.AndroidImportance.DEFAULT],
    ] as const;
    for (const [id, name, importance] of channels) {
      await n.setNotificationChannelAsync(id, { name, importance });
    }
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (!projectId) return false;
  const { data: token } = await n.getExpoPushTokenAsync({ projectId });
  await api("/devices", {
    method: "POST",
    json: { token, platform: Platform.OS === "ios" ? "ios" : "android" },
  });
  await SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => undefined);
  return true;
}

/** Ask (the system prompt appears once) and register this device. */
export async function enablePush(): Promise<PushStatus> {
  const n = load();
  if (!n || !Device.isDevice) return "unavailable";
  const { status } = await n.requestPermissionsAsync();
  if (status !== "granted") return pushStatus();
  await register(n);
  return "granted";
}

/** On launch: if permission was already given, keep the server's token fresh. Never prompts. */
export async function syncPush(): Promise<void> {
  const n = load();
  if (!n || !Device.isDevice) return;
  try {
    if ((await n.getPermissionsAsync()).status === "granted") await register(n);
  } catch {
    /* offline, or the push service is unreachable — the next launch retries */
  }
}

/** Before signing out: this phone stops getting that member's notifications. */
export async function unregisterPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await api(`/devices/${encodeURIComponent(token)}`, { method: "DELETE" }).catch(() => undefined);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
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
