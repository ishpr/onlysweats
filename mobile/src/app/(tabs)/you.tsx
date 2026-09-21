import { useRouter } from "expo-router";
import {
  Bike,
  Bot,
  Dumbbell,
  FileText,
  Footprints,
  HeartPulse,
  LifeBuoy,
  Lock,
  LogOut,
  Mountain,
  ShieldBan,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { LevelPicker } from "@/components/ability-picker";
import { AppHeader } from "@/components/brand";
import { ListCard, ListRow, SectionTitle } from "@/components/list";
import { Appear } from "@/components/motion";
import { NotificationSettings } from "@/components/push-cards";
import { TrackRings } from "@/components/rings";
import {
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
import { useTheme } from "@/hooks/use-theme";
import { myLevelLabel } from "@/lib/ability";
import { type AppearancePref, loadAppearance, saveAppearance } from "@/lib/appearance";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { formatUsd, formatWhen } from "@/lib/format";
import { useMe, useUpdateMe } from "@/lib/queries";
import type { Gender, Verification } from "@/lib/types";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
  { value: null, label: "Rather not say" },
];

const APPEARANCES: { value: AppearancePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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
  const { signOut } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const me = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<AppearancePref>("system");
  useEffect(() => {
    void loadAppearance().then(setAppearance);
  }, []);

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
  const web = (path: string) => () => void Linking.openURL(`${SITE_URL}${path}`);

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
            {p.name}
          </T>
          <T variant="caption" color="textSecondary">
            {p.neighborhood} · since {p.memberSince}
          </T>
          <View style={styles.legend}>
            <Legend
              color={theme.move}
              value={String(p.completedCount)}
              label={`of ${milestone} sessions`}
            />
            <Legend color={theme.accent} value={rated ? `${p.onTimePct}%` : "—"} label="on time" />
            <Legend
              color={theme.stand}
              value={rated ? `${p.wouldJoinPct}%` : "—"}
              label="would join again"
            />
          </View>
        </View>
      </Appear>

      {!rated && (
        <T variant="caption" color="textSecondary">
          Your rings fill as you show up. They’re the only thing other members see about you — no
          photos, no bio.
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
            <View
              accessible
              style={styles.dots}
              accessibilityLabel={`${p.freeSessionsLeft} free sessions left`}
            >
              {[0, 1].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i < 2 - p.freeSessionsLeft ? theme.accent : theme.backgroundSelected,
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </Row>
        <T variant="caption" color="textSecondary">
          {p.freeSessionsLeft > 0
            ? `Your first two sessions are free — ${p.freeSessionsLeft} to go. After that it’s $12 a month, and only once your area is busy enough to be worth it.`
            : "You’re past your two free sessions. Membership isn’t charging in your area yet."}
        </T>
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
              value={mine ?? "Set"}
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

      <SectionTitle>Women-only sessions</SectionTitle>
      <Card>
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

      <SectionTitle>Verification</SectionTitle>
      <Card>
        <T variant="caption" color="textSecondary">
          {verificationLine(p.verification)}
        </T>
        {p.verification.available &&
          (p.verification.member !== "approved" || p.verification.governmentId !== "approved") && (
            <Button
              variant="soft"
              label={
                p.verification.member !== "approved"
                  ? "Verify your phone and face"
                  : "Verify your ID"
              }
              onPress={() =>
                router.push({
                  pathname: "/verify",
                  params: {
                    tier: p.verification.member !== "approved" ? "member" : "government_id",
                  },
                })
              }
            />
          )}
      </Card>

      <SectionTitle>Your training</SectionTitle>
      <ListCard>
        <ListRow icon={HeartPulse} label="Apple Health" onPress={() => router.push("/health")} />
        <ListRow icon={Dumbbell} label="Fitness log" onPress={() => router.push("/fitness")} />
        <ListRow icon={Bot} label="Workout assistant" onPress={() => router.push("/assistant")} />
      </ListCard>

      <SectionTitle>Notifications</SectionTitle>
      <NotificationSettings me={p} />

      <SectionTitle>Appearance</SectionTitle>
      <Card>
        <Row style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
          {APPEARANCES.map((a) => (
            <Chip
              key={a.value}
              label={a.label}
              selected={appearance === a.value}
              onPress={() => {
                setAppearance(a.value);
                void saveAppearance(a.value);
              }}
            />
          ))}
        </Row>
      </Card>

      <SectionTitle>Safety and account</SectionTitle>
      <ListCard>
        <ListRow icon={ShieldBan} label="Blocked members" onPress={() => router.push("/blocked")} />
        {name === null && p.name !== "Member" ? (
          <ListRow icon={FileText} label="Change my name" onPress={() => setName(p.name)} />
        ) : null}
        <ListRow
          icon={LifeBuoy}
          label="Help and support"
          accessibilityRole="link"
          onPress={web("/support")}
        />
        <ListRow icon={Lock} label="Privacy" accessibilityRole="link" onPress={web("/privacy")} />
        <ListRow icon={FileText} label="Terms" accessibilityRole="link" onPress={web("/terms")} />
        {p.isAdmin ? (
          <ListRow
            icon={ShieldCheck}
            label="Admin queue"
            accessibilityRole="link"
            onPress={web("/admin")}
          />
        ) : null}
      </ListCard>
      <T variant="caption" color="textFaint">
        To report or block someone, open their session or your chat with them.
      </T>

      <ListCard>
        <ListRow icon={LogOut} label="Sign out" onPress={() => void signOut()} />
        <ListRow
          icon={Trash2}
          label="Delete account"
          danger
          onPress={() => router.push("/delete-account")}
        />
      </ListCard>
    </Screen>
  );
}

function verificationLine(v: Verification) {
  if (v.idRequired && v.governmentId !== "approved") {
    return "A report about you was acted on, so public sessions need a government ID check first.";
  }
  if (v.governmentId === "approved") return "Phone, face and government ID verified.";
  if (v.member === "approved") {
    return "Phone and face verified. Women-only sessions also ask for a government ID.";
  }
  if (v.member === "needs_review") {
    return "A person is looking at your check. You’ll hear either way.";
  }
  return v.enforced
    ? "Public sessions ask for a verified phone and face. It takes about a minute, once."
    : "Verify your phone and face — it takes about a minute, once. Other members see “Verified”; SamePace never sees your photo.";
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
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
