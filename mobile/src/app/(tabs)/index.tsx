import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Repeat, Target } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppHeader, LiveBanner } from "@/components/brand";
import { LeaveStandingSlot } from "@/components/leave-standing-slot";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { Enter, PressScale } from "@/components/motion";
import { PushPrompt } from "@/components/push-cards";
import { AssistantSpot } from "@/components/assistant-hero";
import { TodayCard, TrainingShortcuts } from "@/components/today-card";
import { PhotoCard, SessionCard, Tag, type MineTag } from "@/components/session-card";
import { Button, Card, Field, Row, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { myLevelLabel } from "@/lib/ability";
import { daysUntil, formatUsd, formatWhen, greeting, inCheckinWindow } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { firstName, nameNeedsFixing } from "@/lib/names";
import {
  useBookingAction,
  useMe,
  useMine,
  useRefreshOnFocus,
  useSessions,
  useUpdateMe,
  useVenues,
} from "@/lib/queries";
import { reputationLine } from "@/lib/reputation";
import type { Booking, Session } from "@/lib/types";

const SOON_MS = 48 * 3600_000;

/** One of my sessions, whichever side of it I'm on. */
type Plan = { session: Session; tag: MineTag; booking?: Booking; joined: number };

/**
 * Home is mine: what I'm doing next, what's waiting on me, what repeats. Browsing
 * lives on Find — here it's only a few picks at my level, and only after my own
 * plans.
 */
export default function Home() {
  useRefreshOnFocus();
  const router = useRouter();
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const me = useMe();
  const theme = useTheme();
  const mine = useMine();
  const open = useSessions();
  const venues = byId(useVenues().data);
  const people = byId(mine.data?.people);
  const act = useBookingAction();
  const [openRow, setOpenRow] = useState<string | null>(null);

  const meId = me.data?.id;
  const bookings = mine.data?.bookings ?? [];
  const active = bookings.filter((b) => b.status === "confirmed" || b.status === "pending");

  const plans: Plan[] = (mine.data?.sessions ?? [])
    .filter((s) => s.status === "open" && +new Date(s.startAt) + s.durationMin * 60_000 > now)
    .flatMap((session): Plan[] => {
      const seats = active.filter((b) => b.sessionId === session.id);
      if (session.hostId === meId) {
        const joined = seats.filter((b) => b.status === "confirmed");
        return [{ session, tag: "Hosting", booking: joined[0], joined: joined.length }];
      }
      const seat = seats.find((b) => b.participantId === meId);
      if (!seat) return [];
      const tag: MineTag = seat.status === "pending" ? "Waiting for approval" : "Joined";
      return [{ session, tag, booking: seat, joined: 0 }];
    })
    .sort((a, b) => +new Date(a.session.startAt) - +new Date(b.session.startAt));

  const [next, ...later] = plans;
  const live = plans.find(
    (p) => p.booking?.status === "confirmed" && inCheckinWindow(p.session.startAt, now),
  );
  const requests = active.filter((b) => b.hostId === meId && b.status === "pending");

  const goals = mine.data?.trainingBlocks ?? [];
  const toWrapUp = goals.filter(
    (g) => (g.ending?.creditsOpen && g.ending.creditable.length > 0) || g.ending?.slotsUndecided,
  );
  // A goal lists its own weekly sessions; don't show them twice.
  const weekly = (mine.data?.series ?? []).filter((s) => !s.trainingBlockId);

  const mineIds = new Set(plans.map((p) => p.session.id));
  const picks = (open.data?.sessions ?? [])
    .filter((s) => !mineIds.has(s.id) && s.seatsLeft > 0 && +new Date(s.startAt) > now)
    .filter((s) => +new Date(s.startAt) - now < SOON_MS)
    // At my level first; anything I can't judge after; never what doesn't fit.
    .filter((s) => s.fitsMe !== false)
    .sort((a, b) => Number(b.fitsMe === true) - Number(a.fitsMe === true))
    .slice(0, 3);

  const levelSet = Object.keys(me.data?.abilities ?? {}).length > 0;
  const name = firstName(me.data?.name);
  const refresh = () =>
    void Promise.all([
      mine.refetch(),
      open.refetch(),
      me.refetch(),
      queryClient.invalidateQueries({ queryKey: ["private-health", meId] }),
    ]);

  return (
    <Screen
      hidesTabBar
      contentStyle={styles.content}
      onRefresh={refresh}
      header={
        <>
          <AppHeader />
          {live?.booking && <LiveBanner bookingId={live.booking.id} />}
        </>
      }
    >
      <T variant="heading" color="textSecondary">
        {greeting()}
        {name ? (
          <T variant="heading">
            {", "}
            {name}
          </T>
        ) : null}
      </T>

      {/* Today leads: how the day looks, then what's planned for it. */}
      {meId && (
        <TodayCard
          key={meId}
          ownerId={meId}
          sessions={(open.data?.sessions ?? []).filter(
            (s) => !mineIds.has(s.id) && s.seatsLeft > 0 && +new Date(s.startAt) > now,
          )}
        />
      )}

      {(!me.data || me.error || mine.error) && (
        <Button
          label="Saved workouts on this iPhone"
          variant="soft"
          onPress={() => router.push("/workout-plans")}
        />
      )}

      {mine.isPending ? (
        <StateView loading rows={2} />
      ) : mine.error ? (
        <StateView error={mine.error} onRetry={refresh} />
      ) : (
        <>
          {/* No real name yet (an email handle, "Member", or all capitals): ask, once, here. */}
          {nameNeedsFixing(me.data?.name) && <NamePrompt />}

          {next ? (
            <NextUp plan={next} now={now} withName={otherName(next, people, meId)} />
          ) : (
            // Compact, so both ways forward sit above the fold under Today.
            <Card>
              <Row style={styles.planRow}>
                <View style={[styles.planIcon, { backgroundColor: theme.accentSoft }]}>
                  <CalendarDays size={20} color={theme.accent} />
                </View>
                <View style={styles.flex}>
                  <T variant="label">Nothing planned yet</T>
                  <T variant="caption" color="textSecondary">
                    Find a buddy doing your workout at your level — or post yours.
                  </T>
                </View>
              </Row>
              <Row>
                <Button
                  style={styles.flex}
                  variant="soft"
                  label="Post a session"
                  onPress={() => router.push("/post")}
                />
                <Button
                  style={styles.flex}
                  variant="accent"
                  label="Find a session"
                  onPress={() => router.push("/sessions")}
                />
              </Row>
            </Card>
          )}

          {/* The assistant gets its own row: alive when it is working for you. */}
          {meId && <AssistantSpot key={`assistant-${meId}`} ownerId={meId} />}
          <TrainingShortcuts />

          {!levelSet && (
            <Card>
              <T variant="label">Set your level</T>
              <T variant="caption" color="textSecondary">
                It takes ten seconds, and it’s how we show you sessions that fit.
              </T>
              <Button
                variant="accent"
                label="Set my level"
                onPress={() => router.push("/welcome")}
              />
            </Card>
          )}

          {(plans.length > 0 || requests.length > 0) && <PushPrompt />}

          {requests.length > 0 && (
            <View style={styles.section}>
              <SectionTitle>Waiting on you</SectionTitle>
              {requests.map((b) => {
                const who = people.get(b.participantId);
                const session = plans.find((p) => p.session.id === b.sessionId)?.session;
                const level = who && session ? myLevelLabel(session.activity, who.abilities) : null;
                return (
                  <Card key={b.id}>
                    <T variant="label">
                      {firstName(who?.name) ?? "Someone"} asked to join{" "}
                      {session?.title ?? "your session"}
                    </T>
                    <T variant="caption" color="textSecondary">
                      {who ? reputationLine(who) : ""}
                      {level ? ` · ${level}` : ""}
                    </T>
                    <Row>
                      <Button
                        style={styles.flex}
                        variant="soft"
                        label="Decline"
                        loading={act.isPending && act.variables?.bookingId === b.id}
                        onPress={() => act.mutate({ bookingId: b.id, action: "decline" })}
                      />
                      <Button
                        style={styles.flex}
                        variant="accent"
                        label="Approve"
                        loading={act.isPending && act.variables?.bookingId === b.id}
                        onPress={() => act.mutate({ bookingId: b.id, action: "approve" })}
                      />
                    </Row>
                  </Card>
                );
              })}
              {act.error && (
                <T variant="caption" color="danger">
                  {act.error.message}
                </T>
              )}
            </View>
          )}

          {toWrapUp.map((g) => (
            <Card key={g.id}>
              <T variant="label">
                {g.my.finished
                  ? `You finished ${g.goalLabel}`
                  : `${g.goalLabel} has reached its date`}
              </T>
              <T variant="caption" color="textSecondary">
                {g.ending?.creditsOpen && g.ending.creditable.length > 0
                  ? "Say who helped you stick to it, and whether the weekly sessions carry on."
                  : "The weekly sessions have stopped. Set a new goal, keep them going, or let them end."}
              </T>
              <Button
                variant="accent"
                label="Wrap it up"
                onPress={() =>
                  router.push({ pathname: "/training-block/[id]", params: { id: g.id } })
                }
              />
            </Card>
          ))}

          {me.data && me.data.creditCents > 0 && (
            <Card>
              <T variant="label">{formatUsd(me.data.creditCents)} credit</T>
              <T variant="caption" color="textSecondary">
                Your buddy didn’t make it last time, so this is on us. It comes off your membership
                when that starts.
              </T>
            </Card>
          )}

          {later.length > 0 && (
            <View style={styles.section}>
              <SectionTitle>Coming up</SectionTitle>
              <ListCard>
                {later.map((p) => (
                  <ListRow
                    key={p.session.id}
                    label={p.session.title}
                    detail={`${formatWhen(p.session.startAt)} · ${planStatus(p)}`}
                    onPress={() =>
                      router.push({ pathname: "/session/[id]", params: { id: p.session.id } })
                    }
                  />
                ))}
              </ListCard>
            </View>
          )}

          {(goals.length > 0 || weekly.length > 0) && (
            <View style={styles.section}>
              <SectionTitle>Every week</SectionTitle>
              <ListCard>
                {goals.map((g) => (
                  <ListRow
                    key={g.id}
                    icon={Target}
                    label={g.goalLabel}
                    detail={
                      g.ending
                        ? g.my.finished
                          ? "Finished"
                          : "Reached its date"
                        : `${g.my.kept} of ${g.my.planned} kept · ${weeksToGo(g.goalDate)}`
                    }
                    onPress={() =>
                      router.push({ pathname: "/training-block/[id]", params: { id: g.id } })
                    }
                  />
                ))}
                {weekly.map((w) => (
                  <ListRow
                    key={w.id}
                    icon={Repeat}
                    label={w.title}
                    detail={
                      w.nextStartAt
                        ? `Next ${formatWhen(w.nextStartAt)}${w.streak > 0 ? ` · ${w.streak} in a row` : ""}`
                        : "Every week"
                    }
                    expanded={openRow === w.id}
                    onPress={() => setOpenRow(openRow === w.id ? null : w.id)}
                  >
                    <View style={styles.manage}>
                      {w.nextSessionId && (
                        <Button
                          variant="soft"
                          label="See next week’s session"
                          onPress={() =>
                            router.push({
                              pathname: "/session/[id]",
                              params: { id: w.nextSessionId! },
                            })
                          }
                        />
                      )}
                      <Button
                        variant="soft"
                        label="Train for a goal together"
                        accessibilityHint="Gives this weekly session a goal and an end date"
                        onPress={() =>
                          router.push({
                            pathname: "/training-block/new",
                            params: { seriesId: w.id },
                          })
                        }
                      />
                      <LeaveStandingSlot seriesId={w.id} />
                    </View>
                  </ListRow>
                ))}
              </ListCard>
            </View>
          )}

          <View style={styles.section}>
            <Row style={styles.between}>
              <SectionTitle>
                {levelSet ? "At your level · next 2 days" : "Next 2 days"}
              </SectionTitle>
              <PressScale
                accessibilityRole="link"
                accessibilityLabel="Find more sessions"
                onPress={() => router.push("/sessions")}
                style={styles.more}
              >
                <T variant="caption" color="accent">
                  Find more
                </T>
              </PressScale>
            </Row>
            {open.isPending ? (
              <StateView loading rows={1} />
            ) : picks.length === 0 ? (
              <T variant="caption" color="textSecondary">
                Nothing new {levelSet ? "at your level " : ""}in the next two days. Find has the
                full two weeks.
              </T>
            ) : (
              picks.map((s, i) => (
                <Enter key={s.id} index={i}>
                  <SessionCard session={s} venue={venues.get(s.venueId)} />
                </Enter>
              ))
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

/** What other members will call you. Shown on Home until there's a real first name. */
function NamePrompt() {
  const update = useUpdateMe();
  const [name, setName] = useState("");
  return (
    <Card>
      <T variant="label">What should your buddy call you?</T>
      <T variant="caption" color="textSecondary">
        Just a first name. It’s what people see when you join or host a session.
      </T>
      <Field
        label="First name"
        value={name}
        onChangeText={setName}
        autoComplete="given-name"
        maxLength={40}
        returnKeyType="done"
      />
      {update.error && (
        <T variant="caption" color="danger">
          {update.error.message}
        </T>
      )}
      <Button
        variant="accent"
        label="Save"
        disabled={!name.trim()}
        loading={update.isPending}
        onPress={() => update.mutate({ name: name.trim() })}
      />
    </Card>
  );
}

function otherName(
  plan: Plan,
  people: Map<string, { name: string }>,
  meId?: string,
): string | null {
  if (!plan.booking) return null;
  const otherId = plan.booking.hostId === meId ? plan.booking.participantId : plan.booking.hostId;
  return firstName(people.get(otherId)?.name);
}

const planStatus = (p: Plan) =>
  p.tag === "Hosting"
    ? p.joined > 0
      ? `Hosting · ${p.joined} joined`
      : "Hosting · no one yet"
    : p.tag;

/** "in 25 min", "in 9 h", or the day and time once it's further out. */
function until(startAt: string, now: number) {
  const min = Math.round((+new Date(startAt) - now) / 60_000);
  if (min <= 0) return "Now";
  if (min < 60) return `in ${min} min`;
  if (min < 12 * 60)
    return `in ${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim();
  return formatWhen(startAt);
}

/** The next thing I've committed to — the one card on Home that should win the eye. */
function NextUp({ plan, now, withName }: { plan: Plan; now: number; withName: string | null }) {
  const router = useRouter();
  const venues = byId(useVenues().data);
  const { session, booking } = plan;
  const venue = venues.get(session.venueId);
  const checkIn = booking?.status === "confirmed" && inCheckinWindow(session.startAt, now);
  const toSession = () => router.push({ pathname: "/session/[id]", params: { id: session.id } });

  return (
    <PhotoCard
      venue={venue}
      minHeight={260}
      photoHeight={120}
      tags={
        <Row style={styles.between}>
          <Tag label={planStatus(plan)} tone="accent" />
          <Tag label="Next up" />
        </Row>
      }
      footer={
        <Row style={styles.heroActions}>
          {checkIn && booking ? (
            <Button
              style={styles.flex}
              variant="accent"
              label="Check in"
              onPress={() => router.push({ pathname: "/live/[id]", params: { id: booking.id } })}
            />
          ) : (
            <Button style={styles.flex} variant="primary" label="Details" onPress={toSession} />
          )}
          {booking && (
            <Button
              style={styles.flex}
              variant="soft"
              label="Chat"
              onPress={() => router.push({ pathname: "/thread/[id]", params: { id: booking.id } })}
            />
          )}
        </Row>
      }
    >
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={`Next up: ${session.title}, ${formatWhen(session.startAt)}, ${planStatus(plan)}`}
        onPress={toSession}
        scaleTo={0.99}
      >
        <T variant="title">{until(session.startAt, now)}</T>
        <T variant="heading">{session.title}</T>
        <T variant="label" color="textSecondary">
          {formatWhen(session.startAt)} · {session.abilityLabel}
        </T>
        <Row style={styles.where}>
          <WhereIcon />
          <T variant="caption" color="textSecondary">
            {venue?.name ?? "—"}
            {withName ? ` · ${plan.tag === "Hosting" ? "with" : "hosted by"} ${withName}` : ""}
          </T>
        </Row>
      </PressScale>
    </PhotoCard>
  );
}

function WhereIcon() {
  const theme = useTheme();
  return <MapPin size={14} color={theme.textSecondary} />;
}

function weeksToGo(goalDate: string) {
  const left = daysUntil(goalDate);
  if (left <= 0) return "this is the week";
  return left < 14
    ? `${left} day${left === 1 ? "" : "s"} to go`
    : `${Math.round(left / 7)} weeks to go`;
}

const styles = StyleSheet.create({
  content: { paddingTop: Spacing.half, gap: Spacing.two },
  planRow: { alignItems: "center", gap: Spacing.two },
  planIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { gap: Spacing.two },
  between: { justifyContent: "space-between", alignItems: "center" },
  flex: { flex: 1 },
  manage: { gap: Spacing.one, paddingTop: Spacing.one },
  more: { minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.one },
  heroActions: { marginTop: Spacing.three },
  where: { gap: 6, marginTop: Spacing.half },
});
