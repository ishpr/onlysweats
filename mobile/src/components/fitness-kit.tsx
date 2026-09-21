/**
 * The fitness log, drawn: the last seven days at the top, and each saved exercise as
 * a card you can read at a glance — sets as chips, not sentences. Presentational only;
 * the numbers are the member's own entries, never estimates.
 */
import { Dumbbell, HeartPulse } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { WeekBars } from "@/components/charts";
import { PressScale } from "@/components/motion";
import { Card, Row, T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatWhen } from "@/lib/format";

import { EXERCISE_CATALOGUE, type StrengthLog, type StrengthSet } from "../../../shared/fitness";

const DAY = 86_400_000;
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

const exerciseName = (log: StrengthLog) =>
  EXERCISE_CATALOGUE.find((exercise) => exercise.id === log.exerciseId)?.name ?? "Exercise";

/** Seven days of what the member logged, today last. `now` comes from the caller. */
export function FitnessSummary({
  logs,
  now,
  onHealth,
}: {
  logs: StrengthLog[];
  now: number;
  onHealth: () => void;
}) {
  const theme = useTheme();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime() - 6 * DAY;
  const reps = Array.from({ length: 7 }, () => 0);
  let exercises = 0;
  let volume = 0;
  let volumeKnown = false;
  for (const log of logs) {
    const day = Math.floor((new Date(log.startedAt).getTime() - start) / DAY);
    if (day < 0 || day > 6) continue;
    reps[day] += log.totalRepetitions;
    exercises += 1;
    if (log.totalVolumeKg !== null) {
      volume += log.totalVolumeKg;
      volumeKnown = true;
    }
  }
  const total = reps.reduce((sum, value) => sum + value, 0);
  const days = reps.filter((value) => value > 0).length;
  return (
    <Card>
      <Row>
        <Dumbbell size={18} color={theme.accent} />
        <T variant="eyebrow" color="textSecondary" style={styles.flex}>
          Last 7 days
        </T>
        <PressScale
          accessibilityRole="link"
          accessibilityLabel="Workouts from Apple Health"
          onPress={onHealth}
          style={styles.link}
        >
          <HeartPulse size={14} color={theme.accent} />
          <T variant="caption" color="accent">
            Apple Health
          </T>
        </PressScale>
      </Row>
      <T variant="heading">
        {exercises === 0
          ? "Nothing logged this week yet"
          : `${days} ${days === 1 ? "day" : "days"} trained`}
      </T>
      <View style={styles.stats}>
        <Stat value={String(exercises)} label={exercises === 1 ? "exercise" : "exercises"} />
        <Stat value={total.toLocaleString("en-US")} label="reps" />
        <Stat
          value={volumeKnown ? Math.round(volume).toLocaleString("en-US") : "—"}
          label="kg lifted"
        />
      </View>
      <View accessible accessibilityLabel={`Reps by day, most recent last: ${reps.join(", ")}`}>
        <WeekBars values={reps.map((value) => (value > 0 ? value : null))} color={theme.accent} />
        <View style={styles.letters}>
          {reps.map((_, index) => (
            <T key={index} variant="caption" color="textFaint" style={styles.letter}>
              {LETTERS[new Date(start + index * DAY).getDay()]}
            </T>
          ))}
        </View>
      </View>
      <T variant="caption" color="textFaint">
        What you typed in — private, and separate from Apple Health’s measurements.
      </T>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label}`}
      style={[styles.stat, { backgroundColor: theme.field }]}
    >
      <T variant="heading" style={styles.tabular}>
        {value}
      </T>
      <T variant="caption" color="textSecondary" style={styles.small}>
        {label}
      </T>
    </View>
  );
}

const setLabel = (set: StrengthSet) =>
  set.unit === "bodyweight"
    ? `${set.reps} × bodyweight`
    : set.weight === null
      ? `${set.reps} reps`
      : `${set.reps} × ${set.weight} ${set.unit}`;

/** One saved exercise. `children` are its actions (edit, delete, feedback). */
export function LogCard({ log, children }: { log: StrengthLog; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <Card>
      <Row style={styles.logHead}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <Dumbbell size={18} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <T variant="label">{exerciseName(log)}</T>
          <T variant="caption" color="textSecondary">
            {formatWhen(log.startedAt)}
          </T>
        </View>
        <View style={styles.totals}>
          <T variant="label" style={styles.tabular}>
            {log.totalRepetitions} reps
          </T>
          {log.totalVolumeKg !== null && (
            <T variant="caption" color="textSecondary" style={styles.tabular}>
              {Math.round(log.totalVolumeKg).toLocaleString("en-US")} kg
            </T>
          )}
        </View>
      </Row>
      <View
        style={styles.sets}
        accessible
        accessibilityLabel={log.sets
          .map((set, index) => `Set ${index + 1}: ${setLabel(set)}`)
          .join(". ")}
      >
        {log.sets.map((set, index) => (
          <View
            key={index}
            style={[styles.set, { backgroundColor: theme.chip, borderColor: theme.border }]}
          >
            <T variant="caption" color="textFaint" style={styles.small}>
              {index + 1}
            </T>
            <T variant="caption" style={styles.tabular}>
              {setLabel(set)}
            </T>
          </View>
        ))}
      </View>
      {log.note ? (
        <T variant="caption" color="textSecondary">
          “{log.note}”
        </T>
      ) : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  link: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 },
  stats: { flexDirection: "row", gap: Spacing.one },
  stat: { flex: 1, borderRadius: Radius.md, padding: Spacing.two },
  tabular: { fontVariant: ["tabular-nums"] },
  small: { fontSize: 12, lineHeight: 16 },
  letters: { flexDirection: "row", gap: 5, marginTop: Spacing.half },
  letter: { flex: 1, textAlign: "center", fontSize: 11, lineHeight: 14 },
  logHead: { alignItems: "center", gap: Spacing.two },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  totals: { alignItems: "flex-end" },
  sets: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  set: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: Spacing.half,
  },
});
