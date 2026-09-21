import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { T } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

const STROKE = 10;

/** Sessions kept out of sessions planned, as one ring. The numbers sit inside it. */
export function ProgressRing({
  kept,
  planned,
  size = 112,
}: {
  kept: number;
  planned: number;
  size?: number;
}) {
  const theme = useTheme();
  const r = (size - STROKE) / 2;
  const around = 2 * Math.PI * r;
  const share = planned > 0 ? Math.min(kept / planned, 1) : 0;
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${kept} of ${planned} sessions kept`}
      accessibilityValue={{ min: 0, max: planned, now: kept }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.backgroundSelected}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.accent}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${around * share} ${around}`}
          fill="none"
          // Start at twelve o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View
        style={[StyleSheet.absoluteFill, styles.center]}
        importantForAccessibility="no-hide-descendants"
      >
        <T variant="heading">{kept}</T>
        <T variant="caption" color="textSecondary">
          of {planned}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
