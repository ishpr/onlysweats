import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Clock, MapPin, Shield, Users } from "lucide-react-native";
import { useState } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";

import { venueImage } from "@/components/session-card";
import { Avatar, Badge, Button, Card, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { ReportLink } from "@/components/report-link";
import { SITE_URL } from "@/lib/config";
import {
  formatDayLong,
  formatDuration,
  formatTime,
  POLICY_LINE,
  inCheckinWindow,
  isLateCancel,
} from "@/lib/format";
import { byId } from "@/lib/lookup";
import {
  useBookingAction,
  useBookSeat,
  useCancelSession,
  useMe,
  useMine,
  useRefreshOnFocus,
  useSession,
  useVenues,
} from "@/lib/queries";
import { ACTIVITIES } from "@/lib/types";

export default function SessionDetail() {
  const { id, invite } = useLocalSearchParams<{ id: string; invite?: string }>();
  useRefreshOnFocus();
  const router = useRouter();
  const theme = useTheme();
  const now = useNow(15_000);
  const me = useMe().data;
  const q = useSession(id, invite);
  const mine = useMine();
  const venues = byId(useVenues().data);
  const book = useBookSeat();
  const act = useBookingAction();
  const cancelListing = useCancelSession();
  const [error, setError] = useState("");

  if (!q.data) {
    return (
      <Screen edges={[]}>
        <StateView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const { session } = q.data;
  const host = q.data.people[0];
  const venue = venues.get(session.venueId);
  const isHost = session.hostId === me?.id;
  const seats = (mine.data?.bookings ?? []).filter((b) => b.sessionId === session.id);
  const mySeat = seats.find(
    (b) =>
      b.participantId === me?.id &&
      (b.status === "pending" || b.status === "confirmed" || b.status === "completed"),
  );
  const requests = isHost ? seats.filter((b) => b.status === "pending") : [];
  const people = byId(mine.data?.people);
  const started = now >= +new Date(session.startAt);
  const liveSeat = isHost
    ? seats.find((b) => b.status === "confirmed")
    : mySeat?.status === "confirmed"
      ? mySeat
      : undefined;
  const live = Boolean(liveSeat) && inCheckinWindow(session.startAt, now);

  const fail = (err: Error) => setError(err.message);
  // On a block that still takes people, a free seat that isn't a substitute's is a
  // regular's: every week, so it's asked for on the block's page, never here.
  const regularSeat =
    Boolean(session.block?.joinable) && !session.substituteSeat && !isHost && !mySeat;

  function hold() {
    setError("");
    const go = () =>
      book.mutate(
        { sessionId: session.id, inviteCode: invite },
        {
          onError: fail,
          onSuccess: (b) => router.push({ pathname: "/thread/[id]", params: { id: b.id } }),
        },
      );
    go();
  }

  function release() {
    if (!mySeat) return;
    const late = mySeat.status === "confirmed" && isLateCancel(session.startAt);
    Alert.alert(
      session.seriesId ? "Skip this week?" : "Give up your seat?",
      late
        ? "It’s inside 12 hours: that’s a $5 fee, waived if someone takes your seat."
        : session.seriesId
          ? "No cost. Your seat opens to a substitute for this week, and you keep your place in the slot."
          : "No cost this far ahead. The seat reopens.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: session.seriesId ? "Skip this week" : "Give up seat",
          style: "destructive",
          onPress: () => act.mutate({ bookingId: mySeat.id, action: "cancel" }, { onError: fail }),
        },
      ],
    );
  }

  function closeListing() {
    Alert.alert(
      "Call this session off?",
      isLateCancel(session.startAt)
        ? "It’s inside 12 hours: if someone is confirmed, that’s the same $5 a joiner would pay."
        : "No cost this far ahead. Everyone is released.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Call it off",
          style: "destructive",
          onPress: () =>
            cancelListing.mutate(session.id, { onError: fail, onSuccess: () => router.back() }),
        },
      ],
    );
  }

  return (
    <Screen
      edges={["bottom"]}
      onRefresh={() => void Promise.all([q.refetch(), mine.refetch()])}
      refreshing={q.isRefetching}
    >
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
          {ACTIVITIES[session.activity].label} · {formatDayLong(session.startAt)}
        </T>
        <T variant="title">{session.title}</T>
        {session.detail ? <T color="textSecondary">{session.detail}</T> : null}
        {(session.visibility === "unlisted" || session.status !== "open") && (
          <Row>
            {session.visibility === "unlisted" && <Badge label="Unlisted" />}
            {session.status !== "open" && <Badge label={session.status} />}
          </Row>
        )}
      </View>

      <Card>
        <T variant="eyebrow" color="stand">
          Level{session.abilityFlex === "flexible" ? " · flexible" : ""}
        </T>
        <T variant="heading">{session.abilityLabel}</T>
        <T variant="caption" color="textSecondary">
          {session.abilityFlex === "flexible"
            ? "The poster will adjust to whoever joins."
            : session.fitsMe === false
              ? "This is outside the level on your profile."
              : session.fitsMe === null
                ? "Set your level under You to see what fits."
                : "Inside your level."}
        </T>
      </Card>

      {session.block ? (
        <Notice>
          {`Week ${session.block.weekNumber} of ${session.block.weeks} of a training block: ${session.block.goalLabel}. `}
          {session.substituteSeat
            ? "A regular is out this week — you’d fill in for this one only."
            : regularSeat
              ? "A seat here is a seat every week until the goal date."
              : "Same time every week until the goal date."}
        </Notice>
      ) : (
        session.seriesId && (
          <Notice>
            {session.substituteSeat
              ? "A standing slot with a regular out this week. You’d fill in for this occurrence only."
              : "A standing slot: same time every week until someone leaves it."}
          </Notice>
        )
      )}

      <Row>
        <Meta
          icon={Clock}
          label={formatTime(session.startAt)}
          value={formatDuration(session.durationMin)}
        />
        <Meta icon={Users} label={`${session.seatsLeft} open`} value={`${session.capacity} cap`} />
      </Row>
      <Row>
        <Meta
          icon={MapPin}
          label={venue?.neighborhood ?? ""}
          value={venue?.type.replace("_", " ") ?? ""}
        />
        <Meta
          icon={Shield}
          label={session.joinMode === "instant" ? "Instant join" : "Poster approves"}
          value={session.womenOnly ? "Women-only" : "Open to members"}
        />
      </Row>

      {host && (
        <Card>
          <Row>
            <Avatar initials={host.initials} accent={host.accent} />
            <View style={styles.flex}>
              <Row>
                <T variant="label">{host.name}</T>
              </Row>
              <T variant="caption" color="textSecondary">
                {reputationLine(host)}
              </T>
            </View>
          </Row>
          {!isHost && (
            <ReportLink
              memberId={host.id}
              name={host.name}
              sessionId={session.id}
              bookingId={mySeat?.id}
            />
          )}
        </Card>
      )}

      <Card>
        <T variant="label">{venue?.name ?? "The pin"}</T>
        <T variant="caption" color="textSecondary">
          {session.pinHint ??
            `${venue?.neighborhood ?? "Nearby"}. The exact meeting spot unlocks once you’re in.`}
        </T>
      </Card>

      <T variant="caption" color="textSecondary">
        {POLICY_LINE}
      </T>

      {requests.map((b) => (
        <Card key={b.id}>
          <T variant="label">{people.get(b.participantId)?.name ?? "Someone"} asked to join</T>
          <Row>
            <Button
              style={styles.flex}
              variant="soft"
              label="Decline"
              onPress={() => act.mutate({ bookingId: b.id, action: "decline" }, { onError: fail })}
            />
            <Button
              style={styles.flex}
              variant="accent"
              label="Approve"
              onPress={() => act.mutate({ bookingId: b.id, action: "approve" }, { onError: fail })}
            />
          </Row>
        </Card>
      ))}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {live && liveSeat ? (
        <Link href={{ pathname: "/live/[id]", params: { id: liveSeat.id } }} asChild>
          <Button variant="accent" label="Open live session" />
        </Link>
      ) : isHost ? (
        <>
          {session.inviteCode && (
            <Button
              variant="accent"
              label="Share invite link"
              onPress={() =>
                void Share.share({
                  message: `${session.title} — join me on SamePace: ${SITE_URL}/invite/${session.inviteCode}`,
                })
              }
            />
          )}
          {session.status === "open" && !started && (
            <Button
              variant="ghost"
              label="Cancel listing"
              loading={cancelListing.isPending}
              onPress={closeListing}
            />
          )}
        </>
      ) : mySeat ? (
        <>
          <Link href={{ pathname: "/thread/[id]", params: { id: mySeat.id } }} asChild>
            <Button
              variant="soft"
              label={mySeat.status === "pending" ? "Request pending · open thread" : "Open thread"}
            />
          </Link>
          {mySeat.status !== "completed" && !started && (
            <Button
              variant="ghost"
              label={session.seriesId ? "Skip this week" : "Give up my seat"}
              loading={act.isPending}
              onPress={release}
            />
          )}
        </>
      ) : regularSeat && session.block ? (
        <Button
          variant="accent"
          label="See the training block"
          onPress={() =>
            router.push({
              pathname: "/training-block/[id]",
              params: { id: session.block!.id, invite: invite ?? "" },
            })
          }
        />
      ) : (
        <Button
          label={
            session.status !== "open" || started
              ? "Closed"
              : session.seatsLeft === 0
                ? "Full"
                : session.substituteSeat
                  ? "Fill in this week"
                  : session.joinMode === "instant"
                    ? "I’m in"
                    : "Ask to join"
          }
          disabled={session.status !== "open" || started || session.seatsLeft === 0}
          loading={book.isPending}
          onPress={hold}
        />
      )}
    </Screen>
  );
}

/** No sessions yet means no record — not a perfect one. */
function reputationLine(p: { completedCount: number; onTimePct: number; wouldJoinPct: number }) {
  if (p.completedCount === 0) return "New on SamePace · no sessions yet";
  return `${p.completedCount} completed · ${p.onTimePct}% on time · ${p.wouldJoinPct}% would join again`;
}

function Meta({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.meta}>
      <Icon size={16} color={theme.textSecondary} />
      <T variant="label" style={styles.metaLabel}>
        {label}
      </T>
      <T variant="caption" color="textSecondary" style={styles.capitalize}>
        {value}
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { aspectRatio: 16 / 10, borderRadius: Radius.xxl, overflow: "hidden" },
  header: { gap: Spacing.one },
  flex: { flex: 1 },
  meta: { flex: 1, gap: 0, borderRadius: Radius.md + 2 },
  metaLabel: { marginTop: Spacing.one },
  capitalize: { textTransform: "capitalize" },
});
