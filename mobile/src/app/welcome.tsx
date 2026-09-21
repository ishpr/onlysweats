/**
 * First run — and "Set my level" any time after. The product's promise is a buddy
 * at your level, so level is asked before the feed, not buried in settings. Three
 * short steps: what you do, how hard, and the deal everyone here agrees to.
 */
import { StepDots } from "@/components/step-dots";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { CalendarCheck, Clock, MapPin } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";

import { LevelPicker } from "@/components/ability-picker";
import { Lockup } from "@/components/brand";
import { Appear } from "@/components/motion";
import { Button, Card, Chip, Field, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { nameNeedsFixing, tidyName } from "@/lib/names";
import { useMe, useUpdateMe } from "@/lib/queries";
import type { MemberAbilities } from "@/lib/types";

const DOES = [
  { activity: "run", label: "Run" },
  { activity: "ride", label: "Ride" },
  { activity: "strength", label: "Gym" },
  { activity: "hike", label: "Hike" },
  { activity: "walk", label: "Walk" },
] as const;
type Does = (typeof DOES)[number]["activity"];

export const welcomeKey = (memberId: string) => `samepace.welcomed.${memberId}`;

export default function Welcome() {
  const router = useRouter();
  const me = useMe();
  const update = useUpdateMe();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Does[] | null>(null);
  const [levels, setLevels] = useState<MemberAbilities>({});
  const [name, setName] = useState<string | null>(null);

  if (!me.data) {
    return (
      <Screen edges={["top", "bottom"]}>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  const p = me.data;
  const askName = nameNeedsFixing(p.name);
  // Coming back later: start from what's already on the profile.
  const chosen = picked ?? (Object.keys(p.abilities) as Does[]);
  const abilities = { ...p.abilities, ...levels };
  const typedName = name ?? (askName && p.name !== "Member" ? tidyName(p.name).split(" ")[0] : "");

  const finish = () => {
    void SecureStore.setItemAsync(welcomeKey(p.id), "1").catch(() => undefined);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  const saveAndNext = () => {
    const patch = {
      ...(Object.keys(levels).length > 0 ? { abilities: levels } : {}),
      ...(askName && typedName.trim() ? { name: typedName.trim() } : {}),
    };
    if (Object.keys(patch).length === 0) return setStep(2);
    update.mutate(patch, { onSuccess: () => setStep(2) });
  };

  return (
    <Screen edges={["top", "bottom"]} contentStyle={styles.content}>
      {/* Agreeing to the terms was step one. */}
      <StepDots step={step + 1} total={4} />

      {step === 0 && (
        <Appear style={styles.step}>
          <Lockup />
          <T variant="title">What do you do?</T>
          <T color="textSecondary">
            Pick everything you’d want a buddy for. You can change it later.
          </T>
          <View style={styles.wrap}>
            {DOES.map((d) => (
              <Chip
                key={d.activity}
                label={d.label}
                selected={chosen.includes(d.activity)}
                onPress={() =>
                  setPicked(
                    chosen.includes(d.activity)
                      ? chosen.filter((a) => a !== d.activity)
                      : [...chosen, d.activity],
                  )
                }
              />
            ))}
          </View>
          {askName && (
            <Field
              label="What should your buddy call you?"
              value={typedName}
              onChangeText={setName}
              autoComplete="given-name"
              maxLength={40}
              placeholder="First name"
            />
          )}
          <View style={styles.spacer} />
          <Button
            label="Next"
            disabled={chosen.length === 0 || (askName && !typedName.trim())}
            onPress={() => setStep(1)}
          />
          <Button variant="ghost" label="Not now" onPress={finish} />
        </Appear>
      )}

      {step === 1 && (
        <Appear style={styles.step}>
          <T variant="title">At what level?</T>
          <T color="textSecondary">
            A rough answer is fine. It’s only used to show you sessions that fit — nobody rates it
            and it’s never a ranking.
          </T>
          {chosen.map((activity) => (
            <Card key={activity}>
              <LevelPicker
                activity={activity}
                mine={abilities}
                onChange={(patch) => setLevels({ ...levels, ...patch })}
              />
            </Card>
          ))}
          {update.error && <Notice tone="danger">{update.error.message}</Notice>}
          <View style={styles.spacer} />
          <Button label="Next" loading={update.isPending} onPress={saveAndNext} />
          <Button variant="ghost" label="Back" onPress={() => setStep(0)} />
        </Appear>
      )}

      {step === 2 && (
        <Appear style={styles.step}>
          <T variant="title">How SamePace keeps people showing up</T>
          <Deal icon={MapPin} title="You both check in when you arrive">
            Your phone confirms you’re at the meeting point. No signal? There’s a 4-digit backup
            code.
          </Deal>
          <Deal icon={Clock} title="Free to cancel until 12 hours before">
            After that it’s $5 — waived if someone else takes your spot.
          </Deal>
          <Deal icon={CalendarCheck} title="Not showing up costs $10 and a strike">
            Two strikes in 60 days pauses public sessions for 14 days. The same rules apply to
            whoever hosts.
          </Deal>
          <T variant="caption" color="textSecondary">
            SamePace is free right now: fees are recorded on your account and nothing is charged to
            a card today. We’ll tell you before that changes.
          </T>
          <View style={styles.spacer} />
          <Button variant="accent" label="Got it — find a buddy" onPress={finish} />
          <Button variant="ghost" label="Back" onPress={() => setStep(1)} />
        </Appear>
      )}
    </Screen>
  );
}

function Deal({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MapPin;
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Row style={styles.deal}>
      <View style={[styles.dealIcon, { backgroundColor: theme.accentSoft }]}>
        <Icon size={18} color={theme.accent} strokeWidth={2} />
      </View>
      <View style={styles.flex}>
        <T variant="label">{title}</T>
        <T variant="caption" color="textSecondary">
          {children}
        </T>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  step: { flex: 1, gap: Spacing.three },
  flex: { flex: 1 },
  spacer: { flex: 1, minHeight: Spacing.three },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  deal: { alignItems: "flex-start", gap: Spacing.two },
  dealIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
