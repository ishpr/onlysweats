/**
 * A bottom sheet: the app's way of answering one tap with one thing — a control's
 * choices, a confirmation, the detail behind a row — without leaving the screen or
 * stacking another card onto it.
 *
 * It rises on a spring and is only as tall as what it holds. When there is more than
 * half a screen of content it rests at half: pull the handle up and it fills the screen,
 * pull down and it settles back to half. Pull down again (or tap outside, or Close) and
 * it leaves. Frosted glass over a dimmed page, in both themes.
 */
import { BlurView } from "expo-blur";
import { X } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T, withAlpha } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  startFull = false,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the content: the sheet's one primary action. */
  footer?: ReactNode;
  /** Open straight to full height (long content, a form). */
  startFull?: boolean;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reduced = useReducedMotion();

  // The panel is always full height; `y` slides it down. 0 = full, `half`, `closed`.
  const full = window.height - insets.top - Spacing.one;
  const closed = full;
  // Measured, so a short sheet hugs its content and has no full-screen stop to offer.
  const [headH, setHeadH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [footH, setFootH] = useState(0);
  const needed = headH + contentH + footH;
  const halfVisible = Math.round(window.height * 0.56);
  const canFill = needed > halfVisible;
  const half = Math.round(full - (canFill || needed === 0 ? halfVisible : needed));
  const y = useSharedValue(closed);
  const start = useSharedValue(closed);
  // Stay mounted through the closing slide.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const settle = (to: number, done?: () => void) => {
    "worklet";
    const finish = (finished?: boolean) => {
      "worklet";
      if (finished && done) runOnJS(done)();
    };
    y.set(reduced ? withTiming(to, { duration: 0 }, finish) : withSpring(to, SPRING, finish));
  };
  const unmount = () => setMounted(false);

  useEffect(() => {
    if (visible) {
      settle(startFull && canFill ? 0 : half);
    } else {
      settle(closed, unmount);
    }
    // `settle` is a fresh worklet each render; the values it reads are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, startFull, canFill, half, closed]);

  const notch = () => haptic.select();
  const drag = Gesture.Pan()
    .onBegin(() => {
      start.set(y.get());
    })
    .onUpdate((e) => {
      // A little give past full height, none past closed.
      // A little give upward; a short sheet only rubber-bands, it has nowhere higher to go.
      const top = canFill ? -24 : half - 24;
      y.set(Math.max(top, Math.min(closed, start.get() + e.translationY)));
    })
    .onEnd((e) => {
      const flung = Math.abs(e.velocityY) > 900;
      const down = e.velocityY > 0;
      const from = start.get() < half / 2 ? 0 : half;
      let to: number;
      if (flung) to = down ? (from === 0 ? half : closed) : canFill ? 0 : half;
      else if (canFill && y.get() < half / 2) to = 0;
      else if (y.get() < half + (closed - half) * 0.4) to = half;
      else to = closed;
      if (to === closed) {
        settle(closed);
        runOnJS(onClose)();
      } else {
        if (to !== from) runOnJS(notch)();
        settle(to);
      }
    });

  const backdrop = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, half, closed], [1, 0.7, 0], Extrapolation.CLAMP),
  }));
  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    // Square off as it meets the top of the screen.
    borderTopLeftRadius: interpolate(
      y.value,
      [0, half],
      [Radius.lg, Radius.xxl],
      Extrapolation.CLAMP,
    ),
    borderTopRightRadius: interpolate(
      y.value,
      [0, half],
      [Radius.lg, Radius.xxl],
      Extrapolation.CLAMP,
    ),
  }));
  // At half height the content's visible part ends where the screen does.
  const body = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, y.value) }));

  if (!mounted) return null;
  const ios = Platform.OS === "ios";
  const Glass = ios ? BlurView : View;
  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, backdrop]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.panel, { height: full, borderColor: theme.glassEdge }, panel]}
        >
          <Glass
            {...(ios ? { intensity: 70, tint: scheme } : null)}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: ios ? withAlpha(theme.background, 0.78) : theme.background },
            ]}
          />
          <GestureDetector gesture={drag}>
            <View style={styles.head} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
              <View style={[styles.handle, { backgroundColor: withAlpha(theme.text, 0.24) }]} />
              <View style={styles.titleRow}>
                <View style={styles.flex}>
                  <T variant="heading" accessibilityRole="header">
                    {title}
                  </T>
                  {subtitle ? (
                    <T variant="caption" color="textSecondary">
                      {subtitle}
                    </T>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                  style={[styles.close, { backgroundColor: theme.field }]}
                >
                  <X size={18} color={theme.textSecondary} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <Animated.View style={[styles.flex, body]}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={(_, height) => setContentH(height)}
            >
              {children}
            </ScrollView>
            {footer ? (
              <View
                onLayout={(e) => setFootH(e.nativeEvent.layout.height)}
                style={[styles.footer, { paddingBottom: Math.max(Spacing.three, insets.bottom) }]}
              >
                {footer}
              </View>
            ) : (
              <View
                onLayout={(e) => setFootH(e.nativeEvent.layout.height)}
                style={{ height: Math.max(Spacing.three, insets.bottom) }}
              />
            )}
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { backgroundColor: "rgba(5,5,6,0.5)" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    overflow: "hidden",
    shadowColor: "#0F1419",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  head: {
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  close: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: HitTarget / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, gap: Spacing.one },
});
