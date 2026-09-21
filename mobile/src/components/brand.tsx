import { Link, useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Rect } from "react-native-svg";

import { PressScale } from "@/components/motion";
import { T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useNotifications } from "@/lib/queries";

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

/** Mark + lowercase wordmark, stacked — for the screens before there's a header. */
export function Lockup() {
  return (
    <View style={styles.lockup} accessibilityRole="header">
      <PaceMark size={56} />
      <T maxFontSizeMultiplier={1.15} style={styles.lockupWord} accessibilityLabel="SamePace">
        same
        <T maxFontSizeMultiplier={1.15} style={styles.lockupWord} color="accent">
          pace
        </T>
      </T>
    </View>
  );
}

export function AppHeader() {
  const router = useRouter();
  const theme = useTheme();
  const unread = useNotifications().data?.unread ?? 0;
  return (
    <View style={styles.header} accessibilityRole="header">
      <PaceMark size={32} />
      <T
        maxFontSizeMultiplier={1.15}
        style={[styles.wordmark, styles.headerWord]}
        accessibilityLabel="SamePace"
      >
        same
        <T maxFontSizeMultiplier={1.15} style={styles.wordmark} color="accent">
          pace
        </T>
      </T>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
        onPress={() => router.push("/activity")}
        style={styles.bell}
        hitSlop={6}
      >
        <Bell size={20} color={theme.text} strokeWidth={1.75} />
        {unread > 0 && <View style={[styles.bellDot, { backgroundColor: theme.move }]} />}
      </PressScale>
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
            <T variant="label" style={{ color: theme.onDanger }}>
              Check-in is open
            </T>
            <T variant="label" style={[{ color: theme.onDanger }, styles.dim]}>
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
  lockup: { alignItems: "flex-start", gap: Spacing.one },
  lockupWord: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.6,
    fontFamily: "Outfit_600SemiBold",
  },
  headerWord: { flex: 1 },
  bell: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", top: 11, right: 11, width: 8, height: 8, borderRadius: 4 },
  wordmark: { fontSize: 21, lineHeight: 26, letterSpacing: -0.4, fontFamily: "Outfit_600SemiBold" },
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
  dim: { opacity: 0.85 },
});
