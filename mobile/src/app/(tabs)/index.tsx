/**
 * Home is the conversation (PRD v0.4). Your agent opens, from what it knows; what it offers
 * are cards with one button; the real conversation runs underneath. What used to be
 * Home — your sessions, weekly sessions, picks — lives on the
 * Sessions tab.
 */
import { useState } from "react";
import * as Crypto from "expo-crypto";
import { storePreferenceDraft } from "@/lib/assistant/preference-handoff";

import { AgentOpening } from "@/components/agent-home";
import { CloudChat } from "@/components/assistant-chat/cloud-chat";
import { AppHeader, LiveBanner } from "@/components/brand";
import { ComposerDock } from "@/components/composer-dock";
import { PlanPeek } from "@/components/plan-peek";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Screen } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { inCheckinWindow } from "@/lib/format";
import { useMine, useRefreshOnFocus } from "@/lib/queries";
import { useRouter } from "expo-router";

export default function HomeRoute() {
  return <PrivateMember component={Home} />;
}

function Home({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const router = useRouter();
  const now = useNow(15_000);
  const mine = useMine();
  const live = (mine.data?.bookings ?? []).find((b) => {
    if (
      mine.error ||
      (b.participantId !== member.id && b.hostId !== member.id) ||
      b.status !== "confirmed"
    )
      return false;
    const s = mine.data?.sessions.find((x) => x.id === b.sessionId);
    return Boolean(s?.status === "open" && inCheckinWindow(s.startAt, now));
  });
  const [dockHeight, setDockHeight] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; at: number } | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const say = (text: string) => setPrefill({ text, at: now + Math.random() });

  return (
    <>
      <Screen
        hidesTabBar
        header={
          <>
            <AppHeader />
            {live && <LiveBanner bookingId={live.id} />}
          </>
        }
        contentStyle={dockHeight > 0 ? { paddingBottom: dockHeight + 120 } : undefined}
      >
        <AgentOpening me={member} session={session} onSay={say} />
        <CloudChat
          ownerId={member.id}
          session={session}
          prefill={prefill}
          onDevice={() => router.push({ pathname: "/assistant", params: { mode: "device" } })}
          onPlanning={(kind, targetId, draft) => {
            if (!session.isCurrent()) return;
            if (kind === "negotiation" && targetId) return setPeek(targetId);
            const preferenceDraftId =
              kind === "preferences" && draft ? Crypto.randomUUID() : undefined;
            if (preferenceDraftId && draft)
              storePreferenceDraft(preferenceDraftId, member.id, draft, session.isCurrent);
            router.push({
              pathname: "/assistant",
              params: { planning: "1", ...(preferenceDraftId ? { preferenceDraftId } : {}) },
            });
          }}
        />
      </Screen>
      <ComposerDock aboveTabBar onHeight={setDockHeight} />
      {peek && (
        <PlanPeek
          id={peek}
          ownerId={member.id}
          session={session}
          visible
          onClose={() => setPeek(null)}
        />
      )}
    </>
  );
}
