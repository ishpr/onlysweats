import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, View } from "react-native";

import { BlockEnding } from "@/components/block-ending";
import { ProgressRing } from "@/components/progress-ring";
import { ReportLink } from "@/components/report-link";
import { PhotoCard, Tag } from "@/components/session-card";
import { Avatar, Button, Card, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { SITE_URL } from "@/lib/config";
import { daysUntil, formatDate, formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { reputationLine } from "@/lib/reputation";
import {
  useCloneTrainingBlock,
  useJoinTrainingBlock,
  useLeaveTrainingBlock,
  useMe,
  useResolveBlockRequest,
  useRefreshOnFocus,
  useTrainingBlock,
  useVenues,
} from "@/lib/queries";
import { ACTIVITIES, type TrainingBlock } from "@/lib/types";

/**
 * A training block: standing slots with a finish line. Progress is the sessions I
 * checked in to out of the ones I had — mine alone; nobody sees anyone else's. A
 * visitor sees what they'd be signing up for, and one way in: join every slot.
 */
export default function TrainingBlockPage() {
  const { id, invite } = useLocalSearchParams<{ id: string; invite?: string }>();
  useRefreshOnFocus();
  const router = useRouter();
  const me = useMe().data;
  const q = useTrainingBlock(id, invite);
  const venues = byId(useVenues().data);
  const leave = useLeaveTrainingBlock();
  const join = useJoinTrainingBlock();
  const clone = useCloneTrainingBlock();
  const answer = useResolveBlockRequest();
  const [error, setError] = useState("");
  const fail = (err: Error) => setError(err.message);

  if (!q.data) {
    return (
      <Screen edges={[]}>
        <StateView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  const { block, people } = q.data;
  const venue = venues.get(block.slots[0]?.venueId ?? "");
  const running = block.status === "forming" || block.status === "active";
  const member = block.viewer === "member";
  const mine = block.createdBy === me?.id;
  const byName = new Map(people.map((p) => [p.id, p]));

  function confirmJoin() {
    const slots = block.slots.length;
    Alert.alert(
      block.joinMode === "approve" ? "Ask to join every week?" : "Join every week?",
      `That’s ${slots === 1 ? "one session" : `${slots} sessions`} a week until ${formatDate(block.goalDate)}. Skip any week free with 12 hours’ notice. Inside that it’s $5, and a no-show is $10 and a strike — each week, the same as any session.`,
      [
        { text: "Not now", style: "cancel" },
        {
          text: block.joinMode === "approve" ? "Ask to join" : "I’m in",
          onPress: () => {
            setError("");
            join.mutate({ blockId: block.id, inviteCode: invite }, { onError: fail });
          },
        },
      ],
    );
  }
  // A report always names a session: the next one these members share.
  const sessionId = block.slots.find((s) => s.nextSessionId)?.nextSessionId ?? undefined;

  function confirmLeave() {
    Alert.alert(
      "Leave this goal?",
      "You leave every weekly session in it. A session less than 12 hours away still costs $5 to leave. With one person left, the goal ends.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () =>
            leave.mutate(block.id, {
              onError: (err) => setError(err.message),
              onSuccess: () => router.back(),
            }),
        },
      ],
    );
  }

  return (
    <Screen edges={["bottom"]} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <PhotoCard
        venue={venue}
        minHeight={220}
        photoHeight={150}
        tags={
          <Row style={styles.tags}>
            <Tag label={ACTIVITIES[block.activity].label} />
            <Tag label="Training for a goal" tone="accent" />
            {block.womenOnly && <Tag label="Women-only" />}
          </Row>
        }
      >
        <T variant="title">{block.goalLabel}</T>
        <T variant="label" color="textSecondary">
          {whenLine(block)}
        </T>
      </PhotoCard>

      {!member && (
        <Card>
          <T variant="eyebrow" color="stand">
            {block.seatsLeft} of {block.capacity - 1} spots left
            {block.womenOnly ? " · women-only" : ""}
          </T>
          <T variant="caption" color="textSecondary">
            Joining means every weekly session below, every week until {formatDate(block.goalDate)}.
            You can leave at any time.
          </T>
          <T variant="caption" color="textSecondary">
            {block.fitsMe === false
              ? "One or more of these is outside the level you set. You can still join."
              : block.fitsMe === null
                ? "Set your level on Home or under You to see whether it fits."
                : "Fits your level."}
          </T>
        </Card>
      )}

      {member && block.status === "forming" && (
        <Notice>
          Waiting for a second person. Your sessions are in Sessions, and joining one joins the
          block. If nobody does within two weeks, it’s cancelled.
        </Notice>
      )}

      {member && <BlockEnding block={block} people={people} />}

      {member &&
        block.requests.map((memberId) => (
          <Card key={memberId}>
            <T variant="label">{byName.get(memberId)?.name ?? "Someone"} asked to join</T>
            {byName.get(memberId) && (
              <T variant="caption" color="textSecondary">
                {reputationLine(byName.get(memberId)!)}
              </T>
            )}
            <Row>
              <Button
                style={styles.flex}
                variant="soft"
                label="Pass"
                onPress={() =>
                  answer.mutate(
                    { blockId: block.id, memberId, action: "decline" },
                    { onError: fail },
                  )
                }
              />
              <Button
                style={styles.flex}
                variant="accent"
                label="Approve"
                onPress={() =>
                  answer.mutate(
                    { blockId: block.id, memberId, action: "approve" },
                    { onError: fail },
                  )
                }
              />
            </Row>
          </Card>
        ))}

      {member && (
        <Card>
          <Row style={styles.progress}>
            <ProgressRing kept={block.my.kept} planned={block.my.planned} />
            <View style={styles.flex}>
              <T variant="eyebrow" color="stand">
                Your sessions kept
              </T>
              <T variant="caption" color="textSecondary">
                {block.my.planned === 0
                  ? "Counts from your first check-in toward this goal."
                  : "A session counts when you check in at the pin. A week someone else calls off isn’t held against you."}
              </T>
              {block.my.keptMiles > 0 && (
                <T variant="label">{block.my.keptMiles} mi of sessions kept</T>
              )}
            </View>
          </Row>
          {block.my.keptMiles > 0 && (
            <T variant="caption" color="textFaint">
              The planned distance of the sessions you checked in to — SamePace doesn’t track your
              workout.
            </T>
          )}
          {block.memberIds.length > 1 && block.group.planned > 0 && (
            <T variant="caption" color="textSecondary">
              Together: {block.group.kept} of {block.group.planned} kept.
            </T>
          )}
        </Card>
      )}

      <View style={styles.section}>
        <T variant="heading">Every week</T>
        {block.slots.length === 0 && (
          <Card>
            <T variant="caption" color="textSecondary">
              No weekly sessions are running.
            </T>
          </Card>
        )}
        {block.slots.map((slot) => (
          <Pressable
            key={slot.seriesId}
            accessibilityRole="button"
            accessibilityLabel={`${slot.title}, ${slot.streak} in a row`}
            disabled={!slot.nextSessionId}
            onPress={() =>
              slot.nextSessionId &&
              router.push({ pathname: "/session/[id]", params: { id: slot.nextSessionId } })
            }
          >
            <Card>
              <Row style={styles.between}>
                <View style={styles.flex}>
                  <T variant="label">{slot.title}</T>
                  <T variant="caption" color="textSecondary">
                    {slot.abilityLabel} · {venues.get(slot.venueId)?.name}
                  </T>
                  <T variant="caption" color="textSecondary">
                    {slot.nextStartAt
                      ? `Next: ${formatWhen(slot.nextStartAt)}`
                      : "Nothing more before the goal date"}
                  </T>
                </View>
                <View style={styles.streak}>
                  <T variant="heading" color="accent">
                    {slot.streak}
                  </T>
                  <T variant="caption" color="textSecondary">
                    in a row
                  </T>
                </View>
              </Row>
            </Card>
          </Pressable>
        ))}
      </View>

      <View style={styles.section}>
        <T variant="heading">Training together</T>
        {people
          .filter((p) => block.memberIds.includes(p.id))
          .map((p) => (
            <Card key={p.id}>
              <Row>
                <Avatar initials={p.initials} accent={p.accent} />
                <View style={styles.flex}>
                  <T variant="label">{p.id === me?.id ? `${p.name} · you` : p.name}</T>
                  <T variant="caption" color="textSecondary">
                    {reputationLine(p)}
                  </T>
                </View>
              </Row>
              {member && p.id !== me?.id && sessionId && (
                <ReportLink memberId={p.id} name={p.name} sessionId={sessionId} />
              )}
            </Card>
          ))}
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {block.viewer === "pending" && (
        <Notice>
          You’ve asked to join. Anyone in the group can approve — you’ll hear either way.
        </Notice>
      )}
      {block.viewer === "declined" && <Notice>This one isn’t open to you.</Notice>}
      {block.viewer === "visitor" && block.joinable && (
        <Button
          variant="accent"
          label={block.joinMode === "approve" ? "Ask to join" : "Join — every week"}
          loading={join.isPending}
          onPress={confirmJoin}
        />
      )}
      {!member && !block.joinable && running && (
        <>
          <Notice>
            {block.seatsLeft === 0
              ? "This block is full."
              : "Fewer than four weeks are left, so it isn’t taking new people."}{" "}
            You can start one like it: same goal, same date, same weekly sessions.
          </Notice>
          <Button
            variant="soft"
            label="Start one like it"
            loading={clone.isPending}
            onPress={() =>
              clone.mutate(
                { blockId: block.id, inviteCode: invite },
                {
                  onError: fail,
                  onSuccess: (b) =>
                    router.replace({ pathname: "/training-block/[id]", params: { id: b.id } }),
                },
              )
            }
          />
        </>
      )}

      {member && mine && block.inviteCode && running && (
        <Button
          variant="accent"
          label="Share invite link"
          onPress={() =>
            void Share.share({
              message: `${block.goalLabel} — train with me on SamePace: ${SITE_URL}/invite/${block.inviteCode}`,
            })
          }
        />
      )}
      {member && mine && running && block.slots.length < 4 && (
        <Button
          variant="soft"
          label="Add a weekly session"
          onPress={() => router.push({ pathname: "/post", params: { blockId: block.id } })}
        />
      )}
      {member && running && (
        <Button
          variant="ghost"
          label="Leave this goal"
          loading={leave.isPending}
          onPress={confirmLeave}
        />
      )}
    </Screen>
  );
}

function whenLine(block: TrainingBlock) {
  const left = daysUntil(block.goalDate);
  const toGo =
    left < 0
      ? "ended"
      : left === 0
        ? "today’s the day"
        : left < 14
          ? `${left} day${left === 1 ? "" : "s"} to go`
          : `${Math.round(left / 7)} weeks to go`;
  return `Week ${block.weekNumber} of ${block.weeks} · ${toGo} · ${formatDate(block.goalDate)}`;
}

const styles = StyleSheet.create({
  // The same frame a listing uses.
  tags: { flexWrap: "wrap", gap: 6 },
  section: { gap: Spacing.two },
  progress: { alignItems: "center", gap: Spacing.three },
  between: { justifyContent: "space-between" },
  flex: { flex: 1 },
  streak: { alignItems: "center" },
});
