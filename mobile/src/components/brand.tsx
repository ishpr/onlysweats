import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Rect } from "react-native-svg";

import { T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** The SamePace mark: two people leaning in step. Geometry from brand/build.py. */
export function PaceMark({ size = 28 }: { size?: number }) {
  const theme = useTheme();
  const person = (cx: number, color: string) => (
    <G rotation={14} origin={`${cx}, 49.5`} fill={color}>
      <Circle cx={cx} cy={27} r={9} />
      <Rect x={cx - 7.5} y={41} width={15} height={40} rx={7.5} />
    </G>
  );
  return (
    <Svg width={size} height={size} viewBox="12 12 76 76" accessible={false}>
      {person(34.5, theme.accent)}
      {person(64.5, theme.stand)}
    </Svg>
  );
}

export function AppHeader() {
  return (
    <View style={styles.header} accessibilityRole="header">
      <PaceMark />
      <T style={styles.wordmark} accessibilityLabel="SamePace">
        same
        <T style={styles.wordmark} color="accent">
          pace
        </T>
      </T>
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
