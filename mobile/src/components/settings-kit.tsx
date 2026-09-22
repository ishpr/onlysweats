/**
 * The two pieces Settings is built from beyond the list kit: a row with a switch, and a
 * status-first hero (Verification, Membership, Apple Health, Notifications open on their
 * state, not on a form).
 */
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, Switch, View } from "react-native";

import { PressScale } from "@/components/motion";
import { Card, T, withAlpha } from "@/components/ui";
import { HitTarget, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function SettingRow({
  label,
  detail,
  value,
  onValueChange,
  disabled,
  onAbout,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** "What this means" — opens a sheet with the plain-words explanation. */
  onAbout?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <T>{label}</T>
        {detail ? (
          <T variant="caption" color="textSecondary">
            {detail}
          </T>
        ) : null}
        {onAbout ? (
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={`What ${label} means`}
            onPress={onAbout}
            style={styles.about}
          >
            <T variant="caption" color="accent">
              What this means
            </T>
          </PressScale>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
        ios_backgroundColor={theme.backgroundSelected}
      />
    </View>
  );
}

export type HeroTone = "quiet" | "good" | "working" | "attention";

/** The top of a status-first page: how things stand, in one glance. */
export function StatusHero({
  icon: Icon,
  tone = "quiet",
  eyebrow,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  tone?: HeroTone;
  eyebrow?: string;
  title: string;
  detail?: string;
  /** Tiles or a small row under the words. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const color =
    tone === "good"
      ? theme.accent
      : tone === "working"
        ? theme.stand
        : tone === "attention"
          ? theme.danger
          : theme.textSecondary;
  return (
    <Card>
      <View style={styles.hero}>
        <View style={[styles.badge, { backgroundColor: withAlpha(color, 0.14) }]}>
          <Icon size={26} color={color} />
        </View>
        <View style={styles.flex}>
          {eyebrow ? (
            <T variant="eyebrow" style={{ color }}>
              {eyebrow}
            </T>
          ) : null}
          <T variant="heading">{title}</T>
          {detail ? (
            <T variant="caption" color="textSecondary">
              {detail}
            </T>
          ) : null}
        </View>
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    minHeight: HitTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  about: { minHeight: 32, justifyContent: "center", alignSelf: "flex-start" },
  hero: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
