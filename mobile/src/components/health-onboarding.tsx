/**
 * Apple Health, as a step of getting started: one button that asks for everything the
 * app can use, so a member who wants the full experience gets it in one go. iOS shows
 * its own sheet next (with "Turn On All"); what is granted there is the member's call,
 * and iOS never tells an app what was declined — so this step can invite, not enforce.
 */
import { Activity, HeartPulse, Lock, Sparkles, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { DayDial } from "@/components/charts";
import { Appear } from "@/components/motion";
import { Button, Notice, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useHealthSync } from "@/hooks/use-health-sync";
import { useTheme } from "@/hooks/use-theme";
import { captureApiSession, type ApiSession } from "@/lib/api";

import type { HealthDataType } from "../../../shared/health";

const EVERYTHING: HealthDataType[] = [
  "workout",
  "heart_rate",
  "resting_heart_rate",
  "heart_rate_variability",
  "heart_rate_variability_rmssd",
  "cycling_power",
  "sleep",
  "steps",
  "distance",
  "active_energy",
  "blood_glucose",
];

export function HealthStep({
  ownerId,
  onDone,
  onBack,
}: {
  ownerId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const [session] = useState(captureApiSession);
  // No session to sync with: nothing to offer here.
  useEffect(() => {
    if (!session) onDone();
  }, [session, onDone]);
  return session ? (
    <Connect ownerId={ownerId} session={session} onDone={onDone} onBack={onBack} />
  ) : null;
}

function Connect({
  ownerId,
  session,
  onDone,
  onBack,
}: {
  ownerId: string;
  session: ApiSession;
  onDone: () => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const health = useHealthSync({ ownerId, session });
  const [asked, setAsked] = useState(false);
  const skip = health.availability === "unavailable" || Boolean(health.connection);
  // Not an iPhone with Health, or already connected: this step has nothing to ask.
  useEffect(() => {
    if (skip) onDone();
  }, [skip, onDone]);
  if (skip) return null;

  const busy = health.phase === "connecting" || health.phase === "syncing";
  const connect = async () => {
    setAsked(true);
    // Everything this iPhone supports, with syncing kept up to date in the background.
    const types = EVERYTHING.filter(
      (type) => type === "workout" || (health.supportedTypes ?? EVERYTHING).includes(type),
    );
    try {
      await health.connect(types, true);
      onDone();
    } catch {
      // The controller reports what went wrong through `health.error`.
    }
  };

  return (
    <Appear style={styles.step}>
      <View style={styles.hero}>
        <DayDial level={2} size={120}>
          <HeartPulse size={30} color={theme.accent} />
        </DayDial>
      </View>
      <T variant="title">Bring your Apple Health</T>
      <T color="textSecondary">
        It’s what makes SamePace yours: your day at a glance, and sessions that suit the day you’re
        actually having.
      </T>
      <Benefit icon={Activity} title="Your day, drawn">
        Sleep, heart rate, steps and workouts in one place.
      </Benefit>
      <Benefit icon={Sparkles} title="A read of today">
        Easy, steady or ready — and a session to match.
      </Benefit>
      <Benefit icon={Lock} title="Private to you">
        Never shown to buddies or their assistants. Switch it off any time in Settings.
      </Benefit>
      {asked && health.error ? <Notice tone="danger">{health.error}</Notice> : null}
      <View style={styles.spacer} />
      <T variant="caption" color="textFaint" style={styles.center}>
        Your iPhone asks next. Choose “Turn On All” for the full picture.
      </T>
      <Button
        variant="accent"
        label="Connect Apple Health"
        loading={busy}
        disabled={busy || health.availability !== "available"}
        onPress={() => void connect()}
      />
      <Button variant="ghost" label="Not now" onPress={onDone} />
      <Button variant="ghost" label="Back" onPress={onBack} />
    </Appear>
  );
}

function Benefit({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.benefit}>
      <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
        <Icon size={18} color={theme.accent} />
      </View>
      <View style={styles.flex}>
        <T variant="label">{title}</T>
        <T variant="caption" color="textSecondary">
          {children}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  step: { flex: 1, gap: Spacing.three },
  hero: { alignItems: "center", paddingTop: Spacing.two },
  center: { textAlign: "center" },
  spacer: { flex: 1 },
  benefit: { flexDirection: "row", gap: Spacing.two, alignItems: "center" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
