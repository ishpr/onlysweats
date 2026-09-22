/**
 * Settings-style rows: one card, hairline dividers, a label on the left and the
 * current value or a chevron on the right. Dense where a stack of buttons is loud.
 */
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Children, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { PressScale } from "@/components/motion";
import { glassSurface, T } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

type IconType = (props: { size?: number; color?: string; strokeWidth?: number }) => ReactNode;

export function ListCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const light = useColorScheme() === "light";
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, glassSurface(theme, light)]}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: theme.border }]} />}
          {row}
        </View>
      ))}
    </View>
  );
}

export function ListRow({
  icon: Icon,
  label,
  detail,
  value,
  valueTone = "muted",
  expanded,
  danger,
  onPress,
  accessibilityRole = "button",
  trailing,
  children,
}: {
  icon?: IconType;
  label: string;
  /** A second line under the label — for when the value is a sentence, not a word. */
  detail?: string;
  value?: string;
  valueTone?: "muted" | "accent";
  /** Set for rows that open in place: shows a down chevron while open. */
  expanded?: boolean;
  danger?: boolean;
  onPress: () => void;
  accessibilityRole?: "button" | "link";
  /** Beside the row, outside its press area — an overflow menu. Replaces the chevron. */
  trailing?: ReactNode;
  /** Shown under the row while `expanded`. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <View>
      <View style={trailing ? styles.withTrailing : undefined}>
        <PressScale
          accessibilityRole={accessibilityRole}
          accessibilityLabel={[label, detail, value].filter(Boolean).join(", ")}
          accessibilityState={expanded === undefined ? undefined : { expanded }}
          onPress={onPress}
          feedback="select"
          scaleTo={0.99}
          style={[styles.row, trailing ? styles.rowBesideTrailing : null]}
        >
          {Icon && (
            <Icon
              size={18}
              color={danger ? theme.danger : theme.textSecondary}
              strokeWidth={1.75}
            />
          )}
          <View style={styles.label}>
            <T color={danger ? "danger" : "text"} numberOfLines={1}>
              {label}
            </T>
            {detail ? (
              <T variant="caption" color="textSecondary" numberOfLines={1}>
                {detail}
              </T>
            ) : null}
          </View>
          {value ? (
            <T variant="caption" color={valueTone === "accent" ? "accent" : "textSecondary"}>
              {value}
            </T>
          ) : null}
          {trailing ? null : <Chevron size={16} color={theme.textFaint} />}
        </PressScale>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {expanded && children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <T variant="eyebrow" color="textFaint" style={styles.section}>
      {children}
    </T>
  );
}

const styles = StyleSheet.create({
  withTrailing: { flexDirection: "row", alignItems: "center" },
  rowBesideTrailing: { flex: 1, paddingRight: Spacing.one },
  trailing: { paddingRight: Spacing.two },
  card: { borderRadius: Radius.xl, borderWidth: StyleSheet.hairlineWidth },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  row: {
    minHeight: HitTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  label: { flex: 1, paddingVertical: Spacing.two },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  section: { marginTop: Spacing.two, marginBottom: -Spacing.one, marginLeft: Spacing.one },
});
