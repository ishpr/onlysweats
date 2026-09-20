import { Link, useRouter } from "expo-router";
import { CalendarDays } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { AppHeader, LiveBanner } from "@/components/brand";
import { PushPrompt } from "@/components/push-cards";
import { SessionCard } from "@/components/session-card";
import { Enter } from "@/components/motion";
import { Card, EmptyState, Row, Screen, StateView, T } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { Spacing } from "@/constants/theme";
import { formatWhen, greeting, inCheckinWindow } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { useMe, useMine, useRefreshOnFocus, useSessions, useVenues } from "@/lib/queries";

const SOON_MS = 48 * 3600_000;

export default function Today() {
  useRefreshOnFocus();
  const router = useRouter();
  const now = useNow(15_000);
  const me = useMe();
  const mine = useMine();
  const open = useSessions();
  const venues = byId(useVenues().data);

  const mySessions = byId(mine.data?.sessions);
  const upcoming = (mine.data?.bookings ?? [])
    .filter((b) => b.status === "confirmed" || b.status === "pending")
    .map((b) => ({ booking: b, session: mySessions.get(b.sessionId) }))
    .filter((x) => x.session)
    .sort((a, b) => +new Date(a.session!.startAt) - +new Date(b.session!.startAt));
  const live = upcoming.find(
    (x) => x.booking.status === "confirmed" && inCheckinWindow(x.session!.startAt, now),
  );
  const soon = (open.data?.sessions ?? []).filter(
    (s) => +new Date(s.startAt) - now < SOON_MS && s.hostId !== me.data?.id,
  );

  const refresh = () => void Promise.all([mine.refetch(), open.refetch(), me.refetch()]);

  return (
    <Screen
      onRefresh={refresh}
      refreshing={mine.isRefetching || open.isRefetching}
      header={
        <>
          <AppHeader />
          {live && <LiveBanner bookingId={live.booking.id} />}
        </>
      }
    >
      <View>
        <T color="textSecondary">{greeting()}</T>
        <T variant="title">{me.data?.name.split(" ")[0] ?? " "}</T>
      </View>

      {/* Ask once there's something worth hearing about. */}
      {upcoming.length > 0 && <PushPrompt />}

      {me.data && me.data.creditCents > 0 && (
        <Card>
          <T variant="label">${me.data.creditCents / 100} membership credit</T>
          <T variant="caption" color="textSecondary">
            You showed up and they didn’t. It comes off your membership.
          </T>
        </Card>
      )}

      {upcoming.length > 0 && (
        <View style={styles.section}>
          <T variant="heading">Your seats</T>
          {upcoming.map(({ booking, session }) => (
            <Link
              key={booking.id}
              href={{ pathname: "/thread/[id]", params: { id: booking.id } }}
              asChild
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${session!.title}, ${formatWhen(session!.startAt)}`}
              >
                <Card>
                  <Row style={styles.between}>
                    <View style={styles.flex}>
                      <T variant="label">{session!.title}</T>
                      <T variant="caption" color="textSecondary">
                        {formatWhen(session!.startAt)} · {venues.get(session!.venueId)?.name}
                      </T>
                    </View>
                    <T
                      variant="caption"
                      color={booking.status === "pending" ? "textSecondary" : "accent"}
                    >
                      {booking.status === "pending"
                        ? "Requested"
                        : booking.hostId === me.data?.id
                          ? "You posted"
                          : "You’re in"}
                    </T>
                  </Row>
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      )}

      {(mine.data?.series.length ?? 0) > 0 && (
        <View style={styles.section}>
          <T variant="heading">Standing slots</T>
          {mine.data!.series.map((slot) => (
            <Link
              key={slot.id}
              href={
                slot.nextSessionId
                  ? { pathname: "/session/[id]", params: { id: slot.nextSessionId } }
                  : "/sessions"
              }
              asChild
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${slot.title}, every week, ${slot.streak} in a row`}
              >
                <Card>
                  <Row style={styles.between}>
                    <View style={styles.flex}>
                      <T variant="label">{slot.title}</T>
                      <T variant="caption" color="textSecondary">
                        {slot.abilityLabel} · {venues.get(slot.venueId)?.name}
                      </T>
                      <T variant="caption" color="textSecondary">
                        {slot.nextStartAt ? `Next: ${formatWhen(slot.nextStartAt)}` : "Every week"}
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
            </Link>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Row style={styles.between}>
          <T variant="heading">Next 48 hours</T>
          <Link href="/sessions">
            <T variant="caption" color="textSecondary">
              All listings
            </T>
          </Link>
        </Row>
        {open.isPending || open.error ? (
          <StateView
            loading={open.isPending}
            error={open.error}
            onRetry={() => void open.refetch()}
          />
        ) : soon.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing in the next two days"
            body="Post the workout you’re doing anyway — or invite someone you already know with a link."
            action={{ label: "Post a session", onPress: () => router.push("/post") }}
            secondary={{
              label: "Invite someone you know",
              onPress: () => router.push({ pathname: "/post", params: { unlisted: "1" } }),
            }}
          />
        ) : (
          soon.map((s, i) => (
            <Enter key={s.id} index={i}>
              <SessionCard session={s} venue={venues.get(s.venueId)} />
            </Enter>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  between: { justifyContent: "space-between" },
  flex: { flex: 1 },
  streak: { alignItems: "center" },
});
