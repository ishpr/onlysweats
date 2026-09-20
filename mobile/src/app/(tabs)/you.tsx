import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { LevelPicker } from "@/components/ability-picker";
import { AppHeader } from "@/components/brand";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Field,
  Notice,
  Row,
  Screen,
  StateView,
  T,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { formatUsd, formatWhen } from "@/lib/format";
import { useMe, useUpdateMe } from "@/lib/queries";
import type { Gender } from "@/lib/types";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: null, label: "Rather not say" },
];

const LEVELS = ["run", "ride", "strength", "hike", "walk"] as const;

/**
 * A profile is a first name, a level and a track record. There is no "about me",
 * no "looking for" and no gallery — by design (PRD v0.3 §8).
 */
export default function You() {
  const { signOut } = useAuth();
  const router = useRouter();
  const me = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState<string | null>(null);

  if (!me.data) {
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  const p = me.data;
  const rated = p.completedCount > 0;

  return (
    <Screen header={<AppHeader />} onRefresh={() => void me.refetch()} refreshing={me.isRefetching}>
      <Row>
        <Avatar initials={p.initials} accent={p.accent} size={64} />
        <View style={styles.flex}>
          <T variant="heading">{p.name}</T>
          <T variant="caption" color="textSecondary">
            {p.neighborhood} · member since {p.memberSince}
          </T>
        </View>
      </Row>

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
          <Button
            variant="soft"
            label="Save"
            disabled={!name?.trim()}
            loading={update.isPending}
            onPress={() =>
              update.mutate({ name: name!.trim() }, { onSuccess: () => setName(null) })
            }
          />
        </Card>
      )}

      <Row style={styles.stats}>
        <Stat value={String(p.completedCount)} label="Completed" />
        <Stat value={rated ? `${p.onTimePct}%` : "—"} label="On time" />
        <Stat value={rated ? `${p.wouldJoinPct}%` : "—"} label="Join again" />
      </Row>

      {p.frozenUntil && (
        <Notice tone="danger">
          Two no-shows in 60 days. Public sessions are paused until {formatWhen(p.frozenUntil)}.
          Invites from people you know still work.
        </Notice>
      )}

      <Card>
        <T variant="label">Membership</T>
        <T variant="caption" color="textSecondary">
          {p.freeSessionsLeft > 0
            ? `Your first two sessions are free — ${p.freeSessionsLeft} to go. After that it’s $12 a month, and only once your area is busy enough to be worth it.`
            : "You’re past your two free sessions. Membership isn’t charging in your area yet."}
        </T>
        <Row style={styles.wrap}>
          {p.creditCents > 0 && <Badge label={`${formatUsd(p.creditCents)} credit`} />}
          {p.feesCents > 0 && <Badge label={`${formatUsd(p.feesCents)} in fees`} />}
          {p.strikes > 0 && (
            <Badge label={`${p.strikes} strike${p.strikes === 1 ? "" : "s"} · 60 days`} />
          )}
        </Row>
      </Card>

      <Card>
        <T variant="label">Your level</T>
        <T variant="caption" color="textSecondary">
          Sessions are matched to this, and new posts start from it. It’s about the workout — never
          shown as a ranking, never rated by anyone.
        </T>
        {LEVELS.map((a) => (
          <LevelPicker
            key={a}
            activity={a}
            mine={p.abilities}
            onChange={(abilities) => update.mutate({ abilities })}
          />
        ))}
      </Card>

      <Card>
        <T variant="label">Women-only sessions</T>
        <T variant="caption" color="textSecondary">
          Only used to open women-only sessions to women. Never shown, never ranked on.
        </T>
        <Row style={styles.wrap}>
          {GENDERS.map((g) => (
            <Chip
              key={g.label}
              label={g.label}
              selected={p.gender === g.value}
              onPress={() => update.mutate({ gender: g.value })}
            />
          ))}
        </Row>
      </Card>

      {update.error && <Notice tone="danger">{update.error.message}</Notice>}

      <Card>
        <T variant="label">Safety and account</T>
        <T variant="caption" color="textSecondary">
          Report or block someone from their session or your thread with them.
        </T>
        <Button variant="soft" label="Blocked members" onPress={() => router.push("/blocked")} />
        <Button
          variant="soft"
          label="Help and support"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${SITE_URL}/support`)}
        />
        <Row>
          <Button
            style={styles.flex}
            variant="ghost"
            label="Privacy"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}
          />
          <Button
            style={styles.flex}
            variant="ghost"
            label="Terms"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`${SITE_URL}/terms`)}
          />
        </Row>
        {p.isAdmin && (
          <Button
            variant="soft"
            label="Admin queue"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`${SITE_URL}/admin`)}
          />
        )}
      </Card>

      <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
      <Button
        variant="ghost"
        label="Delete account"
        onPress={() => router.push("/delete-account")}
      />
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card style={styles.stat}>
      <T variant="heading">{value}</T>
      <T variant="caption" color="textSecondary">
        {label}
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: "wrap", gap: Spacing.one },
  stats: { alignItems: "stretch" },
  stat: { flex: 1, gap: 0 },
});
