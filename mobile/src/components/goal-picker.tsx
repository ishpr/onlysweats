import { ChipRow } from "@/components/chip-row";
import { Chip, Field } from "@/components/ui";
import { clusterDate, formatDate } from "@/lib/format";
import { GOALS, type Activity, type GoalKind } from "@/lib/types";

// A block runs 4 to 20 weeks; the last week's seven days make up the rest.
const WEEKS = Array.from({ length: 16 }, (_, i) => i + 4);

export type Goal = { goalKind: GoalKind; eventName: string; weeks: number; extraDays: number };
export const DEFAULT_GOAL: Goal = {
  goalKind: "consistency",
  eventName: "",
  weeks: 12,
  extraDays: 0,
};

/** The goal date a picker state stands for, as the API's `YYYY-MM-DD`. */
export const goalDateOf = (g: Goal) => clusterDate(g.weeks * 7 + g.extraDays);
/** "Another event" has to be named; everything else is ready as it stands. */
export const goalReady = (g: Goal) => g.goalKind !== "event_other" || g.eventName.trim().length > 0;
export const goalFields = (g: Goal) => ({
  goalKind: g.goalKind,
  eventName: g.goalKind !== "consistency" && g.eventName.trim() ? g.eventName.trim() : undefined,
  goalDate: goalDateOf(g),
});

/**
 * What a training block is aimed at: a goal from a short list, and a date picked
 * as weeks plus a day. A block is about showing up, never about a body.
 */
export function GoalPicker({
  activity,
  value,
  onChange,
}: {
  activity: Activity;
  value: Goal;
  onChange: (next: Goal) => void;
}) {
  const goals = GOALS.filter((g) => !g.activities || g.activities.includes(activity));
  const isEvent = value.goalKind !== "consistency";
  return (
    <>
      <ChipRow label="What are you working toward?">
        {goals.map((g) => (
          <Chip
            key={g.kind}
            label={g.label}
            selected={value.goalKind === g.kind}
            onPress={() => onChange({ ...value, goalKind: g.kind })}
          />
        ))}
      </ChipRow>
      {isEvent && (
        <Field
          label={value.goalKind === "event_other" ? "Which event?" : "Which one? (optional)"}
          value={value.eventName}
          onChangeText={(eventName) => onChange({ ...value, eventName })}
          placeholder="Dallas Marathon"
          maxLength={60}
        />
      )}
      <ChipRow label={isEvent ? "Weeks until the event" : "For how many weeks?"}>
        {WEEKS.map((w) => (
          <Chip
            key={w}
            label={String(w)}
            selected={value.weeks === w}
            onPress={() => onChange({ ...value, weeks: w })}
          />
        ))}
      </ChipRow>
      <ChipRow label={isEvent ? "Event day" : "Last day"}>
        {Array.from({ length: 7 }, (_, d) => (
          <Chip
            key={d}
            label={formatDate(clusterDate(value.weeks * 7 + d))}
            selected={value.extraDays === d}
            onPress={() => onChange({ ...value, extraDays: d })}
          />
        ))}
      </ChipRow>
    </>
  );
}
