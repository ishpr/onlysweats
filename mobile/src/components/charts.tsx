/**
 * Small charts for the member's own readings — the web prototype's area charts and
 * rings, redrawn for the phone. Each one is a picture of facts already on the card:
 * nothing here scores, ranks or diagnoses.
 */
import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { T, withAlpha } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type XY = { x: number; y: number };

/** A gentle curve through the points: each segment eases through the midpoint. */
function curve(points: XY[]) {
  if (points.length === 0) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mid = (a.x + b.x) / 2;
    d += ` C${mid.toFixed(1)},${a.y.toFixed(1)} ${mid.toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return d;
}

function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  return [width, onLayout] as const;
}

/**
 * A filled line. `points` are in data units; `xDomain` pins the x axis (a day runs
 * midnight to midnight even when readings stop at noon). Gaps (`null`) are skipped.
 */
export function AreaChart({
  points,
  xDomain,
  color,
  height = 56,
  band,
  id,
}: {
  points: { x: number; y: number | null }[];
  xDomain?: [number, number];
  color: string;
  height?: number;
  /** A low–high envelope drawn behind the line, same x values as `points`. */
  band?: { x: number; low: number; high: number }[];
  /** Unique per chart on a screen: SVG gradients are looked up by id. */
  id: string;
}) {
  const [width, onLayout] = useWidth();
  const real = points.filter((p): p is { x: number; y: number } => p.y !== null);
  const pad = 4;
  let body = null;
  if (width > 0 && real.length > 0) {
    const ys = [...real.map((p) => p.y), ...(band ?? []).flatMap((b) => [b.low, b.high])];
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const [x0, x1] = xDomain ?? [real[0].x, real[real.length - 1].x];
    const sx = (x: number) =>
      x1 === x0 ? width / 2 : pad + ((x - x0) / (x1 - x0)) * (width - pad * 2);
    const sy = (y: number) =>
      yMax === yMin ? height / 2 : pad + (1 - (y - yMin) / (yMax - yMin)) * (height - pad * 2);
    const line = real.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
    const last = line[line.length - 1];
    const stroke = curve(line);
    const fill = `${stroke} L${last.x.toFixed(1)},${height} L${line[0].x.toFixed(1)},${height} Z`;
    const envelope =
      band && band.length > 1
        ? `${curve(band.map((b) => ({ x: sx(b.x), y: sy(b.high) })))} L${[...band]
            .reverse()
            .map((b) => `${sx(b.x).toFixed(1)},${sy(b.low).toFixed(1)}`)
            .join(" L")} Z`
        : null;
    body = (
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.38} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {envelope && <Path d={envelope} fill={withAlpha(color, 0.12)} />}
        {line.length > 1 && <Path d={fill} fill={`url(#${id})`} />}
        {line.length > 1 && (
          <Path d={stroke} stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
        )}
        <Circle cx={last.x} cy={last.y} r={3.5} fill={color} />
      </Svg>
    );
  }
  return (
    <View
      onLayout={onLayout}
      style={{ height }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {body}
    </View>
  );
}

/** Seven days as bars, today last and brightest. Empty days keep a faint stub. */
export function WeekBars({
  values,
  color,
  height = 40,
}: {
  values: (number | null)[];
  color: string;
  height?: number;
}) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <View
      style={[styles.bars, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {values.map((v, i) => (
        <View key={i} style={styles.barSlot}>
          <View
            style={{
              height: Math.max(4, Math.round(((v ?? 0) / max) * height)),
              borderRadius: 4,
              backgroundColor:
                v === null
                  ? withAlpha(color, 0.12)
                  : i === values.length - 1
                    ? color
                    : withAlpha(color, 0.38),
            }}
          />
        </View>
      ))}
    </View>
  );
}

/** Last night, stage by stage, as one stacked bar with a small key. */
export function StageBar({
  stages,
}: {
  stages: { label: string; minutes: number; color: string }[];
}) {
  const shown = stages.filter((s) => s.minutes > 0);
  return (
    <View style={styles.stageWrap} accessibilityElementsHidden importantForAccessibility="no">
      <View style={styles.stageBar}>
        {shown.map((s) => (
          <View key={s.label} style={{ flex: s.minutes, backgroundColor: s.color }} />
        ))}
      </View>
      <View style={styles.stageKey}>
        {shown.map((s) => (
          <View key={s.label} style={styles.stageKeyItem}>
            <View style={[styles.keyDot, { backgroundColor: s.color }]} />
            <T variant="caption" color="textSecondary" style={styles.keyText}>
              {s.label}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}

const polar = (c: number, r: number, deg: number): XY => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
};
const arc = (c: number, r: number, from: number, to: number) => {
  const a = polar(c, r, from);
  const b = polar(c, r, to);
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
};

/**
 * The day, as a three-part gauge: easy fills one part, steady two, ready all three.
 * It is a picture of the headline beside it, not a number — there is no score to chase.
 */
export function DayDial({
  level,
  size = 112,
  children,
}: {
  /** 0 easy · 1 steady · 2 ready · null unknown */
  level: 0 | 1 | 2 | null;
  size?: number;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const stroke = 11;
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  // A gauge that fills: calm blue on an easy day, the brand green otherwise. Never red —
  // no part of this dial is a warning.
  const lit = level === 0 ? theme.stand : theme.accent;
  // 240° sweep, open at the bottom, split in three; the gaps allow for the round caps.
  const parts: [number, number][] = [
    [-120, -52],
    [-34, 34],
    [52, 120],
  ];
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Svg width={size} height={size}>
        {parts.map(([from, to], i) => (
          <Path
            key={i}
            d={arc(c, r, from, to)}
            stroke={level !== null && i <= level ? lit : withAlpha(theme.text, 0.08)}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.dialCenter]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 5 },
  barSlot: { flex: 1, justifyContent: "flex-end" },
  stageWrap: { gap: Spacing.one },
  stageBar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 },
  stageKey: { flexDirection: "row", flexWrap: "wrap", columnGap: Spacing.two, rowGap: 2 },
  stageKeyItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  keyDot: { width: 7, height: 7, borderRadius: 4 },
  keyText: { fontSize: 12, lineHeight: 16 },
  dialCenter: { alignItems: "center", justifyContent: "center" },
});
