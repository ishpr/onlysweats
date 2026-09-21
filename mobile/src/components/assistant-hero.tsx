/**
 * The assistant, as something you can see working: a live orb, one sentence about
 * what it is doing for you right now, and the single next thing it needs from you.
 * It finds and proposes; the member approves every plan — the hero never hides that.
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Bot,
  ChevronRight,
  ClipboardList,
  Handshake,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { PressScale } from "@/components/motion";
import { Button, Card, Row, T, withAlpha } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, captureApiSession, type ApiSession } from "@/lib/api";
import { ACTIVITIES } from "@/lib/types";

import type { AssistantNegotiation, AssistantPreferences } from "../../../shared/assistant";
import type { MemberDiscovery } from "../../../shared/discovery";

export type AssistantState = "off" | "ready" | "looking" | "needs_you" | "booked";

export type AssistantStatus = {
  state: AssistantState;
  eyebrow: string;
  headline: string;
  detail: string;
  /** The conversation that needs the member, when one does. */
  negotiationId: string | null;
};

const otherName = (room: AssistantNegotiation, meId: string) =>
  room.memberNames?.[room.memberIds.find((id) => id !== meId) ?? ""] ?? "your buddy";

/** One sentence of truth about the assistant, from what the API already says. */
export function assistantStatus(
  meId: string,
  preferences: AssistantPreferences | null,
  discovery: MemberDiscovery | null,
  negotiations: AssistantNegotiation[],
): AssistantStatus {
  const live = negotiations.filter((room) => room.state === "open" || room.state === "approved");
  const invited = live.find((room) => !room.consentedIds.includes(meId));
  if (invited) {
    return {
      state: "needs_you",
      eyebrow: "Needs you",
      headline: `${otherName(invited, meId)} wants to plan a workout`,
      detail: "Nothing is shared or booked until you join.",
      negotiationId: invited.id,
    };
  }
  const toReview = live.find(
    (room) =>
      (room.state === "open" && room.plan !== null && !room.confirmedIds.includes(meId)) ||
      (room.state === "approved" && !room.booked),
  );
  if (toReview) {
    return {
      state: "needs_you",
      eyebrow: "Needs you",
      headline: toReview.plan ? `A plan is ready: ${toReview.plan.title}` : "A plan is ready",
      detail: `With ${otherName(toReview, meId)}. Nothing is booked until you both approve.`,
      negotiationId: toReview.id,
    };
  }
  const activity = preferences ? ACTIVITIES[preferences.activity].label.toLowerCase() : "workout";
  if (discovery?.enabled) {
    const found = discovery.candidates.length;
    return {
      state: "looking",
      eyebrow: "Looking",
      headline: `Looking for your ${activity} buddy`,
      detail:
        found > 0
          ? `${found} ${found === 1 ? "person fits" : "people fit"} your times and places so far.`
          : "Matching your level, times and places. You’ll hear when someone fits.",
      negotiationId: null,
    };
  }
  if (live.length > 0) {
    return {
      state: "looking",
      eyebrow: "Working",
      headline: `Working out a plan with ${otherName(live[0], meId)}`,
      detail: "Comparing times and places you’ve both allowed.",
      negotiationId: live[0].id,
    };
  }
  if (preferences?.enabled) {
    return {
      state: "ready",
      eyebrow: "Ready",
      headline: "Ready when you are",
      detail: "It knows what you’re after. Let it look for a new buddy, or plan with a past one.",
      negotiationId: null,
    };
  }
  return {
    state: "off",
    eyebrow: "Off",
    headline: "An assistant that finds your buddy",
    detail:
      "Tell it what you’re after. It looks for the right person and proposes a plan — you approve every step.",
    negotiationId: null,
  };
}

/** Rings that breathe while the assistant is working; still when it is off. */
export function AssistantOrb({ state, size = 72 }: { state: AssistantState; size?: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const active = state === "looking" || state === "needs_you";
  const color = state === "off" ? theme.textFaint : theme.accent;
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {active && !reduced && <Pulse size={size} color={color} delay={0} />}
      {active && !reduced && <Pulse size={size} color={color} delay={900} />}
      <View
        style={[
          styles.core,
          {
            width: size * 0.62,
            height: size * 0.62,
            borderRadius: size,
            left: size * 0.19,
            top: size * 0.19,
            backgroundColor: withAlpha(color, state === "off" ? 0.12 : 0.16),
            borderColor: withAlpha(color, 0.35),
          },
        ]}
      >
        <Bot size={size * 0.32} color={color} />
      </View>
    </View>
  );
}

function Pulse({ size, color, delay }: { size: number; color: string; delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 0.62 + 0.38 * progress.value }],
  }));
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: size, borderWidth: 1.5, borderColor: color },
        style,
      ]}
    />
  );
}

/** The top of the assistant screen. */
export function AssistantHero({
  status,
  brief,
  onPrimary,
  primaryLabel,
  onEditBrief,
}: {
  status: AssistantStatus;
  /** What it works from, as short chips: "Run", "45 min", "3 places", "4 times". */
  brief: string[];
  primaryLabel: string;
  onPrimary: () => void;
  onEditBrief: () => void;
}) {
  const theme = useTheme();
  return (
    <Card>
      <Row style={styles.heroRow}>
        <AssistantOrb state={status.state} size={84} />
        <View style={styles.flex}>
          <T variant="eyebrow" color={status.state === "off" ? "textFaint" : "accent"}>
            {status.eyebrow}
          </T>
          <T variant="heading">{status.headline}</T>
          <T variant="caption" color="textSecondary">
            {status.detail}
          </T>
        </View>
      </Row>
      {brief.length > 0 && (
        <PressScale
          accessibilityRole="button"
          accessibilityLabel={`What it looks for: ${brief.join(", ")}. Edit`}
          onPress={onEditBrief}
          style={[styles.brief, { backgroundColor: theme.field }]}
        >
          <View style={styles.briefChips}>
            {brief.map((item) => (
              <View
                key={item}
                style={[
                  styles.briefChip,
                  { backgroundColor: theme.chip, borderColor: theme.border },
                ]}
              >
                <T variant="caption">{item}</T>
              </View>
            ))}
          </View>
          <T variant="caption" color="accent">
            Edit
          </T>
        </PressScale>
      )}
      <Button label={primaryLabel} variant="accent" onPress={onPrimary} />
      <View style={styles.steps}>
        <Step icon={ClipboardList} label="You say what you’re after" />
        <Step icon={Search} label="It finds and proposes" />
        <Step icon={Handshake} label="You both approve" />
      </View>
    </Card>
  );
}

function Step({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepIcon, { backgroundColor: theme.accentSoft }]}>
        <Icon size={16} color={theme.accent} />
      </View>
      <T variant="caption" color="textSecondary" style={styles.stepText}>
        {label}
      </T>
    </View>
  );
}

/** Home: the assistant in one row — alive when it is working, and one tap from its screen. */
export function AssistantSpot({ ownerId }: { ownerId: string }) {
  const [session] = useState(captureApiSession);
  return session ? <Spot ownerId={ownerId} session={session} /> : null;
}

function Spot({ ownerId, session }: { ownerId: string; session: ApiSession }) {
  const router = useRouter();
  const theme = useTheme();
  const query = useQuery({
    queryKey: ["private-assistant", ownerId, "home-status"],
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const [preferences, discovery, rooms] = await Promise.all([
        session.request<{ preferences: AssistantPreferences }>("/agents/preferences", { signal }),
        session
          .request<{ discovery: MemberDiscovery }>("/agents/discovery", { signal })
          .catch(() => null),
        session.request<{ negotiations: AssistantNegotiation[] }>("/agents/negotiations", {
          signal,
        }),
      ]);
      return assistantStatus(
        ownerId,
        preferences.preferences,
        discovery?.discovery ?? null,
        rooms.negotiations,
      );
    },
  });
  // Not switched on for this account (or not reachable): Home stays quiet about it.
  if (!query.data || (query.error instanceof ApiError && query.error.status === 404)) return null;
  const status = query.data;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`Your assistant. ${status.headline}. ${status.detail}`}
      onPress={() =>
        router.push(
          status.negotiationId
            ? { pathname: "/assistant", params: { negotiationId: status.negotiationId } }
            : "/assistant",
        )
      }
      scaleTo={0.98}
    >
      <Card style={styles.spot}>
        <AssistantOrb state={status.state} size={56} />
        <View style={styles.flex}>
          <T variant="eyebrow" color={status.state === "off" ? "textSecondary" : "accent"}>
            Your assistant · {status.eyebrow}
          </T>
          <T variant="label" numberOfLines={2}>
            {status.headline}
          </T>
        </View>
        <ChevronRight size={18} color={theme.textFaint} />
      </Card>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  core: { position: "absolute", alignItems: "center", justifyContent: "center", borderWidth: 1 },
  heroRow: { alignItems: "center", gap: Spacing.three },
  brief: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.lg,
    padding: Spacing.two,
    minHeight: 44,
  },
  briefChips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  briefChip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  steps: { flexDirection: "row", gap: Spacing.one },
  step: { flex: 1, alignItems: "center", gap: 6 },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 12, lineHeight: 16, textAlign: "center" },
  spot: { flexDirection: "row", alignItems: "center", gap: Spacing.two, padding: Spacing.two },
});
