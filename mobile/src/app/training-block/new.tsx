import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Button, Card, Chip, Field, Notice, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { clusterDate, formatDate } from "@/lib/format";
import { useMakeTrainingBlock, useMine } from "@/lib/queries";
import { GOALS, type GoalKind } from "@/lib/types";

// A block runs 4 to 20 weeks; the last week's seven days make up the rest.
const WEEKS = Array.from({ length: 16 }, (_, i) => i + 4);

/**
 * "Make this a training block": a standing slot gets a goal and a date. The goal
 * comes from a short list — a block is about showing up, never about a body.
 */
export default function NewTrainingBlock() {
  const { seriesId } = useLocalSearchParams<{ seriesId: string }>();
  const router = useRouter();
  const mine = useMine();
  const make = useMakeTrainingBlock();
  const slot = mine.data?.series.find((s) => s.id === seriesId);

  const [goalKind, setGoalKind] = useState<GoalKind>("consistency");
  const [eventName, setEventName] = useState("");
  const [weeks, setWeeks] = useState(12);
  const [extraDays, setExtraDays] = useState(0);

  if (!slot) {
    return (
      <Screen edges={["bottom"]}>
        <StateView
          loading={mine.isPending}
          error={mine.error}
          empty="That standing slot has ended."
        />
      </Screen>
    );
  }

  const goals = GOALS.filter((g) => !g.activities || g.activities.includes(slot.activity));
  const isEvent = goalKind !== "consistency";
  const goalDate = clusterDate(weeks * 7 + extraDays);
  const ready = goalKind !== "event_other" || eventName.trim().length > 0;

  function start() {
    make.mutate(
      {
        seriesId,
        goalKind,
        eventName: isEvent && eventName.trim() ? eventName.trim() : undefined,
        goalDate,
      },
      {
        onSuccess: (block) =>
          router.replace({ pathname: "/training-block/[id]", params: { id: block.id } }),
      },
    );
  }

  return (
    <Screen edges={["bottom"]}>
      <T variant="title">Give it a finish line.</T>
      <T color="textSecondary">
        {slot.title} keeps running every week — until the date you pick. You’ll see the sessions
        you’ve kept out of the ones you had.
      </T>

      <Picker label="What are you working toward?">
        {goals.map((g) => (
          <Chip
            key={g.kind}
            label={g.label}
            selected={goalKind === g.kind}
            onPress={() => setGoalKind(g.kind)}
          />
        ))}
      </Picker>

      {isEvent && (
        <Field
          label={goalKind === "event_other" ? "Which event?" : "Which one? (optional)"}
          value={eventName}
          onChangeText={setEventName}
          placeholder="Dallas Marathon"
          maxLength={60}
        />
      )}

      <Picker label={isEvent ? "Weeks until the event" : "For how many weeks?"}>
        {WEEKS.map((w) => (
          <Chip key={w} label={String(w)} selected={weeks === w} onPress={() => setWeeks(w)} />
        ))}
      </Picker>
      <Picker label={isEvent ? "Event day" : "Last day"}>
        {Array.from({ length: 7 }, (_, d) => (
          <Chip
            key={d}
            label={formatDate(clusterDate(weeks * 7 + d))}
            selected={extraDays === d}
            onPress={() => setExtraDays(d)}
          />
        ))}
      </Picker>

      <Card>
        <T variant="label">Ends {formatDate(goalDate)}</T>
        <T variant="caption" color="textSecondary">
          Everyone in the slot is in the block. Check-in, skipping a week and the no-show rules stay
          exactly as they are. Anyone can leave at any time.
        </T>
      </Card>

      {make.error && <Notice tone="danger">{make.error.message}</Notice>}
      <Button
        variant="accent"
        label="Start the training block"
        loading={make.isPending}
        disabled={!ready}
        onPress={start}
      />
    </Screen>
  );
}

function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  chips: { gap: Spacing.one, paddingRight: Spacing.three },
});
