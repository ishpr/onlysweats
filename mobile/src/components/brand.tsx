import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** The three-ring SamePace mark — same geometry as the web's `PaceMark`. */
export function PaceMark({ size = 28 }: { size?: number }) {
  const theme = useTheme();
  const ring = (r: number, color: string, width: number, dash: string) => (
    <Circle
      cx={16}
      cy={16}
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={dash}
      rotation={-90}
      origin="16, 16"
    />
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessible={false}>
      {ring(13, theme.move, 2.6, "62 20")}
      {ring(9.2, theme.exercise, 2.6, "42 16")}
      {ring(5.4, theme.stand, 2.4, "24 10")}
    </Svg>
  );
}

export function AppHeader() {
  return (
    <View style={styles.header} accessibilityRole="header">
      <PaceMark />
      <T style={styles.wordmark}>SamePace</T>
    </View>
  );
}

/** Full-width move-pink bar shown while one of my seats is inside its window. */
export function LiveBanner({ bookingId }: { bookingId: string }) {
  const theme = useTheme();
  return (
    <Link href={{ pathname: "/live/[id]", params: { id: bookingId } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check-in is open. Open live session."
      >
        {({ pressed }) => (
          <View
            style={[styles.banner, { backgroundColor: theme.move, opacity: pressed ? 0.85 : 1 }]}
          >
            <T variant="label" style={styles.onMove}>
              Check-in is open
            </T>
            <T variant="label" style={[styles.onMove, styles.dim]}>
              Live session
            </T>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.one,
  },
  wordmark: { fontSize: 17, lineHeight: 22, letterSpacing: -0.3, fontFamily: "Outfit_600SemiBold" },
  banner: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.one,
    minHeight: 48,
    borderRadius: Radius.md + 2,
    paddingHorizontal: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  // White on move-pink is 3.9:1 — large/medium-weight UI text, passes 3:1.
  onMove: { color: "#FFF7F9" },
  dim: { opacity: 0.85 },
});
