/**
 * SamePace design tokens. Two themes built from one set of names, so every screen
 * works in both without knowing which it's in.
 *
 * - **Dark** is the original: near-black, glass cards, the bright green and blue.
 * - **Light** is true white and flat, the way a good messaging app is: content sits
 *   straight on the page with hairlines, soft grey is kept for inputs and pills, and
 *   glass (blur) is reserved for what floats — the tab bar, headers, pinned actions.
 *   The accents are the deeper pair from the logo's light-surface set; the bright
 *   pair fails contrast on white. Text is near-black, never pure black.
 *
 * Contrast (WCAG): light text #0F1419 on #FFFFFF 18.9:1, secondary #536471 6.0:1,
 * faint #66737F 4.9:1, accent #0B7A2E 5.4:1. Dark: text 18.5:1, secondary 7.9:1,
 * faint 5.9:1, accent 10.6:1.
 */
import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  light: {
    background: "#FFFFFF",
    backgroundElement: "#F5F6F8",
    backgroundSelected: "#E8EAEE",
    /** Floating chrome over content: the tab bar, pinned footers. */
    glass: "rgba(255,255,255,0.78)",
    text: "#0F1419",
    textSecondary: "#536471",
    textFaint: "#66737F",
    border: "rgba(15,20,25,0.10)",
    accent: "#0B7A2E",
    onAccent: "#FFFFFF",
    accentSoft: "rgba(11,122,46,0.10)",
    move: "#C4123A",
    exercise: "#2F7A0B",
    stand: "#0B6A94",
    danger: "#B3261E",
    onDanger: "#FFFFFF",
  },
  dark: {
    background: "#050506",
    backgroundElement: "rgba(22,22,24,0.72)",
    backgroundSelected: "rgba(245,245,247,0.08)",
    glass: "rgba(5,5,6,0.62)",
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
