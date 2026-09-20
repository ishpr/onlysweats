/**
 * Motion primitives. Everything here steps aside when the system's Reduce Motion
 * is on: springs and slides become instant or a plain fade.
 */
import { type ReactNode, useEffect } from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { haptic } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SPRING = { damping: 18, stiffness: 320, mass: 0.6 };

/**
 * A pressable that sinks slightly under the finger and ticks. The scale lives in
 * an animated style, never a `style` function — so it also survives `<Link asChild>`.
 */
export function PressScale({
  children,
  style,
  feedback = "tap",
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  feedback?: "tap" | "select" | "none";
  scaleTo?: number;
}) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
    opacity: 1 - pressed.value * 0.12,
  }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = reduced ? 1 : withSpring(1, SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = reduced ? 0 : withSpring(0, SPRING);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (feedback === "tap") haptic.tap();
        else if (feedback === "select") haptic.select();
        onPress?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** List items rise in, one after another. Capped so a long list doesn't crawl. */
export function Enter({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.delay(Math.min(index, 8) * 45)
        .duration(320)
        .easing(Easing.out(Easing.cubic))
        .reduceMotion(ReduceMotion.System)}
      layout={LinearTransition.duration(220).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}

/** Content that arrives after a load: a short fade, no movement. */
export function Appear({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View style={style} entering={FadeIn.duration(220)}>
      {children}
    </Animated.View>
  );
}

function Bone({ width, height = 14 }: { width: `${number}%` | number; height?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{ width, height, borderRadius: Radius.md, backgroundColor: theme.backgroundSelected }}
    />
  );
}

/** Loading placeholder shaped like the cards that are coming. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withSequence(withTiming(0.45, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
  }, [pulse, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[styles.skeleton, animated]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={[
            styles.skeletonCard,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <Bone width="62%" height={18} />
          <Bone width="88%" />
          <Bone width="40%" />
        </View>
      ))}
    </Animated.View>
  );
}

/** A ring that draws itself and a tick that lands: "you're checked in". */
export function SuccessMark({ size = 72, children }: { size?: number; children: ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const ring = useSharedValue(reduced ? 1 : 0.6);
  const glow = useSharedValue(0);
  const inner = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    ring.value = withSpring(1, { damping: 10, stiffness: 180 });
    inner.value = withDelay(120, withSpring(1, { damping: 12, stiffness: 220 }));
    glow.value = withSequence(withTiming(1, { duration: 260 }), withTiming(0, { duration: 700 }));
  }, [ring, inner, glow, reduced]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ring.value }] }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.5,
    transform: [{ scale: 1 + glow.value * 0.6 }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    opacity: inner.value,
    transform: [{ scale: 0.6 + inner.value * 0.4 }],
  }));
  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.center, box]}>
      <Animated.View style={[styles.abs, box, { backgroundColor: theme.accent }, glowStyle]} />
      <Animated.View
        style={[
          styles.center,
          box,
          { backgroundColor: theme.accentSoft, borderColor: theme.accent, borderWidth: 2 },
          ringStyle,
        ]}
      >
        <Animated.View style={innerStyle}>{children}</Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: Spacing.three, alignSelf: "stretch" },
  skeletonCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  center: { alignItems: "center", justifyContent: "center" },
  abs: { position: "absolute" },
});
