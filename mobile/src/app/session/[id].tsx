import { useLocalSearchParams, useRouter } from "expo-router";
import { Clock, Flag, MapPin, Repeat, UserCheck, Users } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Linking, Platform, Share, StyleSheet, View } from "react-native";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { LeaveStandingSlot } from "@/components/leave-standing-slot";
import { OverflowMenu } from "@/components/overflow-menu";
import { PhotoCard, Tag } from "@/components/session-card";
import { useToast } from "@/components/toast";
import { Avatar, Button, Card, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { myLevelLabel } from "@/lib/ability";
import { SITE_URL } from "@/lib/config";
import {
  checkinWindow,
  formatDuration,
  formatTime,
  formatWhen,
  inCheckinWindow,
  isLateCancel,
} from "@/lib/format";
import { byId } from "@/lib/lookup";
import { firstName } from "@/lib/names";
import { reputationLine } from "@/lib/reputation";
import { useVerifyGate } from "@/lib/verify-gate";
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

const PLACE: Record<string, string> = {
  trail: "Trail",
  park: "Park",
  gym: "Gym",
  track: "Track",
  road_start: "Road",
};
const ENDED: Record<string, string> = { cancelled: "Cancelled", completed: "Finished" };

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
  const toVerify = useVerifyGate();
  const [justJoined, setJustJoined] = useState(false);
  const [confirm, setConfirm] = useState<"join" | "leave" | "cancel" | null>(null);
  const toast = useToast();

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
  const completed = seats.filter((b) => b.status === "completed");
  const standingSlot = mine.data?.series.find((slot) => slot.id === session.seriesId);
  const people = byId(mine.data?.people);
  const started = now >= +new Date(session.startAt);
  const liveSeat = isHost
    ? seats.find((b) => b.status === "confirmed")
    : mySeat?.status === "confirmed"
      ? mySeat
      : undefined;
  const live = Boolean(liveSeat) && inCheckinWindow(session.startAt, now);

  // "Verify first" isn't an error to show: it's somewhere to go.
  const fail = (err: Error) => {
    if (!toVerify(err)) setError(err.message);
  };
  // On a block that still takes people, a free seat that isn't a substitute's is a
  // regular's: every week, so it's asked for on the block's page, never here.
  const regularSeat =
    Boolean(session.block?.joinable) && !session.substituteSeat && !isHost && !mySeat;

  const hostName = firstName(host?.name) ?? "the host";
  const freeUntil = formatWhen(new Date(+new Date(session.startAt) - 12 * 3600_000).toISOString());

  /**
   * Joining is one tap. The cost is only said up front when it is real: inside the last
   * 12 hours, leaving after you join costs $5, so that join asks first.
   */
  const asking = session.joinMode !== "instant" && !session.substituteSeat;
  function commitJoin() {
    book.mutate(
      { sessionId: session.id, inviteCode: invite },
      {
        onError: (e) => {
          setConfirm(null);
          fail(e);
        },
        onSuccess: () => {
          setConfirm(null);
          setJustJoined(true);
          toast.show({
            message: asking
              ? `Asked ${hostName}. You’ll hear back before it starts.`
              : isLateCancel(session.startAt)
                ? "You’re in."
                : `You’re in. Free to leave until ${freeUntil}.`,
          });
        },
      },
    );
  }
  function join() {
    setError("");
    if (isLateCancel(session.startAt)) setConfirm("join");
    else commitJoin();
  }

  function commitRelease() {
    if (!mySeat) return;
    act.mutate(
      { bookingId: mySeat.id, action: "cancel" },
      {
        onError: (e) => {
          setConfirm(null);
          fail(e);
        },
        onSuccess: () => setConfirm(null),
      },
    );
  }
  function release() {
    if (!mySeat) return;
    // Withdrawing a request costs nothing and changes nothing for anyone: just do it.
    if (mySeat.status === "pending") {
      commitRelease();
      toast.show({ message: "Request withdrawn." });
    } else setConfirm("leave");
  }

  const closeListing = () => setConfirm("cancel");
  const lateLeave = mySeat?.status === "confirmed" && isLateCancel(session.startAt);
  const lateCancel = isLateCancel(session.startAt) && seats.some((b) => b.status === "confirmed");

  const joined = seats.filter((b) => b.status === "confirmed");
  const checkin = checkinWindow(session.startAt);
  const closed = session.status !== "open" || started;
  const status: string | null = ENDED[session.status]
    ? ENDED[session.status]
    : isHost
      ? joined.length > 0
        ? `Hosting · ${joined.length} joined`
        : "Hosting · no one yet"
      : mySeat?.status === "confirmed"
        ? "Joined"
        : mySeat?.status === "pending"
          ? "Waiting for approval"
          : mySeat?.status === "completed"
            ? "Finished"
            : null;

  const openMaps = () => {
    if (!venue) return;
    const q = encodeURIComponent(venue.name);
    void Linking.openURL(
      Platform.OS === "ios"
        ? `https://maps.apple.com/?ll=${venue.lat},${venue.lng}&q=${q}`
        : `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`,
    );
  };
  const share = () =>
    void Share.share({
      message: `Want to join my ${ACTIVITIES[session.activity].label.toLowerCase()} — ${formatWhen(session.startAt)} at ${venue?.name ?? "the meeting point"}? ${
        session.inviteCode ? `${SITE_URL}/invite/${session.inviteCode}` : SITE_URL
      }`,
    });
  const reportHost = () =>
    host &&
    router.push({
      pathname: "/report",
      params: {
        memberId: host.id,
        name: hostName,
        sessionId: session.id,
        bookingId: mySeat?.id ?? "",
      },
    });

  const joinLabel = session.substituteSeat
    ? "Fill in this week"
    : session.joinMode === "instant"
      ? "Join session"
      : "Ask to join";

  // One action, always in reach — whatever this session is to me right now.
  const footer: ReactNode =
    live && liveSeat ? (
      <Button
        variant="accent"
        label="Check in"
        onPress={() => router.push({ pathname: "/live/[id]", params: { id: liveSeat.id } })}
      />
    ) : isHost ? (
      closed ? null : (
        <Row>
          <Button style={styles.flex} variant="accent" label="Share" onPress={share} />
          {joined[0] && (
            <Button
              style={styles.flex}
              variant="soft"
              label="Agent chats"
              onPress={() => router.push("/inbox")}
            />
          )}
        </Row>
      )
    ) : mySeat ? (
      <Button
        variant={mySeat.status === "pending" ? "soft" : "accent"}
        label="Agent chats"
        onPress={() => router.push("/inbox")}
      />
    ) : regularSeat && session.block ? (
      <Button
        variant="accent"
        label="See the goal and join"
        onPress={() =>
          router.push({
            pathname: "/training-block/[id]",
            params: { id: session.block!.id, invite: invite ?? "" },
          })
        }
      />
    ) : closed ? null : (
      <>
        <Button
          variant="accent"
          label={session.seatsLeft === 0 ? "Full" : joinLabel}
          disabled={session.seatsLeft === 0}
          loading={book.isPending}
          onPress={join}
        />
        <T variant="caption" color="textFaint" style={styles.center}>
          {isLateCancel(session.startAt)
            ? "Free to join · starts in under 12 hours, so leaving costs $5"
            : `Free to join · free to leave until ${freeUntil}`}
        </T>
      </>
    );

  return (
    <Screen
      edges={["bottom"]}
      onRefresh={() => void Promise.all([q.refetch(), mine.refetch()])}
      footer={footer}
    >
      <PhotoCard
        venue={venue}
        minHeight={230}
        photoHeight={168}
        tags={
          <Row style={styles.tags}>
            <Tag label={ACTIVITIES[session.activity].label} />
            {status && <Tag label={status} tone={ENDED[session.status] ? "glass" : "accent"} />}
            {session.visibility === "unlisted" && <Tag label="Invite-only" />}
            {session.womenOnly && <Tag label="Women-only" />}
          </Row>
        }
      >
        <T variant="title">{formatWhen(session.startAt)}</T>
        <T variant="label" color="textSecondary">
          {formatDuration(session.durationMin)} · {venue?.name ?? ""}
        </T>
      </PhotoCard>

      <View style={styles.header}>
        <T variant="heading">{session.title}</T>
        {session.detail ? <T color="textSecondary">{session.detail}</T> : null}
      </View>

      {justJoined && mySeat && (
        <Notice>
          {mySeat.status === "pending"
            ? `Request sent. ${hostName} will approve or decline — we’ll tell you either way.`
            : "You’ve joined. The meeting point is below. Your agents’ planning conversations are in Chats."}
        </Notice>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {(isHost || mySeat?.status === "confirmed" || mySeat?.status === "completed") && (
        <Card>
          <T variant="heading">Our workout plan</T>
          <T color="textSecondary">
            Follow the same exercises and instructions, with your own sets and progress.
          </T>
          <Button
            label="Open workout plan"
            variant="soft"
            onPress={() =>
              router.push({ pathname: "/session-workout/[id]", params: { id: session.id } })
            }
          />
        </Card>
      )}
      <Card>
        <Fact icon={Clock} label="Level" value={session.abilityLabel}>
          {session.abilityFlex === "flexible"
            ? `Any level welcome — ${hostName} will adjust to your pace.`
            : session.fitsMe === true
              ? "Fits your level."
              : session.fitsMe === false
                ? "Outside the level you set. You can still join."
                : null}
        </Fact>
        {session.fitsMe === null && session.abilityFlex !== "flexible" && (
          <Button
            variant="soft"
            label="Set my level to see if this fits"
            onPress={() => router.push("/welcome")}
          />
        )}
        <Fact
          icon={Users}
          label="Spots"
          value={
            session.seatsLeft === 0
              ? "Full"
              : `${session.seatsLeft} of ${session.capacity - 1} left`
          }
        />
        <Fact
          icon={UserCheck}
          label="Joining"
          value={
            session.joinMode === "instant" ? "Join instantly" : `${hostName} approves each person`
          }
        />
        {(session.block || session.seriesId) && (
          <Fact icon={Repeat} label="Repeats" value="Every week">
            {session.block
              ? `Week ${session.block.weekNumber} of ${session.block.weeks} toward ${session.block.goalLabel}. ${
                  session.substituteSeat
                    ? "Someone’s away, so there’s a spot for this week only."
                    : regularSeat
                      ? "Joining means every week until the goal date."
                      : ""
                }`
              : session.substituteSeat
                ? "This group meets every week. Someone’s away, so there’s a spot for this week only."
                : "Same time every week."}
          </Fact>
        )}
      </Card>

      {host && (
        <Card>
          <Row>
            <Avatar initials={host.initials} accent={host.accent} />
            <View style={styles.flex}>
              <T variant="label">{isHost ? "You’re hosting" : `Hosted by ${hostName}`}</T>
              <T variant="caption" color="textSecondary">
                {reputationLine(host)}
              </T>
            </View>
            {!isHost && (
              <OverflowMenu
                accessibilityLabel={`More about ${hostName}`}
                items={[
                  {
                    icon: Flag,
                    label: `Report or block ${hostName}`,
                    danger: true,
                    onPress: reportHost,
                  },
                ]}
              />
            )}
          </Row>
        </Card>
      )}

      <Card style={session.pinHint ? { borderColor: theme.accent, borderWidth: 1 } : undefined}>
        <Row>
          <MapPin size={18} color={session.pinHint ? theme.accent : theme.textSecondary} />
          <T variant="label" style={styles.flex}>
            {session.pinHint ? "Meeting point" : (venue?.name ?? "Meeting point")}
          </T>
          {venue && (
            <T variant="caption" color="textSecondary">
              {PLACE[venue.type] ?? ""} · {venue.neighborhood}
            </T>
          )}
        </Row>
        <T color={session.pinHint ? "text" : "textSecondary"}>
          {session.pinHint ?? "You’ll see the exact meeting point after you join."}
        </T>
        {session.pinHint && <Button variant="soft" label="Open in Maps" onPress={openMaps} />}
      </Card>

      {/* Joined, but it isn't time yet: say when check-in opens, and let them see the screen. */}
      {!closed && liveSeat && !live && (
        <Card>
          <T variant="label">Check-in</T>
          <T variant="caption" color="textSecondary">
            Opens at {formatTime(checkin.from)}, 20 minutes before the start, and closes at{" "}
            {formatTime(checkin.to)}. You both check in at the meeting point — your phone confirms
            you’re there, or you use a 4-digit backup code.
          </T>
          <Button
            variant="soft"
            label="See the check-in screen"
            onPress={() => router.push({ pathname: "/live/[id]", params: { id: liveSeat.id } })}
          />
        </Card>
      )}

      {!closed && !isHost && (
        <Card>
          <T variant="label">If plans change</T>
          <T variant="caption" color="textSecondary">
            Free to leave until {freeUntil}. After that it’s $5, waived if someone takes your spot.
            Not showing up is $10 and a strike — two strikes in 60 days pauses public sessions for
            14 days. The same rules apply to {hostName}. Nothing is charged to a card today.
          </T>
        </Card>
      )}

      {requests.map((b) => {
        const who = people.get(b.participantId);
        const level = who ? myLevelLabel(session.activity, who.abilities) : null;
        return (
          <Card key={b.id}>
            <T variant="label">{firstName(who?.name) ?? "Someone"} asked to join</T>
            <T variant="caption" color="textSecondary">
              {who ? reputationLine(who) : ""}
              {level ? ` · ${level}` : ""}
            </T>
            <Row>
              <Button
                style={styles.flex}
                variant="soft"
                label="Decline"
                onPress={() =>
                  act.mutate({ bookingId: b.id, action: "decline" }, { onError: fail })
                }
              />
              <Button
                style={styles.flex}
                variant="accent"
                label="Approve"
                onPress={() =>
                  act.mutate({ bookingId: b.id, action: "approve" }, { onError: fail })
                }
              />
            </Row>
          </Card>
        );
      })}

      {completed.map((b) => (
        <Card key={b.id}>
          <T variant="label">
            Finished with{" "}
            {firstName(isHost ? people.get(b.participantId)?.name : host?.name) ?? "your buddy"}
          </T>
          <Button
            variant="soft"
            label={
              b.ratedByMe ? "See how it went · make it weekly" : "How was it? · make it weekly"
            }
            onPress={() => router.push({ pathname: "/live/[id]", params: { id: b.id } })}
          />
        </Card>
      ))}

      {!closed && isHost && (
        <Button
          variant="ghost"
          label="Cancel session"
          loading={cancelListing.isPending}
          onPress={closeListing}
        />
      )}
      {!closed && !isHost && mySeat && mySeat.status !== "completed" && (
        <Button
          variant="ghost"
          label={
            session.seriesId
              ? "Skip this week"
              : mySeat.status === "pending"
                ? "Withdraw request"
                : "Leave session"
          }
          loading={act.isPending}
          onPress={release}
        />
      )}
      {standingSlot &&
        (standingSlot.trainingBlockId ? (
          <Button
            variant="soft"
            label="Manage this goal"
            onPress={() =>
              router.push({
                pathname: "/training-block/[id]",
                params: { id: standingSlot.trainingBlockId! },
              })
            }
          />
        ) : (
          <LeaveStandingSlot seriesId={standingSlot.id} />
        ))}
      <ConfirmSheet
        visible={confirm === "join"}
        onClose={() => setConfirm(null)}
        title={asking ? `Ask to join ${session.title}?` : `Join ${session.title}?`}
        body="It starts in less than 12 hours, so leaving after you join costs $5 — waived if someone takes your spot. Not showing up is $10 and a strike."
        confirm={{ label: asking ? "Ask to join" : "Join", onPress: commitJoin }}
        cancelLabel="Not now"
        busy={book.isPending}
      />
      <ConfirmSheet
        visible={confirm === "leave"}
        onClose={() => setConfirm(null)}
        title={session.seriesId ? "Skip this week?" : "Leave this session?"}
        body={
          lateLeave
            ? "It’s less than 12 hours away, so leaving costs $5. It’s waived if someone takes your spot."
            : session.seriesId
              ? "Free. Your spot opens to a fill-in for this week, and you stay in the group."
              : "Free to leave this far ahead."
        }
        confirm={{
          label: session.seriesId ? "Skip this week" : "Leave",
          danger: true,
          onPress: commitRelease,
        }}
        cancelLabel="Stay"
        busy={act.isPending}
      />
      <ConfirmSheet
        visible={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        title="Cancel this session?"
        body={
          lateCancel
            ? "It’s less than 12 hours away and someone has joined, so cancelling now costs $5 — the same fee a buddy would pay."
            : "Free to cancel. Anyone who joined will be told."
        }
        confirm={{
          label: "Cancel session",
          danger: true,
          onPress: () =>
            cancelListing.mutate(session.id, {
              onError: (e) => {
                setConfirm(null);
                fail(e);
              },
              onSuccess: () => router.back(),
            }),
        }}
        cancelLabel="Keep it"
        busy={cancelListing.isPending}
      />
    </Screen>
  );
}

/** One line of the decision: a label, its value, and a sentence only when it helps. */
function Fact({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Row>
        <Icon size={16} color={theme.textSecondary} />
        <T variant="caption" color="textSecondary" style={styles.factLabel}>
          {label}
        </T>
        <T variant="label" style={styles.factValue}>
          {value}
        </T>
      </Row>
      {children ? (
        <T variant="caption" color="textSecondary">
          {children}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tags: { flexWrap: "wrap", gap: 6 },
  header: { gap: Spacing.one },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fact: { gap: 2 },
  factLabel: { width: 64 },
  factValue: { flex: 1, textAlign: "right" },
});
