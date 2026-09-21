/**
 * Home's read of today, from Apple Health — our words, not Apple's rings. It exists
 * to answer one question: what kind of session suits me today? Read on this phone
 * only; nothing here is sent anywhere.
 */
import { useRouter } from "expo-router";
import { HeartPulse } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { PressScale } from "@/components/motion";
import { Button, Card, Row, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useHealth } from "@/hooks/use-health";
import { useTheme } from "@/hooks/use-theme";
import { formatWhen } from "@/lib/format";
import { type Candidate, pickForToday, readToday, type WorkoutKind } from "@/lib/today";
import type { Session } from "@/lib/types";

export function TodayCard({ sessions }: { sessions: Session[] }) {
  const theme = useTheme();
  const router = useRouter();
  const health = useHealth();
  const [busy, setBusy] = useState(false);

  // No Apple Health here (Android, an older build): Home simply doesn't have this card.
  if (!health.available || health.loading) return null;

  if (!health.connected) {
    return (
      <Card>
        <Row>
          <HeartPulse size={18} color={theme.accent} />
          <T variant="label" style={styles.flex}>
            See what kind of day it is
          </T>
        </Row>
        <T variant="caption" color="textSecondary">
          Connect Apple Health and SamePace will read your sleep, workouts and resting heart rate to
          suggest a session that suits today. It’s read on this phone and never leaves it.
        </T>
        <Button
          variant="soft"
          label="Connect Apple Health"
          loading={busy}
          onPress={() => {
            setBusy(true);
            void health.connect().finally(() => setBusy(false));
          }}
        />
      </Card>
    );
  }

  if (!health.day) return null;
  const read = readToday(health.day);
  const candidates: Candidate[] = sessions.map((s) => ({
    id: s.id,
    activity: s.activity as WorkoutKind,
    anyLevelWelcome: s.abilityFlex === "flexible",
    fitsMe: s.fitsMe,
    startAt: +new Date(s.startAt),
  }));
  const pick = pickForToday(read, candidates);
  const picked = pick ? sessions.find((s) => s.id === pick.id) : undefined;

  return (
    <Card>
      <Row>
        <HeartPulse size={18} color={theme.accent} />
        <T variant="eyebrow" color="textSecondary" style={styles.flex}>
          Today
        </T>
        <T variant="caption" color="textFaint">
          from Apple Health
        </T>
      </Row>
      <T variant="heading">{read.headline}</T>
      <View style={styles.lines}>
        {read.lines.map((line) => (
          <T key={line} color="textSecondary">
            {line}
          </T>
        ))}
      </View>
      {picked && pick && (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel={`${pick.why}: ${picked.title}, ${formatWhen(picked.startAt)}`}
          onPress={() => router.push({ pathname: "/session/[id]", params: { id: picked.id } })}
          style={[styles.pick, { backgroundColor: theme.accentSoft }]}
        >
          <T variant="caption" color="accent">
            {pick.why}
          </T>
          <T variant="label">{picked.title}</T>
          <T variant="caption" color="textSecondary">
            {formatWhen(picked.startAt)} · {picked.abilityLabel}
          </T>
        </PressScale>
      )}
      <T variant="caption" color="textFaint">
        A plain read of your own numbers, not medical advice.
      </T>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lines: { gap: 2 },
  pick: { borderRadius: 16, padding: Spacing.two, gap: 2 },
});
