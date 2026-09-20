/**
 * Pace is dark-only, like the web app. `userInterfaceStyle: "dark"` in app.json
 * pins production builds, but Expo Go on Android ignores it — so the scheme is
 * pinned here too. To follow the system later, re-export `useColorScheme` from
 * 'react-native'; the light tokens in `constants/theme.ts` are already checked.
 */
export function useColorScheme(): "light" | "dark" {
  return "dark";
}
