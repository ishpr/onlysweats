import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AbilityPicker } from "@/components/ability-picker";
import { ChipRow as Picker } from "@/components/chip-row";
import {
  DEFAULT_GOAL,
  goalDateOf,
  goalFields,
  GoalPicker,
  goalReady,
} from "@/components/goal-picker";
import { Button, Card, Chip, Field, Notice, Row, Screen, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { defaultAbility } from "@/lib/ability";
import { atCluster, dayLabel, formatDate, formatWhen } from "@/lib/format";
import {
  useAddBlockSlot,
  useMe,
  usePostSession,
  usePostTrainingBlock,
  useTrainingBlock,
  useVenues,
} from "@/lib/queries";
import { ACTIVITIES, type Ability, type Activity } from "@/lib/types";

const HOURS = Array.from({ length: 17 }, (_, i) => i + 5); // 5 AM – 9 PM
const MINUTES = [0, 15, 30, 45];
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const DURATION: Record<Activity, number> = {
  run: 45,
  ride: 90,
  strength: 60,
  hike: 150,
  walk: 45,
  mobility: 30,
};

/**
 * One form, three jobs: post a session, post a training block (a session that
 * repeats every week until a goal date), or — with `blockId` — add a weekly slot
 * to a block I started. A block fixes the activity, the size and who can join.
 */
export default function Post() {
  const { unlisted, blockId, block } = useLocalSearchParams<{
    unlisted?: string;
    blockId?: string;
    block?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const me = useMe().data;
  const venues = useVenues().data ?? [];
  const post = usePostSession();
  const postBlock = usePostTrainingBlock();
  const addSlot = useAddBlockSlot();
  const parent = useTrainingBlock(blockId ?? "", undefined, Boolean(blockId)).data?.block;

  const [asBlock, setAsBlock] = useState(Boolean(block));
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [ownActivity, setActivity] = useState<Activity>("run");
  const activity = parent?.activity ?? ownActivity;
  // `null` = untouched, so the level follows my profile until I change it.
  const [picked, setPicked] = useState<Ability | null>(null);
  const ability = picked ?? defaultAbility(activity, me?.abilities);
  const [flexible, setFlexible] = useState(false);
  const [venueId, setVenueId] = useState("katy");
  const [title, setTitle] = useState(unlisted ? "Easy one — just us" : "The one I’m doing anyway");
  const [detail, setDetail] = useState("I’m going either way. Join if you’ll be at the pin.");
  // Everyone in the block is confirmed into a new slot, so it starts two days out.
  const firstDay = blockId ? 2 : 0;
  const [days, setDays] = useState(blockId ? 3 : 1);
  const [hour, setHour] = useState(6);
  const [minute, setMinute] = useState(0);
  const [capacity, setCapacity] = useState(unlisted ? 2 : 3);
  const [isUnlisted, setUnlisted] = useState(Boolean(unlisted));
  const [instant, setInstant] = useState(true);
  const [womenOnly, setWomenOnly] = useState(false);

  const start = atCluster(days, hour, minute);
  const open = capacity - 1;

  const slot = {
    venueId,
    title: title.trim(),
    detail: detail.trim(),
    ability,
    abilityFlex: flexible ? ("flexible" as const) : ("strict" as const),
    startAt: start.toISOString(),
    durationMin: DURATION[activity],
  };
  const shared = {
    activity,
    capacity,
    visibility: isUnlisted ? ("unlisted" as const) : ("public" as const),
    joinMode: instant ? ("instant" as const) : ("approve" as const),
    womenOnly,
  };
  const toBlock = (b: { id: string }) =>
    router.replace({ pathname: "/training-block/[id]", params: { id: b.id } });

  function publish() {
    if (blockId) return addSlot.mutate({ blockId, slot }, { onSuccess: toBlock });
    if (asBlock) {
      return postBlock.mutate(
        { ...shared, ...goalFields(goal), slots: [slot] },
        { onSuccess: toBlock },
      );
    }
    post.mutate(
      { ...shared, ...slot },
      { onSuccess: (s) => router.replace({ pathname: "/session/[id]", params: { id: s.id } }) },
    );
  }
  const busy = post.isPending || postBlock.isPending || addSlot.isPending;
  const error = post.error ?? postBlock.error ?? addSlot.error;

  return (
    <Screen edges={["bottom"]}>
      <T variant="title">
        {blockId
          ? "Add a weekly slot."
          : asBlock
            ? "Every week, until a date."
            : `You’re going anyway. Open ${open === 1 ? "a seat" : `${open} seats`}.`}
      </T>
      {blockId && parent && (
        <T color="textSecondary">
          {parent.goalLabel} · ends {formatDate(parent.goalDate)}. Everyone in the block is in this
          slot too, and can skip any week with 12 hours’ notice.
        </T>
      )}

      {!blockId && (
        <Row style={styles.wrap}>
          <Chip label="One session" selected={!asBlock} onPress={() => setAsBlock(false)} />
          <Chip label="Training block" selected={asBlock} onPress={() => setAsBlock(true)} />
        </Row>
      )}

      {!blockId && (
        <Picker label="Activity">
          {(Object.keys(ACTIVITIES) as Activity[]).map((a) => (
            <Chip
              key={a}
              label={ACTIVITIES[a].label}
              selected={activity === a}
              onPress={() => {
                setActivity(a);
                setPicked(null);
                // A marathon isn't a ride: the goal starts over with the activity.
                setGoal(DEFAULT_GOAL);
              }}
            />
          ))}
        </Picker>
      )}

      <Card>
        <T variant="eyebrow" color="stand">
          Level
        </T>
        <T variant="caption" color="textSecondary">
          A buddy at the wrong level is worse than no buddy. Say what this one is.
        </T>
        <AbilityPicker value={ability} onChange={setPicked} />
        {ability.kind !== "open" && (
          <Chip
            label={flexible ? "✓ I’ll adjust to whoever joins" : "I’ll adjust to whoever joins"}
            selected={flexible}
            onPress={() => setFlexible(!flexible)}
          />
        )}
      </Card>

      <Field label="Title" value={title} onChangeText={setTitle} maxLength={120} />
      <Field
        label="About the workout"
        value={detail}
        onChangeText={setDetail}
        multiline
        maxLength={1000}
      />

      <View style={styles.group}>
        <T variant="caption" color="textSecondary">
          Place
        </T>
        {venues.map((v) => {
          const on = v.id === venueId;
          return (
            <Pressable
              key={v.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${v.name}, ${v.neighborhood}`}
              onPress={() => setVenueId(v.id)}
            >
              <Card style={on ? { borderColor: theme.accent, borderWidth: 2 } : undefined}>
                <T variant="label">{v.name}</T>
                <T variant="caption" color="textSecondary">
                  {v.neighborhood} · {v.type.replace("_", " ")}
                </T>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Picker label={asBlock || blockId ? "First one" : "Day"}>
        {Array.from({ length: 8 }, (_, i) => i + firstDay).map((i) => (
          <Chip key={i} label={dayLabel(i)} selected={days === i} onPress={() => setDays(i)} />
        ))}
      </Picker>
      <Picker label="Start (Dallas time)">
        {HOURS.map((h) => (
          <Chip key={h} label={hourLabel(h)} selected={hour === h} onPress={() => setHour(h)} />
        ))}
      </Picker>
      <Picker label="Minutes">
        {MINUTES.map((m) => (
          <Chip
            key={m}
            label={`:${String(m).padStart(2, "0")}`}
            selected={minute === m}
            onPress={() => setMinute(m)}
          />
        ))}
      </Picker>

      {asBlock && !blockId && <GoalPicker activity={activity} value={goal} onChange={setGoal} />}

      {!blockId && (
        <>
          <Picker label="People, including you">
            {[2, 3, 4].map((n) => (
              <Chip
                key={n}
                label={String(n)}
                selected={capacity === n}
                onPress={() => setCapacity(n)}
              />
            ))}
          </Picker>

          <Row style={styles.wrap}>
            <Chip label="Public" selected={!isUnlisted} onPress={() => setUnlisted(false)} />
            <Chip label="Invite only" selected={isUnlisted} onPress={() => setUnlisted(true)} />
            <Chip label="Instant join" selected={instant} onPress={() => setInstant(true)} />
            <Chip
              label={asBlock ? "We approve each person" : "I approve each person"}
              selected={!instant}
              onPress={() => setInstant(false)}
            />
            {me?.gender === "woman" && (
              <Chip
                label="Women-only"
                selected={womenOnly}
                onPress={() => setWomenOnly(!womenOnly)}
              />
            )}
          </Row>
        </>
      )}

      <T variant="caption" color="textSecondary">
        {asBlock && !blockId
          ? `First one ${formatWhen(start.toISOString())}, then the same time every week until ${formatDate(goalDateOf(goal))}. Whoever joins is in every week. This is the first weekly slot — add up to three more from the block’s page. If nobody joins in two weeks, it’s called off.`
          : `Starts ${formatWhen(start.toISOString())}. Nobody pays to join and you don’t earn — the same no-show rules apply to you as to whoever joins.`}
      </T>
      {error && <Notice tone="danger">{error.message}</Notice>}
      <Button
        label={blockId ? "Add the slot" : asBlock ? "Post the training block" : "Post the session"}
        loading={busy}
        disabled={asBlock && !blockId && !goalReady(goal)}
        onPress={publish}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  wrap: { flexWrap: "wrap", gap: Spacing.one },
});
