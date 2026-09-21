import { useRouter } from "expo-router";
import { MapPinned } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { SessionCard } from "@/components/session-card";
import { Enter } from "@/components/motion";
import { TrainingBlockCard } from "@/components/training-block-card";
import { Chip, EmptyState, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { clusterHour } from "@/lib/format";
import { byId } from "@/lib/lookup";
import { usePublicTrainingBlocks, useRefreshOnFocus, useSessions, useVenues } from "@/lib/queries";
import type { Session } from "@/lib/types";
import { AppHeader } from "@/components/brand";

const FILTERS: { id: string; label: string; test: (s: Session) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "run", label: "Run", test: (s) => s.activity === "run" },
  { id: "hike", label: "Hike", test: (s) => s.activity === "hike" },
  { id: "ride", label: "Ride", test: (s) => s.activity === "ride" },
  { id: "gym", label: "Gym", test: (s) => s.activity === "strength" },
  { id: "subs", label: "Substitute seats", test: (s) => s.substituteSeat },
  { id: "women", label: "Women-only", test: (s) => s.womenOnly },
  {
    id: "morning",
    label: "Morning",
    test: (s) => clusterHour(s.startAt) >= 5 && clusterHour(s.startAt) < 10,
  },
];

export default function Sessions() {
  useRefreshOnFocus();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const open = useSessions();
  const blocks = usePublicTrainingBlocks();
  const venues = byId(useVenues().data);
  const test = FILTERS.find((f) => f.id === filter)!.test;
  // By default, hide only what I KNOW is the wrong level; unknown levels stay.
  const [allLevels, setAllLevels] = useState(false);
  const inWindow = (open.data?.sessions ?? []).filter(test);
  const list = allLevels ? inWindow : inWindow.filter((s) => s.fitsMe !== false);
  const hidden = inWindow.length - list.length;
  // Same rule as sessions: hide only what I know is the wrong level.
  const trainingBlocks = (blocks.data ?? []).filter((b) => allLevels || b.fitsMe !== false);

  return (
    <Screen
      header={<AppHeader />}
      onRefresh={() => void Promise.all([open.refetch(), blocks.refetch()])}
      refreshing={open.isRefetching}
    >
      <View>
        <T color="textSecondary">Dallas · next 14 days</T>
        <T variant="title">Sessions</T>
        <T variant="caption" color="textSecondary">
          Upcoming time and place — not a grid of faces.
        </T>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            selected={filter === f.id}
            onPress={() => setFilter(f.id)}
          />
        ))}
      </ScrollView>
      {(hidden > 0 || allLevels) && (
        <Chip
          label={allLevels ? "Showing all levels" : `${hidden} more outside your level`}
          selected={allLevels}
          onPress={() => setAllLevels(!allLevels)}
        />
      )}

      {trainingBlocks.length > 0 && (
        <View style={styles.section}>
          <T variant="heading">Training blocks</T>
          <T variant="caption" color="textSecondary">
            Every week until a date. Joining one is joining all of its sessions.
          </T>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {trainingBlocks.map((b) => (
              <TrainingBlockCard key={b.id} block={b} venues={venues} />
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
          icon={MapPinned}
          title={hidden > 0 ? "Nothing at your level right now" : "Nothing posted for that yet"}
          body={
            hidden > 0
              ? `${hidden} session${hidden === 1 ? " is" : "s are"} outside the level on your profile. Or post yours — someone at your level is looking too.`
              : "Be the first. Post the workout you’re doing anyway and someone at your level can join."
          }
          action={{ label: "Post a session", onPress: () => router.push("/post") }}
          secondary={
            hidden > 0 ? { label: "Show all levels", onPress: () => setAllLevels(true) } : undefined
          }
        />
      ) : (
        list.map((s, i) => (
          <Enter key={s.id} index={i}>
            <SessionCard session={s} venue={venues.get(s.venueId)} />
          </Enter>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: Spacing.one, paddingRight: Spacing.three },
  section: { gap: Spacing.one },
});
