import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
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
function useLiveFix() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
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
  }, []);

  return { fix, denied };
}

const PROMPTS: { key: keyof RatingInput; label: string }[] = [
  { key: "showedUp", label: "Showed up" },
  { key: "onTime", label: "On time" },
  { key: "matchedListing", label: "Level was as stated" },
  { key: "respectful", label: "Respectful" },
  { key: "wouldJoinAgain", label: "Would join again" },
];

export default function Live() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const me = useMe().data;
  const now = useNow(2000);
  const mine = useMine({ live: true });
  const venues = byId(useVenues().data);
  const { fix, denied } = useLiveFix();
  const geo = useGeoCheckIn();
  const byCode = useCodeCheckIn();
  const reveal = useRevealCode();
  const rate = useSubmitRating();
  const repeat = useRepeatWeekly();
  const [code, setCode] = useState("");
  const [shown, setShown] = useState<{ code: string; at: number } | null>(null);
  const [rating, setRating] = useState<RatingInput>({
    showedUp: true,
    onTime: true,
    matchedListing: true,
    respectful: true,
    wouldJoinAgain: true,
  });

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

  const booking = mine.data?.bookings.find((b) => b.id === id);
  const session = byId(mine.data?.sessions).get(booking?.sessionId ?? "");
  if (!booking || !session) {
    return (
      <Screen edges={["bottom"]}>
        <StateView loading={mine.isPending} error={mine.error} empty="No live seat." />
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

  return (
    <Screen edges={["bottom"]}>
      {done && (
        <View style={styles.success}>
          <SuccessMark>
            <Check size={32} color={theme.accent} strokeWidth={2.5} />
          </SuccessMark>
        </View>
      )}
      <View>
        <T variant="title">{done ? "Both checked in" : "Live session"}</T>
        <T color="textSecondary">
          {venue?.name} · {other?.name.split(" ")[0]}
        </T>
        <T variant="caption" color="textFaint">
          Window {formatTime(from)} – {formatTime(to)}
        </T>
      </View>

      <Row>
        <Status on={meIn} label="You" />
        <Status on={themIn} label={other?.name.split(" ")[0] ?? "Them"} />
      </Row>

      {session.pinHint && (
        <Card>
          <T variant="label">Where to meet</T>
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
                ? "Location is off"
                : away === null
                  ? "Finding you…"
                  : inside
                    ? `You’re ${away} m from the pin`
                    : `${away} m out — get inside ${GEOFENCE_M} m`}
            </T>
            <T variant="caption" color="textSecondary">
              Location is only read while this screen is open.
              {fix?.accuracyM ? ` GPS ±${Math.round(fix.accuracyM)} m.` : ""}
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
                label={!inWindow ? "Outside the check-in window" : meIn ? "You’re in" : "Check in"}
                disabled={!inWindow || meIn || !fix}
                loading={geo.isPending}
                onPress={() => fix && geo.mutate({ bookingId: booking.id, ...fix })}
              />
            )}
          </Card>

          <Card>
            <T variant="label">Session code</T>
            <T variant="caption" color="textSecondary">
              {isHost
                ? "Trails drop GPS. Show this to whoever joined — it’s good for 10 minutes and checks you both in."
                : "Trails drop GPS. Ask the poster for their 4-digit code."}
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
                  label={shown ? "New code" : "Reveal code"}
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
                    label="Their code"
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="0000"
                  />
                  <Button
                    variant="soft"
                    label="Enter code"
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
        <Notice>This seat is {booking.status.replace("_", " ")}.</Notice>
      )}

      {done && !booking.ratedByMe && (
        <Card>
          <T variant="label">How was {other?.name.split(" ")[0]}?</T>
          <T variant="caption" color="textSecondary">
            Five yes/no answers. No stars, no comments.
          </T>
          <View style={styles.prompts}>
            {PROMPTS.map((p) => (
              <Row key={p.key} style={styles.between}>
                <T>{p.label}</T>
                <Row>
                  <Chip
                    label="Yes"
                    selected={rating[p.key]}
                    onPress={() => setRating({ ...rating, [p.key]: true })}
                  />
                  <Chip
                    label="No"
                    selected={!rating[p.key]}
                    onPress={() => setRating({ ...rating, [p.key]: false })}
                  />
                </Row>
              </Row>
            ))}
          </View>
          <Button
            label="Submit"
            loading={rate.isPending}
            onPress={() =>
              rate.mutate({ bookingId: booking.id, rating }, { onSuccess: () => router.back() })
            }
          />
        </Card>
      )}
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
            {booking.seriesId ? "This is a standing slot" : "Worked? Make it a standing slot"}
          </T>
          <T variant="caption" color="textSecondary">
            {booking.seriesId
              ? "Same time next week is already on the calendar."
              : "Same people, same place, same time — every week until someone leaves. Skipping a week is free 12 hours ahead, and your seat goes to a substitute."}
          </T>
          {!booking.seriesId && (
            <Button
              variant="accent"
              label="Same time next week"
              loading={repeat.isPending}
              onPress={() => repeat.mutate(booking.id)}
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
      <T variant="caption" color="textSecondary">
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
});
