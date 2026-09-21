import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react-native";
import { Linking, StyleSheet, View } from "react-native";

import { Button, Card, Chip, Field, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { SuccessMark } from "@/components/motion";
import { ReportLink } from "@/components/report-link";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";
import { checkinWindow, distanceM, formatTime, inCheckinWindow } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { firstName } from "@/lib/names";
import {
  useCodeCheckIn,
  useGeoCheckIn,
  useMe,
  useMine,
  useRepeatWeekly,
  useRevealCode,
  useSubmitRating,
  useVenues,
} from "@/lib/queries";
import { GEOFENCE_M, type RatingInput } from "@/lib/types";

type Fix = { lat: number; lng: number; accuracyM?: number };

/** When-in-use location, only while this screen is open. No background tracking. */
function useLiveFix(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | undefined;
    let alive = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!alive) return;
      if (status !== "granted") return setDenied(true);
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
        (loc) =>
          setFix({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracyM: loc.coords.accuracy ?? undefined,
          }),
      );
      if (!alive) sub.remove();
    })().catch(() => setDenied(true));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [enabled]);

  return { fix, denied };
}

// "Showed up" isn't asked: this only appears once you've both checked in.
type Asked = "onTime" | "matchedListing" | "respectful" | "wouldJoinAgain";
const PROMPTS: { key: Asked; label: string }[] = [
  { key: "onTime", label: "On time?" },
  { key: "matchedListing", label: "Was the level as described?" },
  { key: "respectful", label: "Respectful?" },
  { key: "wouldJoinAgain", label: "Would you join them again?" },
];

/** Distances the way people here say them: feet up close, miles further out. */
function distanceLabel(metres: number) {
  const feet = metres * 3.28084;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  return `${(metres / 1609.34).toFixed(1)} mi`;
}
const FENCE_LABEL = "500 ft";

/** What a seat that isn't confirmed any more means, said to the person reading it. */
function closedReason(status: string, isHost: boolean, other: string) {
  switch (status) {
    case "cancelled":
    case "declined":
      return "This session isn’t on any more.";
    case "late_cancel":
    case "covered":
      return "This spot was cancelled.";
    case "no_show":
      return isHost
        ? `Check-in closed. ${other} didn’t check in.`
        : "Check-in closed before you checked in.";
    case "host_no_show":
      return isHost
        ? "Check-in closed before you checked in."
        : `Check-in closed. ${other} didn’t check in.`;
    case "void":
      return "Check-in closed and no one checked in.";
    case "pending":
      return "This request hasn’t been approved yet.";
    default:
      return "There’s nothing to check in to right now.";
  }
}

export default function Live() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const me = useMe().data;
  const now = useNow(2000);
  const mine = useMine({ live: true });
  const booking = mine.data?.bookings.find((b) => b.id === id);
  const session = byId(mine.data?.sessions).get(booking?.sessionId ?? "");
  const venues = byId(useVenues().data);
  const { fix, denied } = useLiveFix(
    booking?.status === "confirmed" && Boolean(session && inCheckinWindow(session.startAt, now)),
  );
  const geo = useGeoCheckIn();
  const byCode = useCodeCheckIn();
  const reveal = useRevealCode();
  const rate = useSubmitRating();
  const repeat = useRepeatWeekly();
  const [code, setCode] = useState("");
  const [shown, setShown] = useState<{ code: string; at: number } | null>(null);
  // No answer is pre-filled: a track record made of defaults means nothing.
  const [rating, setRating] = useState<Partial<Record<Asked, boolean>>>({});

  // A "you're 8 km out" rejection is stale the moment you walk inside the fence.
  const pin = venues.get(
    byId(mine.data?.sessions).get(mine.data?.bookings.find((b) => b.id === id)?.sessionId ?? "")
      ?.venueId ?? "",
  );
  const nowInside = Boolean(fix && pin && distanceM(fix, pin) <= GEOFENCE_M);
  const resetGeo = geo.reset;
  useEffect(() => {
    if (nowInside) resetGeo();
  }, [nowInside, resetGeo]);

  const slot = mine.data?.series.find((x) => x.id === booking?.seriesId);
  if (!booking || !session) {
    return (
      <Screen edges={["bottom"]}>
        <StateView
          loading={mine.isPending}
          error={mine.error}
          empty="There’s nothing to check in to right now."
        />
      </Screen>
    );
  }

  const isHost = booking.hostId === me?.id;
  const other = byId(mine.data?.people).get(isHost ? booking.participantId : booking.hostId);
  const venue = venues.get(session.venueId);
  const meIn = Boolean(isHost ? booking.hostCheckedInAt : booking.participantCheckedInAt);
  const themIn = Boolean(isHost ? booking.participantCheckedInAt : booking.hostCheckedInAt);
  const done = booking.status === "completed";
  const inWindow = inCheckinWindow(session.startAt, now);
  const { from, to } = checkinWindow(session.startAt);
  const away = fix && venue ? Math.round(distanceM(fix, venue)) : null;
  const inside = away !== null && away <= GEOFENCE_M;
  const error = geo.error ?? byCode.error ?? reveal.error ?? rate.error ?? repeat.error;
  const otherName = firstName(other?.name) ?? "your buddy";
  // Asked after the workout, not at the trailhead before it.
  const finished = now >= +new Date(session.startAt) + session.durationMin * 60_000;
  const answered = PROMPTS.every((q) => rating[q.key] !== undefined);

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: done ? "Checked in" : "Check in" }} />
      {done && (
        <View style={styles.success}>
          <SuccessMark>
            <Check size={32} color={theme.accent} strokeWidth={2.5} />
          </SuccessMark>
        </View>
      )}
      <View>
        <T variant="title">{done ? "You’re both here" : "Check in"}</T>
        <T color="textSecondary">
          {venue?.name} · with {otherName}
        </T>
        {!done && (
          <T variant="caption" color="textFaint">
            Check in between {formatTime(from)} and {formatTime(to)}
          </T>
        )}
      </View>

      <Row>
        <Status on={meIn} label="You" />
        <Status on={themIn} label={otherName} />
      </Row>

      {session.pinHint && (
        <Card>
          <T variant="label">Meeting point</T>
          <T variant="caption" color="textSecondary">
            {session.pinHint}
          </T>
        </Card>
      )}

      {error ? <Notice tone="danger">{error.message}</Notice> : null}

      {!done && booking.status === "confirmed" && (
        <>
          <Card>
            <T variant="label">
              {denied
                ? "Location is off for SamePace"
                : away === null
                  ? "Finding you…"
                  : inside
                    ? "You’re at the meeting point"
                    : `You’re about ${distanceLabel(away)} away`}
            </T>
            <T variant="caption" color="textSecondary">
              {denied
                ? "Turn it on in Settings, or use the backup code below."
                : `Check-in works within ${FENCE_LABEL} of the meeting point. Your location is only read while this screen is open.`}
            </T>
            {denied ? (
              <Button
                variant="soft"
                label="Open Settings"
                onPress={() => void Linking.openSettings()}
              />
            ) : (
              <Button
                variant="accent"
                label={
                  meIn
                    ? "Checked in"
                    : now < +from
                      ? `Check-in opens at ${formatTime(from)}`
                      : !inWindow
                        ? `Check-in closed at ${formatTime(to)}`
                        : "Check in"
                }
                disabled={!inWindow || meIn || !fix}
                loading={geo.isPending}
                onPress={() => fix && geo.mutate({ bookingId: booking.id, ...fix })}
              />
            )}
          </Card>

          <Card>
            <T variant="label">No GPS? Use a backup code</T>
            <T variant="caption" color="textSecondary">
              {isHost
                ? `Show this code to ${otherName}. It checks you both in and lasts 10 minutes.`
                : `Ask ${otherName} to tap “Show code”, then type the 4 digits here. It checks you both in.`}
            </T>
            {isHost ? (
              <>
                {shown && now - shown.at < 10 * 60_000 && (
                  <T
                    variant="mono"
                    style={styles.code}
                    accessibilityLabel={`Code ${shown.code.split("").join(" ")}`}
                  >
                    {shown.code}
                  </T>
                )}
                <Button
                  variant="soft"
                  label={shown ? "Get a new code" : "Show code"}
                  disabled={!inWindow}
                  loading={reveal.isPending}
                  onPress={() =>
                    reveal.mutate(session.id, {
                      onSuccess: (r) => setShown({ code: r.code, at: Date.now() }),
                    })
                  }
                />
              </>
            ) : (
              !meIn && (
                <>
                  <Field
                    label={`${otherName}’s code`}
                    value={code}
                    onChangeText={(v) => {
                      const digits = v.replace(/\D/g, "").slice(0, 4);
                      setCode(digits);
                      // The number pad has no Return key and can cover the button.
                      if (digits.length === 4 && inWindow && !byCode.isPending) {
                        byCode.mutate({ bookingId: booking.id, code: digits });
                      }
                    }}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="0000"
                  />
                  <Button
                    variant="soft"
                    label="Check in with code"
                    disabled={code.length !== 4 || !inWindow}
                    loading={byCode.isPending}
                    onPress={() => byCode.mutate({ bookingId: booking.id, code })}
                  />
                </>
              )
            )}
          </Card>
        </>
      )}

      {!done && booking.status !== "confirmed" && (
        <Notice>{closedReason(booking.status, isHost, otherName)}</Notice>
      )}

      {done && !finished && (
        <Notice>Have a good one. We’ll ask how it went once you’re done.</Notice>
      )}
      {done && finished && !booking.ratedByMe && (
        <Card>
          <T variant="label">How was it with {otherName}?</T>
          <T variant="caption" color="textSecondary">
            Four quick questions. {otherName} never sees your answers — only totals across everyone.
          </T>
          <View style={styles.prompts}>
            {PROMPTS.map((q) => (
              <Row key={q.key} style={styles.between}>
                <T style={styles.question}>{q.label}</T>
                <Row accessibilityRole="radiogroup" accessibilityLabel={q.label}>
                  <Chip
                    label="Yes"
                    selected={rating[q.key] === true}
                    onPress={() => setRating({ ...rating, [q.key]: true })}
                  />
                  <Chip
                    label="No"
                    selected={rating[q.key] === false}
                    onPress={() => setRating({ ...rating, [q.key]: false })}
                  />
                </Row>
              </Row>
            ))}
          </View>
          <Button
            variant="accent"
            label="Send"
            disabled={!answered}
            loading={rate.isPending}
            onPress={() =>
              rate.mutate({
                bookingId: booking.id,
                rating: { showedUp: true, ...(rating as Record<Asked, boolean>) } as RatingInput,
              })
            }
          />
        </Card>
      )}
      {done && booking.ratedByMe && <Notice>Thanks — that’s saved.</Notice>}
      {other && (
        <ReportLink
          memberId={other.id}
          name={other.name.split(" ")[0]}
          sessionId={session.id}
          bookingId={booking.id}
        />
      )}
      {done && (
        <Card>
          <T variant="label">
            {booking.substituteFor
              ? "You filled in this week"
              : booking.seriesId
                ? "This repeats every week"
                : "Do this every week?"}
          </T>
          <T variant="caption" color="textSecondary">
            {booking.substituteFor
              ? "This group meets weekly and you covered for someone who was away. They’re back in next week."
              : booking.seriesId
                ? "Next week is already on the calendar."
                : `Same people, place and time next week, and every week after. ${otherName} is added too. Anyone can skip a week for free with 12 hours’ notice, or leave the group any time. The usual cancel and no-show rules apply each week.`}
          </T>
          {!booking.seriesId && !booking.substituteFor && (
            <Button
              variant="accent"
              label="Same time next week"
              loading={repeat.isPending}
              onPress={() => repeat.mutate(booking.id)}
            />
          )}
          {slot && !slot.trainingBlockId && (
            <Button
              variant="soft"
              label="Train for a goal together"
              accessibilityHint="Gives this weekly session a goal and an end date"
              onPress={() =>
                router.replace({ pathname: "/training-block/new", params: { seriesId: slot.id } })
              }
            />
          )}
          {slot?.trainingBlockId && (
            <Button
              variant="soft"
              label="Open the goal"
              onPress={() =>
                router.replace({
                  pathname: "/training-block/[id]",
                  params: { id: slot.trainingBlockId! },
                })
              }
            />
          )}
        </Card>
      )}
      {done && booking.ratedByMe && (
        <Button variant="soft" label="Done" onPress={() => router.back()} />
      )}
    </Screen>
  );
}

function Status({ on, label }: { on: boolean; label: string }) {
  return (
    <Card style={styles.status}>
      <T
        variant="caption"
        color="textSecondary"
        accessibilityLabel={`${label}: ${on ? "checked in" : "not yet"}`}
      >
        {label}
      </T>
      <T variant="label" color={on ? "accent" : "textSecondary"}>
        {on ? "Checked in" : "Not yet"}
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  status: { flex: 1, gap: 0 },
  code: { textAlign: "center" },
  prompts: { gap: Spacing.one },
  success: { alignItems: "center", paddingTop: Spacing.two },
  between: { justifyContent: "space-between" },
  question: { flex: 1 },
});
