import { BlurView } from "expo-blur";
import * as SecureStore from "expo-secure-store";
import { Tabs, useRouter } from "expo-router";
import { House, MessageCircle, Plus, Search, UserRound } from "lucide-react-native";
import { useEffect, useState } from "react";
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
import { welcomeKey } from "@/app/welcome";
import { useSurfaces } from "@/hooks/use-surfaces";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";
import { tabBarHidden } from "@/lib/tab-bar-visibility";
import { Suspended } from "@/components/suspended";
import { useMe, useMine } from "@/lib/queries";

const TABS = {
  index: { label: "Home", icon: House },
  sessions: { label: "Find", icon: Search },
  inbox: { label: "Chats", icon: MessageCircle },
  you: { label: "You", icon: UserRound },
} as const;

export default function TabsLayout() {
  const me = useMe().data;
  const router = useRouter();
  useSurfaces();

  // First run: the promise is "at your level", so ask for it before the feed. Shown
  // once per member on this phone; "Set my level" on Home brings it back any time.
  const meId = me?.id;
  const needsLevel = me ? Object.keys(me.abilities).length === 0 && !me.suspended : false;
  useEffect(() => {
    if (!meId || !needsLevel) return;
    let alive = true;
    void SecureStore.getItemAsync(welcomeKey(meId))
      .catch(() => null)
      .then((seen) => {
        if (alive && !seen) router.push("/welcome");
      });
    return () => {
      alive = false;
    };
  }, [meId, needsLevel, router]);

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
  const scheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(0);
  // Slides out of the way while a long page scrolls down (see lib/tab-bar-visibility).
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: tabBarHidden.value * (barHeight + 8) }],
  }));
  // Requests I have to answer — never my own outgoing ones. They're listed on Home.
  const meId = useMe().data?.id;
  const waiting =
    useMine().data?.bookings.filter((b) => b.status === "pending" && b.hostId === meId).length ?? 0;

  return (
    <Animated.View
      style={[styles.barWrap, slide]}
      onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
    >
      <Bar
        intensity={50}
        tint={scheme}
        style={[
          styles.bar,
          {
            // The full safe-area inset (34 pt on a Face ID iPhone) leaves a dead band under
            // the labels. The home indicator only occupies the lowest ~13 pt, so tuck the
            // bar down to just clear it; the 48 pt targets stay fully above the indicator.
            paddingBottom: Math.max(Spacing.one, insets.bottom - 18),
            backgroundColor: Platform.OS === "ios" ? theme.glass : theme.background,
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
              accessibilityLabel={
                route.name === "index" && waiting > 0
                  ? `${tab.label}, ${waiting} waiting on you`
                  : tab.label
              }
              accessibilityState={{ selected: active }}
              style={styles.item}
              onPress={() => {
                const e = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                tabBarHidden.value = 0;
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
                {route.name === "index" && waiting > 0 && (
                  <View style={[styles.dot, { backgroundColor: theme.move }]}>
                    <T style={[styles.dotText, { color: theme.onDanger }]}>{waiting}</T>
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
          <View style={[styles.post, { backgroundColor: theme.primary }]}>
            <Plus size={16} color={theme.onPrimary} strokeWidth={2.5} />
          </View>
          <T style={[styles.label, { color: theme.accent }]}>Post</T>
        </Pressable>
      </Bar>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  barWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
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
  dotText: { fontFamily: Fonts.medium, fontSize: 10, lineHeight: 14 },
});
