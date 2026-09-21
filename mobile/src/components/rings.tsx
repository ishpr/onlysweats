/**
 * The track record, as three rings — the app's own heritage (the web prototype's
 * activity rings) put to honest use: each ring is a fact about showing up.
 *
 * Outer: sessions completed, toward the next round number. Middle: on time.
 * Inner: would join again. Nothing here is a score anyone gives your body or
 * your speed — only whether you turned up and were good company.
 */
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { withAlpha } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Ring({
  size,
  radius,
  stroke,
  color,
  value,
  delay,
}: {
  size: number;
  radius: number;
  stroke: number;
  color: string;
  /** 0–1 */
  value: number;
  delay: number;
}) {
  const reduced = useReducedMotion();
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(reduced ? value : 0);
  useEffect(() => {
    progress.value = reduced
      ? value
      : withDelay(delay, withTiming(value, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [value, delay, reduced, progress]);
  const animated = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - Math.min(1, Math.max(0, progress.value))),
  }));
  const c = size / 2;
  return (
    <>
      <Circle
        cx={c}
        cy={c}
        r={radius}
        stroke={withAlpha(color, 0.18)}
        strokeWidth={stroke}
        fill="none"
      />
      <AnimatedCircle
        cx={c}
        cy={c}
        r={radius}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        animatedProps={animated}
        // Start at 12 o'clock, like a watch face.
        transform={`rotate(-90 ${c} ${c})`}
      />
    </>
  );
}

export function TrackRings({
  size = 132,
  completed,
  onTime,
  joinAgain,
  children,
}: {
  size?: number;
  /** 0–1 each. */
  completed: number;
  onTime: number;
  joinAgain: number;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const stroke = size * 0.085;
  const gap = stroke * 0.28;
  const r1 = size / 2 - stroke / 2;
  const r2 = r1 - stroke - gap;
  const r3 = r2 - stroke - gap;
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size}>
        <Ring
          size={size}
          radius={r1}
          stroke={stroke}
          color={theme.move}
          value={completed}
          delay={0}
        />
        <Ring
          size={size}
          radius={r2}
          stroke={stroke}
          color={theme.accent}
          value={onTime}
          delay={120}
        />
        <Ring
          size={size}
          radius={r3}
          stroke={stroke}
          color={theme.stand}
          value={joinAgain}
          delay={240}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: "center", justifyContent: "center" } });
