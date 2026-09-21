import { createContext, createElement, type ReactNode, use } from "react";

import { Colors, type Theme } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

const Forced = createContext<"light" | "dark" | null>(null);

export function useTheme(): Theme {
  const forced = use(Forced);
  const scheme = useColorScheme();
  return Colors[forced ?? scheme];
}

/**
 * Anything laid over a photograph — session cards, the "next up" hero, place tiles —
 * keeps the dark treatment in both themes: a dark scrim and light type is what stays
 * legible on a picture of a trail at dusk. Wrap it, and everything inside reads the
 * dark tokens.
 */
export function OnPhoto({ children }: { children: ReactNode }) {
  return createElement(Forced, { value: "dark" }, children);
}

/** Everything inside reads one theme's tokens, whatever the app is set to. */
export function ForceTheme({
  scheme,
  children,
}: {
  scheme: "light" | "dark";
  children: ReactNode;
}) {
  return createElement(Forced, { value: scheme }, children);
}
