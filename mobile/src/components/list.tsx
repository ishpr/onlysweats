/**
 * Settings-style rows: one card, hairline dividers, a label on the left and the
 * current value or a chevron on the right. Dense where a stack of buttons is loud.
 */
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Children, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { PressScale } from "@/components/motion";
import { T } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type IconType = (props: { size?: number; color?: string; strokeWidth?: number }) => ReactNode;

export function ListCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
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
  value,
  valueTone = "muted",
  expanded,
  danger,
  onPress,
  accessibilityRole = "button",
  children,
}: {
  icon?: IconType;
  label: string;
  value?: string;
  valueTone?: "muted" | "accent";
  /** Set for rows that open in place: shows a down chevron while open. */
  expanded?: boolean;
  danger?: boolean;
  onPress: () => void;
  accessibilityRole?: "button" | "link";
  /** Shown under the row while `expanded`. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <View>
      <PressScale
        accessibilityRole={accessibilityRole}
        accessibilityLabel={value ? `${label}, ${value}` : label}
        accessibilityState={expanded === undefined ? undefined : { expanded }}
        onPress={onPress}
        feedback="select"
        scaleTo={0.99}
        style={styles.row}
      >
        {Icon && (
          <Icon size={18} color={danger ? theme.danger : theme.textSecondary} strokeWidth={1.75} />
        )}
        <T style={styles.label} color={danger ? "danger" : "text"}>
          {label}
        </T>
        {value ? (
          <T variant="caption" color={valueTone === "accent" ? "accent" : "textSecondary"}>
            {value}
          </T>
        ) : null}
        <Chevron size={16} color={theme.textFaint} />
      </PressScale>
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
  card: { borderRadius: Radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  row: {
    minHeight: HitTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  label: { flex: 1 },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  section: { marginTop: Spacing.two, marginBottom: -Spacing.one, marginLeft: Spacing.one },
});
