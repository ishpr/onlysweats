import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { usePrivateAction } from "@/hooks/use-private-action";
import { beginVerification } from "@/lib/verification-flow";
import { Linking } from "react-native";

import { Button, Card, Notice, Row, Screen, T } from "@/components/ui";
import { SITE_URL } from "@/lib/config";
import { keys } from "@/lib/queries";
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
export default function VerifyRoute() {
  return <PrivateMember component={Verify} />;
}

function Verify({ member, session }: PrivateMemberProps) {
  const { tier: asked } = useLocalSearchParams<{ tier?: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [opened, setOpened] = useState<StartedVerification | null>(null);

  const v = member.verification;
  const refresh = () => client.invalidateQueries({ queryKey: keys.me });
  useEffect(() => {
    return () => {
      try {
        WebBrowser.dismissAuthSession();
      } catch {
        /* No browser sheet on this platform. */
      }
    };
  }, []);

  // Phone and face come first; the ID check builds on them.
  const [tier, setTier] = useState<VerificationTier>(() =>
    asked === "government_id" && v.member === "approved"
      ? "government_id"
      : asked === "member" || v.member !== "approved"
        ? "member"
        : "government_id",
  );
  const state = tier === "member" ? v.member : v.governmentId;
  const copy = COPY[tier];
  const error = action.error;

  const begin = () =>
    action.run(
      (signal) =>
        beginVerification({
          session,
          tier,
          signal,
          onStarted: setOpened,
          openBrowser: (url) => WebBrowser.openAuthSessionAsync(url, "samepace://verified"),
        }),
      refresh,
    );
  const completeDevelopmentCheck = (outcome: "approved" | "declined") => {
    if (!opened) return;
    return action.run(
      (signal) =>
        session.request(`/verification/${encodeURIComponent(opened.id)}/dev-complete`, {
          method: "POST",
          json: { outcome },
          signal,
        }),
      refresh,
    );
  };

  return (
    <Screen edges={["bottom"]}>
      <T variant="title">{copy.title}</T>
      <T color="textSecondary">
        {tier === "member" && !v.enforced
          ? "A phone and selfie check helps a workout buddy know you are a real, reachable person. Verification is optional while the service is being introduced."
          : copy.why}
      </T>

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
      {error && <Notice tone="danger">{error}</Notice>}

      {opened?.provider === "dev" && !opened.url && state !== "approved" && (
        <Card>
          <T variant="label">Development stand-in</T>
          <T variant="caption" color="textSecondary">
            No Persona key on this server, so there’s no real check. Pick how it comes out.
          </T>
          <Row>
            <Button
              variant="soft"
              label="Decline"
              loading={action.busy}
              onPress={() => void completeDevelopmentCheck("declined")}
            />
            <Button
              variant="accent"
              label="Approve"
              loading={action.busy}
              onPress={() => void completeDevelopmentCheck("approved")}
            />
          </Row>
        </Card>
      )}

      {state === "approved" ? (
        <>
          {tier === "member" && v.governmentId !== "approved" && v.available && (
            <Button
              label="Continue to ID verification"
              variant="soft"
              onPress={() => {
                setOpened(null);
                setTier("government_id");
              }}
            />
          )}
          <Button
            label="Done"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/you"))}
          />
        </>
      ) : (
        v.available &&
        state !== "needs_review" && (
          <Button
            variant="accent"
            label={state === "pending" ? "Continue" : state === "declined" ? "Try again" : "Start"}
            loading={action.busy}
            onPress={() => void begin()}
          />
        )
      )}
    </Screen>
  );
}
