import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import {
  DEFAULT_GOAL,
  goalDateOf,
  goalFields,
  GoalPicker,
  goalReady,
} from "@/components/goal-picker";
import { RouteSheet } from "@/components/route-sheet";
import { Button, Card, Notice, StateView, T } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useMakeTrainingBlock, useMine, useNextTrainingBlock } from "@/lib/queries";

/**
 * "Give it a finish line": a standing slot gets a goal and a date. With
 * `fromBlockId` it is "Start the next block": a finished block's people and
 * weekly slots, aimed at a new goal.
 */
export default function NewTrainingBlock() {
  const { seriesId, fromBlockId } = useLocalSearchParams<{
    seriesId?: string;
    fromBlockId?: string;
  }>();
  const router = useRouter();
  const mine = useMine();
  const make = useMakeTrainingBlock();
  const next = useNextTrainingBlock();
  const previous = mine.data?.trainingBlocks.find((b) => b.id === fromBlockId);
  const slot = previous
    ? { title: previous.goalLabel, activity: previous.activity }
    : mine.data?.series.find((s) => s.id === seriesId);
  const [goal, setGoal] = useState(DEFAULT_GOAL);

  if (!slot) {
    return (
      <RouteSheet title="Train for a goal">
        <StateView
          loading={mine.isPending}
          error={mine.error}
          empty="That weekly session has ended."
        />
      </RouteSheet>
    );
  }

  const opts = {
    onSuccess: (block: { id: string }) =>
      router.replace({ pathname: "/training-block/[id]", params: { id: block.id } }),
  };
  function start() {
    if (fromBlockId) return next.mutate({ blockId: fromBlockId, ...goalFields(goal) }, opts);
    if (seriesId) make.mutate({ seriesId, ...goalFields(goal) }, opts);
  }
  const busy = make.isPending || next.isPending;
  const error = make.error ?? next.error;

  return (
    <RouteSheet
      title={previous ? "What’s next?" : "Train for a goal"}
      subtitle={
        previous
          ? `${previous.goalLabel} is done. Same people, same weekly sessions.`
          : `${slot.title} keeps running every week — until the date you pick.`
      }
      startFull
      footer={
        <Button
          variant="accent"
          label="Start training for it"
          loading={busy}
          disabled={!goalReady(goal)}
          onPress={start}
        />
      }
    >
      <GoalPicker activity={slot.activity} value={goal} onChange={setGoal} />

      <Card>
        <T variant="label">Ends {formatDate(goalDateOf(goal))}</T>
        <T variant="caption" color="textSecondary">
          Everyone in the {previous ? "last goal" : "weekly session"} is in. Check-in, skipping a
          week and the no-show rules stay exactly as they are. Anyone can leave at any time.
        </T>
      </Card>

      {error && <Notice tone="danger">{error.message}</Notice>}
    </RouteSheet>
  );
}
