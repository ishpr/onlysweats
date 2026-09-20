import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import {
  DEFAULT_GOAL,
  goalDateOf,
  goalFields,
  GoalPicker,
  goalReady,
} from "@/components/goal-picker";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useMakeTrainingBlock, useMine } from "@/lib/queries";

/** "Give it a finish line": a standing slot gets a goal and a date. */
export default function NewTrainingBlock() {
  const { seriesId } = useLocalSearchParams<{ seriesId: string }>();
  const router = useRouter();
  const mine = useMine();
  const make = useMakeTrainingBlock();
  const slot = mine.data?.series.find((s) => s.id === seriesId);
  const [goal, setGoal] = useState(DEFAULT_GOAL);

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

  function start() {
    make.mutate(
      { seriesId, ...goalFields(goal) },
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

      <GoalPicker activity={slot.activity} value={goal} onChange={setGoal} />

      <Card>
        <T variant="label">Ends {formatDate(goalDateOf(goal))}</T>
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
        disabled={!goalReady(goal)}
        onPress={start}
      />
    </Screen>
  );
}
