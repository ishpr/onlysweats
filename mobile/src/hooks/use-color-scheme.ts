import { useColorScheme as useSystemScheme } from "react-native";

/**
 * The scheme in force: the member's choice under You → Appearance, or the phone's
 * when they've left it on System (`lib/appearance.ts` pushes the choice into the
 * platform, so alerts, the keyboard and the share sheet follow it too). Dark is the
 * fallback when the platform can't say.
 */
export function useColorScheme(): "light" | "dark" {
  return useSystemScheme() === "light" ? "light" : "dark";
}
