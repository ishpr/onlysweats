/**
 * Pace design tokens — the same values as the web app's `@theme` block in
 * `src/styles.css`, so both clients read as one product. The web is dark-only,
 * so the app is pinned dark too (`userInterfaceStyle` in app.json); the light
 * map is kept contrast-checked for when that changes. Never pure black or white.
 */
import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  light: {
    background: "#F6F6F8",
    backgroundElement: "#FFFFFE",
    backgroundSelected: "#E6E6EB",
    text: "#111113",
    textSecondary: "#55555C",
    textFaint: "#6B6B73",
    border: "rgba(17,17,19,0.10)",
    accent: "#0B7A2E",
    onAccent: "#FBFFFC",
    accentSoft: "rgba(11,122,46,0.12)",
    move: "#C4123A",
    exercise: "#2F7A0B",
    stand: "#0B6A94",
    danger: "#B3261E",
    onDanger: "#FFFBFA",
  },
  dark: {
    background: "#050506",
    backgroundElement: "rgba(22,22,24,0.72)",
    backgroundSelected: "rgba(245,245,247,0.08)",
    text: "#F5F5F7",
    textSecondary: "#A1A1A6",
    textFaint: "#8A8A90",
    border: "rgba(255,255,255,0.10)",
    accent: "#30D158",
    onAccent: "#04210C",
    accentSoft: "rgba(48,209,88,0.16)",
    move: "#FA2D55",
    exercise: "#7BF542",
    stand: "#64D2FF",
    danger: "#FF453A",
    onDanger: "#1A0503",
  },
} as const;

export type Theme = { [K in keyof typeof Colors.dark]: string };
export type ThemeColor = keyof Theme;

/** Outfit, as on the web. RN needs one family name per weight. */
export const Fonts = {
  regular: "Outfit_400Regular",
  medium: "Outfit_500Medium",
  semibold: "Outfit_600SemiBold",
  bold: "Outfit_700Bold",
  mono: Platform.select({ ios: "ui-monospace", default: "monospace" }),
} as const;

/** 8pt grid (with a 4pt half-step). */
export const Spacing = {
  half: 4,
  one: 8,
  two: 12,
  three: 16,
  four: 24,
  five: 32,
  six: 48,
} as const;
export const Radius = { sm: 8, md: 14, lg: 22, xl: 28, xxl: 32, pill: 999 } as const;

/** Minimum touch target (WCAG 2.5.5 / HIG). */
export const HitTarget = 44;
export const MaxContentWidth = 640;
