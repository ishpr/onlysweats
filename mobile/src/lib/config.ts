import Constants from "expo-constants";

const API_PORT = 8088;

/**
 * Where the Pace API lives. Set `EXPO_PUBLIC_API_URL` for staging/production.
 * In development we reuse the host Metro is served from (the dev machine's LAN
 * address), so simulators, emulators and real phones all reach the same server —
 * `localhost` would point an Android emulator at itself.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host || "localhost"}:${API_PORT}`;
}

export const API_URL = resolveApiUrl();

/** The public site. Invite links point here; its page hands the code to the app. */
export const SITE_URL = (
  process.env.EXPO_PUBLIC_SITE_URL?.trim() || "https://samepace.vercel.app"
).replace(/\/+$/, "");
