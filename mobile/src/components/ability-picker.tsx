/**
 * Stating a level — for a session (`AbilityPicker`) and for yourself
 * (`LevelPicker`). Always about the workout: a pace, a speed, a distance, a plain
 * word. Never about a body, and never something other members rate.
 */
import { StyleSheet, View } from "react-native";

import { Chip, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import {
  DIFFICULTY,
  EFFORT,
  EXPERIENCE,
  GYM_FOCUS,
  HIKE_GAIN,
  HIKE_MILES,
  PACE_BANDS,
  RIDE_MILES,
  RUN_MILES,
  SPEED_BANDS,
  WALK_MILES,
  cap,
  paceLabel,
  speedLabel,
} from "@/lib/ability";
import type { Ability, Activity, MemberAbilities } from "@/lib/types";

function Choices<V>({
  label,
  options,
  selected,
  text,
  onPick,
}: {
  label: string;
  options: readonly V[];
  selected: (v: V) => boolean;
  text: (v: V) => string;
  onPick: (v: V) => void;
}) {
  return (
    <View style={styles.group}>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
      {/* Wrapped, never a sideways scroller: every option — and the chosen one — stays in view. */}
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <Chip key={text(o)} label={text(o)} selected={selected(o)} onPress={() => onPick(o)} />
        ))}
      </View>
    </View>
  );
}

const miles = (n: number) => `${n} mi`;

export function AbilityPicker({
  value,
  onChange,
}: {
  value: Ability;
  onChange: (a: Ability) => void;
}) {
  switch (value.kind) {
    case "run":
      return (
        <>
          <Choices
            label="Pace per mile"
            options={PACE_BANDS}
            text={paceLabel}
            selected={([lo, hi]) => lo === value.paceMinSec && hi === value.paceMaxSec}
            onPick={([lo, hi]) => onChange({ ...value, paceMinSec: lo, paceMaxSec: hi })}
          />
          <Choices
            label="Distance"
            options={RUN_MILES}
            text={miles}
            selected={(m) => m === value.miles}
            onPick={(m) => onChange({ ...value, miles: m })}
          />
        </>
      );
    case "ride":
      return (
        <>
          <Choices
            label="Average speed"
            options={SPEED_BANDS}
            text={speedLabel}
            selected={([lo, hi]) => lo === value.mphMin && hi === value.mphMax}
            onPick={([lo, hi]) => onChange({ ...value, mphMin: lo, mphMax: hi })}
          />
          <Choices
            label="Distance"
            options={RIDE_MILES}
            text={miles}
            selected={(m) => m === value.miles}
            onPick={(m) => onChange({ ...value, miles: m })}
          />
          <Choices
            label="Surface"
            options={["road", "gravel"] as const}
            text={cap}
            selected={(v) => v === value.surface}
            onPick={(v) => onChange({ ...value, surface: v })}
          />
        </>
      );
    case "gym":
      return (
        <>
          <Choices
            label="Experience"
            options={EXPERIENCE}
            text={cap}
            selected={(v) => v === value.experience}
            onPick={(v) => onChange({ ...value, experience: v })}
          />
          <Choices
            label="Today’s focus"
            options={GYM_FOCUS}
            text={(v) => v}
            selected={(v) => v === value.focus}
            onPick={(v) => onChange({ ...value, focus: v })}
          />
        </>
      );
    case "hike":
      return (
        <>
          <Choices
            label="How hard"
            options={DIFFICULTY}
            text={cap}
            selected={(v) => v === value.difficulty}
            onPick={(v) => onChange({ ...value, difficulty: v })}
          />
          <Choices
            label="Distance"
            options={HIKE_MILES}
            text={miles}
            selected={(m) => m === value.miles}
            onPick={(m) => onChange({ ...value, miles: m })}
          />
          <Choices
            label="Elevation gain"
            options={HIKE_GAIN}
            text={(n) => `${n.toLocaleString("en-US")} ft`}
            selected={(n) => n === value.gainFt}
            onPick={(n) => onChange({ ...value, gainFt: n })}
          />
        </>
      );
    case "walk":
      return (
        <>
          <Choices
            label="Effort"
            options={EFFORT}
            text={cap}
            selected={(v) => v === value.effort}
            onPick={(v) => onChange({ ...value, effort: v })}
          />
          <Choices
            label="Distance"
            options={WALK_MILES}
            text={miles}
            selected={(m) => m === value.miles}
            onPick={(m) => onChange({ ...value, miles: m })}
          />
        </>
      );
    case "open":
      return (
        <T variant="caption" color="textSecondary">
          Open to all levels.
        </T>
      );
  }
}

/** My own level for one activity. Picking one narrows Sessions to what fits. */
export function LevelPicker({
  activity,
  mine,
  onChange,
}: {
  activity: Exclude<Activity, "mobility">;
  mine: MemberAbilities;
  onChange: (patch: MemberAbilities) => void;
}) {
  switch (activity) {
    case "run":
      return (
        <Choices
          label="Run · my pace per mile"
          options={PACE_BANDS}
          text={paceLabel}
          selected={([lo, hi]) => lo === mine.run?.paceMinSec && hi === mine.run?.paceMaxSec}
          onPick={([lo, hi]) => onChange({ run: { paceMinSec: lo, paceMaxSec: hi } })}
        />
      );
    case "ride":
      return (
        <Choices
          label="Ride · my average speed"
          options={SPEED_BANDS}
          text={speedLabel}
          selected={([lo, hi]) => lo === mine.ride?.mphMin && hi === mine.ride?.mphMax}
          onPick={([lo, hi]) => onChange({ ride: { mphMin: lo, mphMax: hi } })}
        />
      );
    case "strength":
      return (
        <Choices
          label="Gym · experience"
          options={EXPERIENCE}
          text={cap}
          selected={(v) => v === mine.strength?.experience}
          onPick={(v) => onChange({ strength: { experience: v } })}
        />
      );
    case "hike":
      return (
        <Choices
          label="Hike · as hard as"
          options={DIFFICULTY}
          text={cap}
          selected={(v) => v === mine.hike?.difficulty}
          onPick={(v) => onChange({ hike: { difficulty: v } })}
        />
      );
    case "walk":
      return (
        <Choices
          label="Walk · effort"
          options={EFFORT}
          text={cap}
          selected={(v) => v === mine.walk?.effort}
          onPick={(v) => onChange({ walk: { effort: v } })}
        />
      );
  }
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
});
