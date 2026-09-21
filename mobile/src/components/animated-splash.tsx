/**
 * The launch animation. The native splash is a still of the mark; this overlay
 * draws the same mark in the same place, so the hand-off is invisible — then the
 * two figures rock back and stride forward together (same lean, same pace), the
 * wordmark rises in, and the whole thing dissolves into the app.
 *
 * With Reduce Motion on it is a plain fade.
 */
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { T } from "@/components/ui";
import { OnPhoto, useTheme } from "@/hooks/use-theme";

// Geometry from brand/build.py, in the splash image's own scale: app.json shows
// the mark 76 pt wide from a 72-unit-wide crop.
const K = 76 / 72;
const LEAN = 14;
const HEAD = 9 * K;
const BODY_W = 15 * K;
const BODY_H = 40 * K;
const FIGURE_H = 63 * K; // head top (18) to feet (81); its centre is the lean's pivot
const MARK_W = 72 * K;
const MARK_H = 76 * K;
const LEFT_X = (34.5 - 14) * K;
const RIGHT_X = (64.5 - 14) * K;
const FIGURE_TOP = (18 - 12) * K;

function Figure({ x, color, lean }: { x: number; color: string; lean: { value: number } }) {
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${lean.value}deg` }] }));
  return (
    <Animated.View style={[styles.figure, { left: x - HEAD, top: FIGURE_TOP }, style]}>
      <View style={[styles.head, { backgroundColor: color }]} />
      <View style={[styles.body, { backgroundColor: color }]} />
    </Animated.View>
  );
}

/** Always dark, like the native splash it takes over from — whatever the app's theme. */
export function AnimatedSplash(props: { onDone: () => void }) {
  return (
    <OnPhoto>
      <SplashBody {...props} />
    </OnPhoto>
  );
}

function SplashBody({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const left = useSharedValue(LEAN);
  const right = useSharedValue(LEAN);
  const rise = useSharedValue(0);
  const word = useSharedValue(0);
  const out = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      out.value = withDelay(
        250,
        withTiming(0, { duration: 300 }, () => runOnJS(onDone)()),
      );
      return;
    }
    // Rock back to upright, then stride forward into the lean — the blue figure a
    // beat behind the green, the way two people fall into step.
    const stride = (delay: number) =>
      withDelay(
        delay,
        withSequence(
          withTiming(-4, { duration: 240, easing: Easing.out(Easing.cubic) }),
          withSpring(LEAN, { damping: 7, stiffness: 140, mass: 0.7 }),
        ),
      );
    left.value = stride(120);
    right.value = stride(200);
    rise.value = withDelay(560, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
    word.value = withDelay(640, withTiming(1, { duration: 380 }));
    out.value = withDelay(
      1350,
      withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }, () => runOnJS(onDone)()),
    );
  }, [reduced, left, right, rise, word, out, onDone]);

  const overlay = useAnimatedStyle(() => ({
    opacity: out.value,
    transform: [{ scale: 1 + (1 - out.value) * 0.06 }],
  }));
  const mark = useAnimatedStyle(() => ({ transform: [{ translateY: -22 * rise.value }] }));
  const wordmark = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: 10 * (1 - word.value) }],
  }));

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.center,
        { backgroundColor: theme.background },
        overlay,
      ]}
      accessible
      accessibilityLabel="SamePace"
      pointerEvents="none"
    >
      <Animated.View style={[styles.mark, mark]}>
        <Figure x={LEFT_X} color={theme.accent} lean={left} />
        <Figure x={RIGHT_X} color={theme.stand} lean={right} />
      </Animated.View>
      <Animated.View style={[styles.word, wordmark]}>
        <T style={styles.wordText}>
          same
          <T style={styles.wordText} color="accent">
            pace
          </T>
        </T>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  mark: { width: MARK_W, height: MARK_H },
  figure: { position: "absolute", width: HEAD * 2, height: FIGURE_H, alignItems: "center" },
  head: { width: HEAD * 2, height: HEAD * 2, borderRadius: HEAD },
  // The body starts 23 units below the head's top (41 − 18).
  body: {
    position: "absolute",
    top: 23 * K,
    width: BODY_W,
    height: BODY_H,
    borderRadius: BODY_W / 2,
  },
  // Sits where the risen mark leaves room, without moving the mark off-centre first.
  word: { position: "absolute", top: "50%", marginTop: MARK_H / 2 - 6 },
  wordText: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6, fontFamily: "Outfit_600SemiBold" },
});
