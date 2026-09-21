/**
 * Light, dark, or whatever the phone is doing. The choice is pushed into the
 * platform (`Appearance.setColorScheme`), so React Native's own `useColorScheme` —
 * and native chrome like alerts and the keyboard — all follow it.
 */
import * as SecureStore from "expo-secure-store";
import { Appearance, Platform } from "react-native";

export type AppearancePref = "system" | "light" | "dark";
const KEY = "samepace.appearance";

export function applyAppearance(pref: AppearancePref) {
  if (Platform.OS === "web") return;
  Appearance.setColorScheme(pref === "system" ? "unspecified" : pref);
}

export async function loadAppearance(): Promise<AppearancePref> {
  const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
  const pref: AppearancePref = saved === "light" || saved === "dark" ? saved : "system";
  applyAppearance(pref);
  return pref;
}

export async function saveAppearance(pref: AppearancePref) {
  applyAppearance(pref);
  await SecureStore.setItemAsync(KEY, pref).catch(() => undefined);
}
