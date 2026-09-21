import Constants from "expo-constants";

// 8080 is the repo default (`npm run dev`). A machine where that port is taken sets
// `EXPO_PUBLIC_API_PORT` in the gitignored `mobile/.env.local` instead of editing this.
const API_PORT = Number(process.env.EXPO_PUBLIC_API_PORT) || 8080;

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
  process.env.EXPO_PUBLIC_SITE_URL?.trim() || "https://samepace.app"
).replace(/\/+$/, "");
