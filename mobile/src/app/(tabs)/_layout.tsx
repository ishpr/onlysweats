import { BlurView } from "expo-blur";
import { Tabs, useRouter } from "expo-router";
import { CalendarDays, MapPinned, MessageCircle, Plus, UserRound } from "lucide-react-native";
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T, withAlpha } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { useSurfaces } from "@/hooks/use-surfaces";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";
import { Suspended } from "@/components/suspended";
import { useMe, useMine } from "@/lib/queries";

const TABS = {
  index: { label: "Today", icon: CalendarDays },
  sessions: { label: "Sessions", icon: MapPinned },
  inbox: { label: "Inbox", icon: MessageCircle },
  you: { label: "You", icon: UserRound },
} as const;

export default function TabsLayout() {
  const me = useMe().data;
  useSurfaces();
  // A paused account can read why and delete itself. Nothing else loads.
  if (me?.suspended) return <Suspended reason={me.suspended.reason} />;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="sessions" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}

/** The icon dips and springs back when its tab becomes active. */
function TabIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!active || reduced) return;
    scale.value = withSequence(
      withTiming(0.82, { duration: 90 }),
      withSpring(1, { damping: 9, stiffness: 260 }),
    );
  }, [active, reduced, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// Android has no live blur behind a view (BlurView only tints), so content would
// read through the bar — use a plain, near-opaque View there.
const Bar = Platform.OS === "ios" ? BlurView : (View as unknown as typeof BlurView);

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** The web's frosted bottom bar: four tabs, then the white Post button. */
function TabBar({ state, navigation }: TabBarProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const waiting = useMine().data?.bookings.filter((b) => b.status === "pending").length ?? 0;

  return (
    <Bar
      intensity={50}
      tint="dark"
      style={[
        styles.bar,
        {
          // The full safe-area inset (34 pt on a Face ID iPhone) leaves a dead band under
          // the labels. The home indicator only occupies the lowest ~13 pt, so tuck the
          // bar down to just clear it; the 48 pt targets stay fully above the indicator.
          paddingBottom: Math.max(Spacing.one, insets.bottom - 18),
          backgroundColor: withAlpha(theme.background, Platform.OS === "ios" ? 0.62 : 0.96),
          borderTopColor: withAlpha(theme.text, 0.12),
        },
      ]}
    >
      {state.routes.map((route, i) => {
        const tab = TABS[route.name as keyof typeof TABS];
        if (!tab) return null;
        const active = state.index === i;
        const color = active ? theme.text : theme.textFaint;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            style={styles.item}
            onPress={() => {
              const e = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!active && !e.defaultPrevented) {
                haptic.select();
                navigation.navigate(route.name);
              }
            }}
          >
            <View>
              <TabIcon active={active}>
                <tab.icon size={20} color={color} />
              </TabIcon>
              {route.name === "inbox" && waiting > 0 && (
                <View style={[styles.dot, { backgroundColor: theme.move }]}>
                  <T style={styles.dotText}>{waiting}</T>
                </View>
              )}
            </View>
            <T style={[styles.label, { color }]}>{tab.label}</T>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post a session"
        style={styles.item}
        onPress={() => {
          haptic.tap();
          router.push("/post");
        }}
      >
        <View style={[styles.post, { backgroundColor: theme.text }]}>
          <Plus size={16} color={theme.background} strokeWidth={2.5} />
        </View>
        <T style={[styles.label, { color: theme.accent }]}>Post</T>
      </Pressable>
    </Bar>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    paddingTop: Spacing.one,
    paddingHorizontal: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flex: 1,
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: { fontFamily: Fonts.medium, fontSize: 10, lineHeight: 14 },
  post: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: -6,
    right: -12,
    minWidth: 16,
    height: 16,
    borderRadius: Radius.pill,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  dotText: { fontFamily: Fonts.medium, fontSize: 10, lineHeight: 14, color: "#FFF7F9" },
});
