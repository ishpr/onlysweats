import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Linking } from "react-native";

import { Button, Card, Notice, Row, Screen, StateView, T } from "@/components/ui";
import { SITE_URL } from "@/lib/config";
import {
  useDevCompleteVerification,
  useMe,
  useRefreshVerification,
  useStartVerification,
} from "@/lib/queries";
import type { StartedVerification, VerificationTier } from "@/lib/types";

const COPY: Record<VerificationTier, { title: string; why: string; steps: string[] }> = {
  member: {
    title: "Verify it’s you",
    why: "Everyone on a public session has done this. It’s how a stranger at the trailhead is a real, reachable person — and it takes about a minute, once.",
    steps: ["A text to your phone", "A short selfie video, to check there’s a person there"],
  },
  government_id: {
    title: "Verify your ID",
    why: "Women-only sessions ask for this, and so does coming back after a report. It makes a member accountable. It is not a test of who counts as a woman — that stays what you tell us.",
    steps: ["A photo of a government ID", "A selfie, matched to the photo on it"],
  },
};

/**
 * Identity verification. Persona runs it in a browser sheet and sees the selfie
 * and the ID; SamePace only ever learns how it came out. This screen says so
 * before anything is asked for.
 */
export default function Verify() {
  const { tier: asked } = useLocalSearchParams<{ tier?: string }>();
  const router = useRouter();
  const me = useMe();
  const start = useStartVerification();
  const refresh = useRefreshVerification();
  const dev = useDevCompleteVerification();
  const [opened, setOpened] = useState<StartedVerification | null>(null);

  const v = me.data?.verification;
  if (!v) {
    return (
      <Screen edges={["bottom"]}>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }

  // Phone and face come first; the ID check builds on them.
  const tier: VerificationTier =
    asked === "government_id" && v.member === "approved"
      ? "government_id"
      : v.member !== "approved"
        ? "member"
        : "government_id";
  const state = tier === "member" ? v.member : v.governmentId;
  const copy = COPY[tier];
  const error = start.error ?? refresh.error ?? dev.error;

  async function begin() {
    const started = await start.mutateAsync(tier).catch(() => null);
    if (!started) return;
    setOpened(started);
    if (!started.url) return; // the dev stand-in: its buttons are below
    // Persona's page hands back to `samepace://verified`, which closes the sheet.
    await WebBrowser.openAuthSessionAsync(started.url, "samepace://verified");
    refresh.mutate(started.id);
  }

  return (
    <Screen edges={["bottom"]}>
      <T variant="title">{copy.title}</T>
      <T color="textSecondary">{copy.why}</T>

      <Card>
        <T variant="eyebrow" color="stand">
          What it asks for
        </T>
        {copy.steps.map((s) => (
          <T key={s}>· {s}</T>
        ))}
      </Card>

      <Card>
        <T variant="eyebrow" color="stand">
          Who sees it
        </T>
        <T variant="caption" color="textSecondary">
          Persona, the company that runs the check, sees your photo
          {tier === "member" ? " and number" : " and ID"}. SamePace never does: we’re told whether
          it passed, and nothing else. Other members see the word “Verified”. Delete your account
          and we ask Persona to delete what it holds too.
        </T>
        <Button
          variant="ghost"
          label="Privacy"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${SITE_URL}/privacy`)}
        />
      </Card>

      {state === "approved" && <Notice>Done — this one is verified.</Notice>}
      {state === "needs_review" && (
        <Notice>A person is looking at your last try. You’ll get a notification either way.</Notice>
      )}
      {state === "pending" && !opened && (
        <Notice>You started this. Pick it back up where you left off.</Notice>
      )}
      {state === "declined" && (
        <Notice>
          It didn’t go through last time — usually the light, or a blurry photo. You can try again.
        </Notice>
      )}
      {!v.available && <Notice>Verification isn’t open yet. Nothing is locked until it is.</Notice>}
      {error && <Notice tone="danger">{error.message}</Notice>}

      {opened && !opened.url && state !== "approved" && (
        <Card>
          <T variant="label">Development stand-in</T>
          <T variant="caption" color="textSecondary">
            No Persona key on this server, so there’s no real check. Pick how it comes out.
          </T>
          <Row>
            <Button
              variant="soft"
              label="Decline"
              loading={dev.isPending}
              onPress={() => dev.mutate({ id: opened.id, outcome: "declined" })}
            />
            <Button
              variant="accent"
              label="Approve"
              loading={dev.isPending}
              onPress={() => dev.mutate({ id: opened.id, outcome: "approved" })}
            />
          </Row>
        </Card>
      )}

      {state === "approved" ? (
        <Button label="Done" onPress={() => router.back()} />
      ) : (
        v.available &&
        state !== "needs_review" && (
          <Button
            variant="accent"
            label={state === "pending" ? "Continue" : state === "declined" ? "Try again" : "Start"}
            loading={start.isPending || refresh.isPending}
            onPress={() => void begin()}
          />
        )
      )}
    </Screen>
  );
}
