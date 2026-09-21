/**
 * A workout plan, or one time you followed it, as a row you can read at a glance:
 * what it is, how big it is, and — for a workout — how far you got. The whole row
 * opens it; there is no separate button to find.
 */
import { ChevronRight, ClipboardList, type LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { PressScale } from "@/components/motion";
import { Card, T, withAlpha } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function PlanRow({
  icon: Icon = ClipboardList,
  title,
  facts,
  caption,
  progress,
  actionLabel,
  onPress,
}: {
  icon?: LucideIcon;
  title: string;
  /** Short chips: "6 exercises", "18 sets". */
  facts: string[];
  caption: string;
  /** 0–1 of planned sets recorded. Omit for a template. */
  progress?: number;
  /** What opening it does, for VoiceOver: "Open workout plan". */
  actionLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${facts.join(", ")}. ${caption}. ${actionLabel}`}
      onPress={onPress}
      scaleTo={0.98}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
            <Icon size={20} color={theme.accent} />
          </View>
          <View style={styles.flex}>
            <T variant="label" numberOfLines={2}>
              {title}
            </T>
            <T variant="caption" color="textSecondary" numberOfLines={1}>
              {caption}
            </T>
          </View>
          <ChevronRight size={18} color={theme.textFaint} />
        </View>
        <View style={styles.facts}>
          {facts.map((fact) => (
            <View
              key={fact}
              style={[styles.fact, { backgroundColor: theme.chip, borderColor: theme.border }]}
            >
              <T variant="caption">{fact}</T>
            </View>
          ))}
        </View>
        {progress !== undefined && (
          <View style={[styles.track, { backgroundColor: withAlpha(theme.accent, 0.14) }]}>
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: theme.accent,
                  width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
                },
              ]}
            />
          </View>
        )}
      </Card>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: Spacing.two },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fact: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});
