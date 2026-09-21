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
import { Card, Row, StateView, T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatWhen } from "@/lib/format";
import { fitnessDayLabel, fitnessQuantity, fitnessRecordedTime } from "@/lib/fitness-summary";

import { EXERCISE_CATALOGUE, type StrengthLog, type StrengthSet } from "../../../shared/fitness";
import type { FitnessActivitySummary } from "../../../shared/fitness-summary";

const exerciseName = (log: StrengthLog) =>
  EXERCISE_CATALOGUE.find((exercise) => exercise.id === log.exerciseId)?.name ?? "Exercise";

/** Owner-scoped seven-day totals come from every saved actual entry, never a log page. */
export function FitnessSummary({
  summary,
  loading,
  error,
  onRetry,
  onHealth,
}: {
  summary?: FitnessActivitySummary;
  loading?: boolean;
  error?: Error | null;
  onRetry: () => void;
  onHealth: () => void;
}) {
  const theme = useTheme();
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
      {loading || error || !summary ? (
        <StateView
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty="Your recorded activity summary is not available."
          rows={2}
        />
      ) : (
        <FitnessSummaryFacts summary={summary} />
      )}
      <T variant="caption" color="textFaint">
        Your recorded exercise entries and workout-plan results stay private and separate from Apple
        Health measurements.
      </T>
    </Card>
  );
}

function FitnessSummaryFacts({ summary }: { summary: FitnessActivitySummary }) {
  const theme = useTheme();
  const { totals, daysWithActivity, days } = summary;
  return (
    <>
      <T variant="heading">
        {totals.completedSets === 0
          ? "No completed sets recorded"
          : `${daysWithActivity} ${daysWithActivity === 1 ? "day" : "days"} with recorded sets`}
      </T>
      <View style={styles.stats}>
        <Stat value={fitnessQuantity(totals.completedSets)} label="completed sets" />
        <Stat value={fitnessQuantity(totals.recordedReps.value)} label="recorded reps" />
      </View>
      <View style={styles.stats}>
        <Stat
          value={fitnessRecordedTime(totals.recordedDurationSeconds.value)}
          label="recorded set time"
        />
        <Stat
          value={fitnessQuantity(totals.knownExternalVolumeKg.value)}
          label="kg·reps subtotal"
        />
      </View>
      <View
        accessible
        accessibilityLabel={`Completed sets by day: ${days.map((day) => `${day.date}: ${day.completedSets}`).join(", ")}`}
      >
        <T variant="caption" color="textSecondary">
          Completed sets by day
        </T>
        <WeekBars
          values={days.map((day) => (day.completedSets > 0 ? day.completedSets : null))}
          color={theme.accent}
        />
        <View style={styles.letters}>
          {days.map((day) => (
            <T key={day.date} variant="caption" color="textFaint" style={styles.letter}>
              {fitnessDayLabel(day.date)}
            </T>
          ))}
        </View>
      </View>
      {totals.completedSets > 0 && (
        <T variant="caption" color="textSecondary">
          Reps entered for {totals.recordedReps.contributingSets} of {totals.completedSets} sets;
          time entered for {totals.recordedDurationSeconds.contributingSets} of{" "}
          {totals.completedSets}. Unentered amounts stay unknown.
        </T>
      )}
      <T variant="caption" color="textSecondary">
        External load × reps is a subtotal from {totals.knownExternalVolumeKg.contributingSets} of{" "}
        {totals.completedSets} sets. Bodyweight and sets with missing reps or load are excluded.
      </T>
      <T variant="caption" color="textFaint">
        Days use {summary.timeZone}. Sets are grouped by the workout’s start day. Recorded time adds
        entered set durations only, excluding rest and untimed sets.
      </T>
    </>
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
              {fitnessQuantity(log.totalVolumeKg)} kg·reps
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
