import { useRouter } from "expo-router";
import { BadgeCheck, Eye, IdCard, Lock, Smartphone } from "lucide-react-native";
import { useState } from "react";

import { ListCard, ListRow } from "@/components/list";
import { StatusHero, type HeroTone } from "@/components/settings-kit";
import { Sheet } from "@/components/sheet";
import { Button, Screen, StateView, T } from "@/components/ui";
import { useMe } from "@/lib/queries";
import type { Verification } from "@/lib/types";

function read(v: Verification): {
  tone: HeroTone;
  eyebrow: string;
  title: string;
  detail: string;
  action: { label: string; tier: "member" | "government_id" } | null;
} {
  if (!v.available)
    return {
      tone: "quiet",
      eyebrow: "Not open yet",
      title: "Verification isn’t open yet",
      detail: "Nothing is locked. We’ll tell you when it’s ready.",
      action: null,
    };
  if (v.idRequired && v.governmentId !== "approved")
    return {
      tone: "attention",
      eyebrow: "ID needed",
      title: "Public sessions need an ID check first",
      detail: "A report about you was acted on. A government ID check reopens them.",
      action: { label: "Verify your ID", tier: "government_id" },
    };
  if (v.governmentId === "approved")
    return {
      tone: "good",
      eyebrow: "Verified · ID",
      title: "Phone, face and ID verified",
      detail: "Buddies see ‘Verified’ by your name. Nothing else.",
      action: null,
    };
  if (v.member === "approved")
    return {
      tone: "good",
      eyebrow: "Verified",
      title: "You’re verified",
      detail: "Buddies see ‘Verified’ by your name. Women-only sessions also ask for an ID.",
      action: null,
    };
  if (v.member === "needs_review" || v.member === "pending")
    return {
      tone: "working",
      eyebrow: "Being checked",
      title: "A person is looking at it",
      detail: "You’ll get a notification either way.",
      action: null,
    };
  if (v.member === "declined")
    return {
      tone: "attention",
      eyebrow: "Didn’t go through",
      title: "That check didn’t pass",
      detail: "Usually the light, or a blurry photo. You can try again.",
      action: { label: "Try again", tier: "member" },
    };
  return {
    tone: "quiet",
    eyebrow: "Not verified yet",
    title: "Get the Verified mark",
    detail: v.enforced
      ? "Public sessions ask for it: a phone and a selfie check, about a minute, once."
      : "Buddies meet strangers. It tells them you’re a real, reachable person. About a minute, once.",
    action: { label: "Verify now", tier: "member" },
  };
}

export default function VerificationSettings() {
  const router = useRouter();
  const me = useMe();
  const [about, setAbout] = useState<"who" | "privacy" | null>(null);
  if (!me.data) {
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }
  const v = me.data.verification;
  const state = read(v);
  const tierLabel = (t: Verification["member"]) =>
    t === "approved"
      ? "Verified"
      : t === "needs_review" || t === "pending"
        ? "Being checked"
        : t === "declined"
          ? "Didn’t pass"
          : "Not yet";
  return (
    <Screen
      footer={
        state.action ? (
          <Button
            variant="accent"
            label={state.action.label}
            onPress={() =>
              router.push({ pathname: "/verify", params: { tier: state.action!.tier } })
            }
          />
        ) : undefined
      }
    >
      <StatusHero
        icon={BadgeCheck}
        tone={state.tone}
        eyebrow={state.eyebrow}
        title={state.title}
        detail={state.detail}
      />
      <ListCard>
        <ListRow
          icon={Smartphone}
          label="Phone and face"
          value={tierLabel(v.member)}
          valueTone={v.member === "approved" ? "accent" : "muted"}
          onPress={() =>
            v.available && v.member !== "approved"
              ? router.push({ pathname: "/verify", params: { tier: "member" } })
              : undefined
          }
        />
        <ListRow
          icon={IdCard}
          label="Government ID"
          detail="Needed for women-only sessions."
          value={tierLabel(v.governmentId)}
          valueTone={v.governmentId === "approved" ? "accent" : "muted"}
          onPress={() =>
            v.available && v.member === "approved" && v.governmentId !== "approved"
              ? router.push({ pathname: "/verify", params: { tier: "government_id" } })
              : undefined
          }
        />
        <ListRow icon={Eye} label="Who sees what" onPress={() => setAbout("who")} />
        <ListRow icon={Lock} label="Privacy" onPress={() => setAbout("privacy")} />
      </ListCard>
      <Sheet visible={about === "who"} onClose={() => setAbout(null)} title="Who sees what">
        <T color="textSecondary">
          Other members see a ‘Verified’ mark by your first name — and nothing else. Not your phone
          number, not your photo, not your ID.
        </T>
      </Sheet>
      <Sheet visible={about === "privacy"} onClose={() => setAbout(null)} title="Your privacy">
        <T color="textSecondary">
          Persona runs the check in its own secure flow. SamePace never sees your selfie or your ID;
          it only learns whether the check passed. Deleting your account asks Persona to delete the
          check too.
        </T>
      </Sheet>
    </Screen>
  );
}
