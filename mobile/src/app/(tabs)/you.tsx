import { useRouter } from "expo-router";
import {
  BadgeCheck,
  Bike,
  Bot,
  Dumbbell,
  Footprints,
  HeartPulse,
  Mountain,
  Settings as SettingsIcon,
} from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { LevelPicker } from "@/components/ability-picker";
import { AppHeader } from "@/components/brand";
import { verificationValue } from "@/app/settings";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { Appear } from "@/components/motion";
import { TrackRings } from "@/components/rings";
import {
  Badge,
  Button,
  Card,
  Field,
  Notice,
  Row,
  Screen,
  StateView,
  T,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { myLevelLabel } from "@/lib/ability";
import { tidyName } from "@/lib/names";
import { formatUsd, formatWhen } from "@/lib/format";
import { useMe, useUpdateMe } from "@/lib/queries";

const LEVELS = [
  { activity: "run", label: "Run", icon: Footprints },
  { activity: "ride", label: "Ride", icon: Bike },
  { activity: "strength", label: "Gym", icon: Dumbbell },
  { activity: "hike", label: "Hike", icon: Mountain },
  { activity: "walk", label: "Walk", icon: Footprints },
] as const;

const MILESTONES = [5, 10, 25, 50, 100, 250];

/**
 * A profile is a first name, a level and a track record. There is no "about me",
 * no "looking for" and no gallery — by design (PRD v0.3 §8).
 */
export default function You() {
  const router = useRouter();
  const theme = useTheme();
  const me = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (!me.data) {
    return (
      <Screen hidesTabBar header={<AppHeader />}>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  const p = me.data;
  const rated = p.completedCount > 0;
  const milestone = MILESTONES.find((m) => m > p.completedCount) ?? p.completedCount;

  return (
    <Screen
      hidesTabBar
      header={<AppHeader />}
      onRefresh={() => void me.refetch()}
      refreshing={me.isRefetching}
    >
      <Appear style={styles.hero}>
        <TrackRings
          completed={p.completedCount / milestone}
          onTime={rated ? p.onTimePct / 100 : 0}
          joinAgain={rated ? p.wouldJoinPct / 100 : 0}
        >
          <T variant="heading">{p.initials}</T>
        </TrackRings>
        <View style={styles.flex}>
          <T variant="title" numberOfLines={2} style={styles.name}>
            {tidyName(p.name)}
          </T>
          <T variant="caption" color="textSecondary">
            Member since {p.memberSince}
          </T>
          <View style={styles.legend}>
            <Legend
              color={theme.move}
              value={String(p.completedCount)}
              label={p.completedCount === 1 ? "session" : "sessions"}
            />
            {/* A dash reads as broken. These two appear once there's something to say. */}
            {rated && <Legend color={theme.accent} value={`${p.onTimePct}%`} label="on time" />}
            {rated && (
              <Legend color={theme.stand} value={`${p.wouldJoinPct}%`} label="would join again" />
            )}
          </View>
        </View>
      </Appear>

      {!rated && (
        <T variant="caption" color="textSecondary">
          Your rings fill as you show up. Other members see your first name, your level and this
          record — nothing else.
        </T>
      )}

      {/* Apple only shares a name the first time, and "Hide My Email" gives us nothing to go on. */}
      {(p.name === "Member" || name !== null) && (
        <Card>
          <T variant="label">What should your buddy call you?</T>
          <Field
            label="First name"
            value={name ?? ""}
            onChangeText={setName}
            autoComplete="given-name"
            maxLength={80}
          />
          <Row>
            <Button
              style={styles.flex}
              variant="ghost"
              label="Cancel"
              onPress={() => setName(null)}
            />
            <Button
              style={styles.flex}
              variant="soft"
              label="Save"
              disabled={!name?.trim()}
              loading={update.isPending}
              onPress={() =>
                update.mutate({ name: name!.trim() }, { onSuccess: () => setName(null) })
              }
            />
          </Row>
        </Card>
      )}

      {(p.blocksFinished > 0 || p.helpedCount > 0) && (
        <Row style={styles.wrap}>
          {p.blocksFinished > 0 && (
            <Badge
              tone="accent"
              label={`${p.blocksFinished} goal${p.blocksFinished === 1 ? "" : "s"} finished`}
            />
          )}
          {p.helpedCount > 0 && (
            <Badge
              tone="accent"
              label={`Helped ${p.helpedCount} ${p.helpedCount === 1 ? "person" : "people"} reach a goal`}
            />
          )}
        </Row>
      )}

      {p.frozenUntil && (
        <Notice tone="danger">
          Two no-shows in 60 days. Public sessions are paused until {formatWhen(p.frozenUntil)}.
          Invites from people you know still work.
        </Notice>
      )}

      <Card>
        <Row style={styles.between}>
          <T variant="label">Membership</T>
          {p.freeSessionsLeft > 0 && (
            <Badge
              tone="accent"
              label={`${p.freeSessionsLeft} free session${p.freeSessionsLeft === 1 ? "" : "s"} left`}
            />
          )}
        </Row>
        <T variant="caption" color="textSecondary">
          {p.freeSessionsLeft > 0
            ? "SamePace is free right now, and your first two sessions always will be. When paid membership starts in your area, we’ll tell you the price first."
            : "Open membership to see your current status and review any session fees."}
        </T>
        <Button variant="soft" label="Membership & fees" onPress={() => router.push("/billing")} />
        {(p.creditCents > 0 || p.feesCents > 0 || p.strikes > 0) && (
          <Row style={styles.wrap}>
            {p.creditCents > 0 && (
              <Badge tone="accent" label={`${formatUsd(p.creditCents)} credit`} />
            )}
            {p.feesCents > 0 && <Badge label={`${formatUsd(p.feesCents)} in fees`} />}
            {p.strikes > 0 && (
              <Badge label={`${p.strikes} strike${p.strikes === 1 ? "" : "s"} · 60 days`} />
            )}
          </Row>
        )}
      </Card>

      <SectionTitle>Your level</SectionTitle>
      <ListCard>
        {LEVELS.map(({ activity, label, icon }) => {
          const mine = myLevelLabel(activity, p.abilities);
          return (
            <ListRow
              key={activity}
              icon={icon}
              label={label}
              value={mine ?? "Add"}
              valueTone={mine ? "muted" : "accent"}
              expanded={open === activity}
              onPress={() => setOpen(open === activity ? null : activity)}
            >
              <LevelPicker
                activity={activity}
                mine={p.abilities}
                onChange={(abilities) => update.mutate({ abilities })}
              />
            </ListRow>
          );
        })}
      </ListCard>
      <T variant="caption" color="textFaint">
        We show you sessions at your level first, and new posts start from it. It’s about the
        workout — never a ranking, never rated by anyone.
      </T>

      {update.error && <Notice tone="danger">{update.error.message}</Notice>}

      <ListCard>
        <ListRow
          icon={BadgeCheck}
          label="Verification"
          value={verificationValue(p.verification)}
          valueTone={p.verification.member === "approved" ? "accent" : "muted"}
          onPress={() => router.push("/settings/verification")}
        />
      </ListCard>

      <SectionTitle>Your training</SectionTitle>
      <ListCard>
        <ListRow icon={HeartPulse} label="Apple Health" onPress={() => router.push("/health")} />
        <ListRow icon={Dumbbell} label="Fitness log" onPress={() => router.push("/fitness")} />
        <ListRow icon={Bot} label="Assistant" onPress={() => router.navigate("/agent")} />
      </ListCard>

      <ListCard>
        <ListRow
          icon={SettingsIcon}
          label="Settings"
          detail="Notifications, privacy, appearance, account"
          onPress={() => router.push("/settings")}
        />
      </ListCard>
    </Screen>
  );
}

function Legend({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <Row style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <T variant="label">{value}</T>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  name: { fontSize: 26, lineHeight: 30 },
  legend: { marginTop: Spacing.two, gap: 2 },
  legendRow: { gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  wrap: { flexWrap: "wrap", gap: Spacing.one },
  between: { justifyContent: "space-between" },
});
