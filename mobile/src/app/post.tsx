import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";

import { AbilityPicker } from "@/components/ability-picker";
import {
  DEFAULT_GOAL,
  goalDateOf,
  goalFields,
  GoalPicker,
  goalReady,
} from "@/components/goal-picker";
import { SectionTitle } from "@/components/list";
import { PressScale } from "@/components/motion";
import { PhotoCard, SessionCardFace } from "@/components/session-card";
import { Button, Card, Chip, Field, Notice, Row, Screen, T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { abilityLabel, defaultAbility } from "@/lib/ability";
import { ApiError } from "@/lib/api";
import { atCluster, dayLabel, formatDate, formatDuration, formatWhen } from "@/lib/format";
import {
  useAddBlockSlot,
  useMe,
  usePostSession,
  usePostTrainingBlock,
  useTrainingBlock,
  useVenues,
} from "@/lib/queries";
import { ACTIVITIES, type Ability, type Activity } from "@/lib/types";
import { useVerifyGate } from "@/lib/verify-gate";

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
  const now = useNow(60_000);
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
  // `null` = untouched: the name follows the activity and time until I write my own.
  // Nothing is pre-written for me — a default I didn't read would end up on every
  // card, notification and share message.
  const [titleEdit, setTitle] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [durationEdit, setDuration] = useState<number | null>(null);
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
  const durationMin = durationEdit ?? DURATION[activity];
  const title = titleEdit ?? `${partOfDay(hour)} ${NOUN[activity]}`;
  // Today's hours that have already gone (plus the 30 minutes a post needs).
  const tooSoon = (h: number, m: number) => +atCluster(days, h, m) < now + 35 * 60_000;

  const slot = {
    venueId,
    title: title.trim(),
    detail: detail.trim(),
    ability,
    abilityFlex: flexible ? ("flexible" as const) : ("strict" as const),
    startAt: start.toISOString(),
    durationMin,
  };
  const shared = {
    activity,
    capacity,
    visibility: isUnlisted ? ("unlisted" as const) : ("public" as const),
    joinMode: instant ? ("instant" as const) : ("approve" as const),
    womenOnly,
  };
  const toVerify = useVerifyGate();
  const toBlock = (b: { id: string }) =>
    router.replace({ pathname: "/training-block/[id]", params: { id: b.id } });

  function publish() {
    if (blockId) {
      return addSlot.mutate({ blockId, slot }, { onSuccess: toBlock, onError: toVerify });
    }
    if (asBlock) {
      return postBlock.mutate(
        { ...shared, ...goalFields(goal), slots: [slot] },
        { onSuccess: toBlock, onError: toVerify },
      );
    }
    post.mutate(
      { ...shared, ...slot },
      {
        onSuccess: (s) => router.replace({ pathname: "/session/[id]", params: { id: s.id } }),
        onError: toVerify,
      },
    );
  }
  const busy = post.isPending || postBlock.isPending || addSlot.isPending;
  const raw = post.error ?? postBlock.error ?? addSlot.error;
  // A "verify first" refusal opens the verify screen instead of showing here.
  const error = raw instanceof ApiError && raw.code?.startsWith("verify_") ? null : raw;

  const canPost =
    title.trim().length > 0 && !tooSoon(hour, minute) && !(asBlock && !blockId && !goalReady(goal));
  const venue = venues.find((v) => v.id === venueId);

  return (
    <Screen
      edges={["bottom"]}
      footer={
        <>
          {error && <Notice tone="danger">{error.message}</Notice>}
          <Button
            variant="accent"
            label={blockId ? "Add weekly session" : asBlock ? "Post the goal" : "Post session"}
            loading={busy}
            disabled={!canPost}
            onPress={publish}
          />
          <T variant="caption" color="textFaint" style={styles.center}>
            {tooSoon(hour, minute)
              ? "Pick a start time at least 30 minutes from now."
              : asBlock && !blockId
                ? `First one ${formatWhen(start.toISOString())}, then weekly until ${formatDate(goalDateOf(goal))}`
                : `Starts ${formatWhen(start.toISOString())} · free to post`}
          </T>
        </>
      }
    >
      {blockId && parent ? (
        <Notice>
          Adding a weekly session to {parent.goalLabel} (ends {formatDate(parent.goalDate)}).
          Everyone in the group is in it too, and can skip any week for free with 12 hours’ notice.
        </Notice>
      ) : (
        <View
          style={styles.segment}
          accessibilityRole="radiogroup"
          accessibilityLabel="What to post"
        >
          <Chip label="One session" selected={!asBlock} onPress={() => setAsBlock(false)} />
          <Chip label="Train for a goal" selected={asBlock} onPress={() => setAsBlock(true)} />
        </View>
      )}

      {/* What you're making, as everyone else will see it. */}
      <View accessible accessibilityLabel={`Preview: ${title}, ${formatWhen(start.toISOString())}`}>
        <SessionCardFace
          session={{
            activity,
            title,
            abilityLabel: abilityLabel(ability),
            abilityFlex: flexible ? "flexible" : "strict",
            startAt: start.toISOString(),
            durationMin,
            womenOnly,
            visibility: isUnlisted ? "unlisted" : "public",
            seatsLeft: capacity - 1,
            seriesId: asBlock || blockId ? "preview" : null,
          }}
          venue={venue}
        />
      </View>

      {!blockId && (
        <View style={styles.section}>
          <SectionTitle>What</SectionTitle>
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Activity">
            {(Object.keys(ACTIVITIES) as Activity[]).map((a) => (
              <Chip
                key={a}
                label={ACTIVITIES[a].label}
                selected={activity === a}
                onPress={() => {
                  setActivity(a);
                  setPicked(null);
                  setDuration(null);
                  // A marathon isn't a ride: the goal starts over with the activity.
                  setGoal(DEFAULT_GOAL);
                }}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <SectionTitle>How hard</SectionTitle>
        <Card>
          <AbilityPicker value={ability} onChange={setPicked} />
          {ability.kind !== "open" && (
            <Row>
              <View style={styles.flex}>
                <T>Any level welcome</T>
                <T variant="caption" color="textSecondary">
                  I’ll adjust to whoever joins.
                </T>
              </View>
              <Switch
                accessibilityLabel="Any level welcome"
                value={flexible}
                onValueChange={setFlexible}
                trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
              />
            </Row>
          )}
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>{asBlock || blockId ? "When · the first one" : "When"}</SectionTitle>
        <Card>
          <Choice label="Day">
            {Array.from({ length: 8 }, (_, i) => i + firstDay).map((i) => (
              <Chip key={i} label={dayLabel(i)} selected={days === i} onPress={() => setDays(i)} />
            ))}
          </Choice>
          <Choice label="Start time · Dallas">
            {HOURS.filter((h) => !tooSoon(h, 45)).map((h) => (
              <Chip key={h} label={hourLabel(h)} selected={hour === h} onPress={() => setHour(h)} />
            ))}
          </Choice>
          <Choice label="Minutes past the hour">
            {MINUTES.map((m) => (
              <Chip
                key={m}
                label={`${hourLabel(hour).replace(/ (AM|PM)/, "")}:${String(m).padStart(2, "0")}`}
                selected={minute === m}
                onPress={() => setMinute(m)}
              />
            ))}
          </Choice>
          <Choice label="How long">
            {DURATIONS.map((d) => (
              <Chip
                key={d}
                label={formatDuration(d)}
                selected={durationMin === d}
                onPress={() => setDuration(d)}
              />
            ))}
          </Choice>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>Where</SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.venues}
          accessibilityRole="radiogroup"
          accessibilityLabel="Place"
        >
          {venues.map((v) => {
            const on = v.id === venueId;
            return (
              <PressScale
                key={v.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${v.name}, ${v.neighborhood}`}
                feedback="select"
                onPress={() => setVenueId(v.id)}
                style={[
                  styles.venue,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: on ? theme.accent : theme.border,
                  },
                  on && styles.venueOn,
                ]}
              >
                <PhotoCard venue={v} minHeight={120} photoHeight={72} style={styles.venueFill}>
                  <T variant="label" numberOfLines={2}>
                    {v.name}
                  </T>
                  <T variant="caption" color="textSecondary">
                    {v.neighborhood}
                  </T>
                </PhotoCard>
              </PressScale>
            );
          })}
        </ScrollView>
        <T variant="caption" color="textFaint">
          We’re starting with these public spots in Dallas. You’ll see the exact meeting point once
          it’s posted, and so will whoever joins.
        </T>
      </View>

      {asBlock && !blockId && (
        <View style={styles.section}>
          <SectionTitle>The goal</SectionTitle>
          <GoalPicker activity={activity} value={goal} onChange={setGoal} />
          <T variant="caption" color="textFaint">
            Whoever joins is in every week until the date. This is the first weekly session — you
            can add up to three more afterwards. If nobody joins within two weeks, it’s cancelled.
          </T>
        </View>
      )}

      {!blockId && (
        <View style={styles.section}>
          <SectionTitle>Who can join</SectionTitle>
          <Card>
            <Choice label="How many buddies?">
              {[1, 2, 3].map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  selected={capacity === n + 1}
                  onPress={() => setCapacity(n + 1)}
                />
              ))}
            </Choice>
            <Choice label="Who can see it">
              <Chip
                label="Anyone at this level"
                selected={!isUnlisted}
                onPress={() => setUnlisted(false)}
              />
              <Chip
                label="Only people I send the link to"
                selected={isUnlisted}
                onPress={() => setUnlisted(true)}
              />
            </Choice>
            <Choice label="Joining">
              <Chip label="Join instantly" selected={instant} onPress={() => setInstant(true)} />
              <Chip
                label={asBlock ? "We approve each person" : "I approve each person"}
                selected={!instant}
                onPress={() => setInstant(false)}
              />
            </Choice>
            {me?.gender === "woman" && (
              <Row>
                <View style={styles.flex}>
                  <T>Women-only</T>
                  <T variant="caption" color="textSecondary">
                    Only women can see and join.
                  </T>
                </View>
                <Switch
                  accessibilityLabel="Women-only"
                  value={womenOnly}
                  onValueChange={setWomenOnly}
                  trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                />
              </Row>
            )}
          </Card>
        </View>
      )}

      <View style={styles.section}>
        <SectionTitle>Name and details</SectionTitle>
        <Field
          label="Session name"
          value={title}
          onChangeText={setTitle}
          maxLength={120}
          placeholder="e.g. Easy 5 miles on the Katy Trail"
        />
        <Field
          label="Details (optional)"
          value={detail}
          onChangeText={setDetail}
          multiline
          maxLength={1000}
          placeholder="Route, what to bring, anything a buddy should know"
        />
        <T variant="caption" color="textFaint">
          If someone joins and you cancel within 12 hours it’s $5; not showing up is $10 and a
          strike. The same applies to them.
        </T>
      </View>
    </Screen>
  );
}

/** One labelled single-choice group, wrapped so nothing hides off-screen. */
function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.choice} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

const NOUN: Record<Activity, string> = {
  run: "run",
  ride: "ride",
  strength: "gym session",
  hike: "hike",
  walk: "walk",
  mobility: "mobility session",
};
const partOfDay = (h: number) =>
  h < 8 ? "Early" : h < 12 ? "Morning" : h < 14 ? "Lunchtime" : h < 17 ? "Afternoon" : "Evening";
const DURATIONS = [30, 45, 60, 90, 120, 150, 180];

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  segment: { flexDirection: "row", gap: Spacing.one },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  choice: { gap: Spacing.one },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  venues: { gap: Spacing.two, paddingRight: Spacing.three },
  venue: {
    width: 168,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  venueFill: { flex: 1, borderWidth: 0, borderRadius: 0 },
  venueOn: { borderWidth: 2 },
});
