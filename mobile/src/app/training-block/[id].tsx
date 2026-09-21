import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { ProgressRing } from "@/components/progress-ring";
import { ReportLink } from "@/components/report-link";
import { venueImage } from "@/components/session-card";
import { Avatar, Button, Card, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { daysUntil, formatDate, formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import {
  useLeaveTrainingBlock,
  useMe,
  useRefreshOnFocus,
  useTrainingBlock,
  useVenues,
} from "@/lib/queries";
import { ACTIVITIES, type Person, type TrainingBlock } from "@/lib/types";

/**
 * A training block: standing slots with a finish line. Progress is the sessions I
 * checked in to out of the ones I had — mine alone; nobody sees anyone else's.
 */
export default function TrainingBlockPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useRefreshOnFocus();
  const router = useRouter();
  const theme = useTheme();
  const me = useMe().data;
  const q = useTrainingBlock(id);
  const venues = byId(useVenues().data);
  const leave = useLeaveTrainingBlock();
  const [error, setError] = useState("");

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
  // A report always names a session: the next one these members share.
  const sessionId = block.slots.find((s) => s.nextSessionId)?.nextSessionId ?? undefined;

  function confirmLeave() {
    Alert.alert(
      "Leave this training block?",
      "You leave every weekly slot in it. Seats inside 12 hours follow the usual rule. With one person left, the block ends.",
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
      <View style={styles.hero}>
        <Image
          source={venueImage(venue)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          accessibilityLabel={venue?.name}
        />
        <LinearGradient
          colors={["transparent", "transparent", theme.background]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.header}>
        <T variant="eyebrow" color="textSecondary">
          {ACTIVITIES[block.activity].label} · training block
        </T>
        <T variant="title">{block.goalLabel}</T>
        <T color="textSecondary">{whenLine(block)}</T>
      </View>

      {block.status === "closing" && (
        <Notice>
          {block.my.finished
            ? `You finished it: ${block.my.kept} of ${block.my.planned} sessions kept.`
            : `This block reached its date. You kept ${block.my.kept} of ${block.my.planned} sessions.`}
        </Notice>
      )}

      <Card>
        <Row style={styles.progress}>
          <ProgressRing kept={block.my.kept} planned={block.my.planned} />
          <View style={styles.flex}>
            <T variant="eyebrow" color="stand">
              Your sessions kept
            </T>
            <T variant="caption" color="textSecondary">
              {block.my.planned === 0
                ? "Counts from your first check-in in this block."
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

      <View style={styles.section}>
        <T variant="heading">Every week</T>
        {block.slots.length === 0 && (
          <Card>
            <T variant="caption" color="textSecondary">
              No weekly slots are running.
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
        <T variant="heading">In this block</T>
        {people.map((p) => (
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
            {p.id !== me?.id && sessionId && (
              <ReportLink memberId={p.id} name={p.name} sessionId={sessionId} />
            )}
          </Card>
        ))}
      </View>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {running && (
        <Button
          variant="ghost"
          label="Leave this training block"
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

function reputationLine(p: Person) {
  if (p.completedCount === 0) return "New on SamePace · no sessions yet";
  return `${p.completedCount} completed · ${p.onTimePct}% on time · ${p.wouldJoinPct}% would join again`;
}

const styles = StyleSheet.create({
  // The same frame a listing uses.
  hero: { aspectRatio: 16 / 10, borderRadius: Radius.xxl, overflow: "hidden" },
  header: { gap: Spacing.one },
  section: { gap: Spacing.two },
  progress: { alignItems: "center", gap: Spacing.three },
  between: { justifyContent: "space-between" },
  flex: { flex: 1 },
  streak: { alignItems: "center" },
});
