import { useRouter } from "expo-router";
import { LocateFixed, Plus, Search } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { AppHeader } from "@/components/brand";
import { SectionTitle } from "@/components/list";
import { Enter, PressScale } from "@/components/motion";
import { SessionCard, type MineTag } from "@/components/session-card";
import { TrainingBlockCard } from "@/components/training-block-card";
import { Button, Card, Chip, EmptyState, Screen, StateView, T } from "@/components/ui";
import { HitTarget, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useArea } from "@/lib/area";
import { clusterHour, formatWhen } from "@/lib/format";
import { byId } from "@/lib/lookup";
import {
  useMe,
  useMine,
  usePublicTrainingBlocks,
  useRefreshOnFocus,
  useSessions,
  useVenues,
} from "@/lib/queries";
import type { Activity, Session } from "@/lib/types";

const ACTIVITY_FILTERS: { id: Activity | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "run", label: "Run" },
  { id: "ride", label: "Ride" },
  { id: "strength", label: "Gym" },
  { id: "hike", label: "Hike" },
  { id: "walk", label: "Walk" },
  { id: "mobility", label: "Mobility" },
];

/**
 * Find is the one place to browse: every open session for the next two weeks, at
 * my level unless I ask otherwise, grouped by day. Home only ever shows a few.
 */
export default function Find() {
  useRefreshOnFocus();
  const router = useRouter();
  const me = useMe().data;
  const mine = useMine().data;
  const open = useSessions();
  const goals = usePublicTrainingBlocks();
  const venues = byId(useVenues().data);
  const { area, ask } = useArea();
  const theme = useTheme();

  const [activity, setActivity] = useState<Activity | "all">("all");
  const [allLevels, setAllLevels] = useState(false);
  const [early, setEarly] = useState(false);
  const [fillIn, setFillIn] = useState(false);
  const [womenOnly, setWomenOnly] = useState(false);

  const levelSet = Object.keys(me?.abilities ?? {}).length > 0;
  const matches = (s: Session) =>
    (activity === "all" || s.activity === activity) &&
    (!early || clusterHour(s.startAt) < 10) &&
    (!fillIn || s.substituteSeat) &&
    (!womenOnly || s.womenOnly);

  const inFilter = (open.data?.sessions ?? []).filter(matches);
  // Hide only what I KNOW is the wrong level; a level I haven't set hides nothing.
  const list = allLevels ? inFilter : inFilter.filter((s) => s.fitsMe !== false);
  const hidden = inFilter.length - list.length;
  const visibleGoals = (goals.data ?? []).filter(
    (g) => (activity === "all" || g.activity === activity) && (allLevels || g.fitsMe !== false),
  );

  // What a session already is to me, so my own plans don't look like strangers'.
  const tags = new Map<string, MineTag>();
  for (const s of mine?.sessions ?? []) if (s.hostId === me?.id) tags.set(s.id, "Hosting");
  for (const b of mine?.bookings ?? []) {
    if (b.participantId !== me?.id) continue;
    if (b.status === "confirmed") tags.set(b.sessionId, "Joined");
    if (b.status === "pending") tags.set(b.sessionId, "Waiting for approval");
  }

  const days: { day: string; sessions: Session[] }[] = [];
  for (const s of list) {
    const day = formatWhen(s.startAt).split(" · ")[0];
    const last = days[days.length - 1];
    if (last?.day === day) last.sessions.push(s);
    else days.push({ day, sessions: [s] });
  }

  const anyFilter = activity !== "all" || early || fillIn || womenOnly;
  const clear = () => {
    setActivity("all");
    setEarly(false);
    setFillIn(false);
    setWomenOnly(false);
  };

  return (
    <Screen
      hidesTabBar
      header={<AppHeader />}
      onRefresh={() => void Promise.all([open.refetch(), goals.refetch()])}
    >
      <View>
        <View style={styles.titleRow}>
          <T variant="title" style={styles.titleText}>
            Find a session
          </T>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Post a session"
            onPress={() => router.push("/post")}
            style={[styles.postPill, { backgroundColor: theme.primary }]}
          >
            <Plus size={16} color={theme.onPrimary} strokeWidth={2.5} />
            <T variant="label" style={{ color: theme.onPrimary }}>
              Post
            </T>
          </PressScale>
        </View>
        <T variant="caption" color="textSecondary">
          {area?.name ? `Near ${area.name}` : "Near Dallas"} · the next two weeks
        </T>
        {area?.permission === "undetermined" && (
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Use my location to show how far each session is"
            onPress={() => void ask()}
            style={styles.locate}
          >
            <LocateFixed size={14} color={theme.accent} />
            <T variant="caption" color="accent">
              Use my location to see what’s closest
            </T>
          </PressScale>
        )}
      </View>

      <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Activity">
        {ACTIVITY_FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            selected={activity === f.id}
            onPress={() => setActivity(f.id)}
          />
        ))}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {levelSet && (
          <Chip
            label="My level only"
            selected={!allLevels}
            onPress={() => setAllLevels(!allLevels)}
          />
        )}
        <Chip label="Before 10 AM" selected={early} onPress={() => setEarly(!early)} />
        <Chip label="Fill-in spots" selected={fillIn} onPress={() => setFillIn(!fillIn)} />
        {me?.gender === "woman" && (
          <Chip label="Women-only" selected={womenOnly} onPress={() => setWomenOnly(!womenOnly)} />
        )}
      </ScrollView>

      {!levelSet && (
        <Card>
          <T variant="label">See what fits you</T>
          <T variant="caption" color="textSecondary">
            Set your level and we’ll put sessions at your pace first.
          </T>
          <Button variant="soft" label="Set my level" onPress={() => router.push("/welcome")} />
        </Card>
      )}

      {visibleGoals.length > 0 && (
        <View style={styles.section}>
          <SectionTitle>Train for a goal</SectionTitle>
          <T variant="caption" color="textSecondary">
            The same people every week until a date. Joining means joining every session.
          </T>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {visibleGoals.map((g) => (
              <TrainingBlockCard key={g.id} block={g} venues={venues} />
            ))}
          </ScrollView>
        </View>
      )}

      {open.isPending || open.error ? (
        <StateView
          loading={open.isPending}
          error={open.error}
          onRetry={() => void open.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Search}
          title={hidden > 0 ? "Nothing at your level for this" : "No sessions for this yet"}
          body={
            hidden > 0
              ? `There ${hidden === 1 ? "is 1 session" : `are ${hidden} sessions`} at other levels. Have a look, or post your own.`
              : anyFilter
                ? "Try fewer filters, or post your own and people at your level will see it."
                : "Be the first: post your own and people at your level will see it."
          }
          action={
            hidden > 0
              ? { label: "Show other levels", onPress: () => setAllLevels(true) }
              : anyFilter
                ? { label: "Clear filters", onPress: clear }
                : { label: "Post a session", onPress: () => router.push("/post") }
          }
          secondary={
            hidden > 0 || anyFilter
              ? { label: "Post a session", onPress: () => router.push("/post") }
              : undefined
          }
        />
      ) : (
        <>
          {days.map(({ day, sessions }) => (
            <View key={day} style={styles.section}>
              <SectionTitle>{day}</SectionTitle>
              {sessions.map((s, i) => (
                <Enter key={s.id} index={i}>
                  <SessionCard session={s} venue={venues.get(s.venueId)} mine={tags.get(s.id)} />
                </Enter>
              ))}
            </View>
          ))}
          {hidden > 0 && (
            <Button
              variant="ghost"
              label={`Show ${hidden} more at other levels`}
              onPress={() => setAllLevels(true)}
            />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  titleText: { flex: 1 },
  postPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  locate: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: HitTarget },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  row: { gap: Spacing.one, paddingRight: Spacing.three },
  section: { gap: Spacing.two },
});
