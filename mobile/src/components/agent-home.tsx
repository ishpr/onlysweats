/**
 * The app is the conversation (PRD v0.4). This is what opens: your agent speaks first, from
 * what it actually knows about you — your goal, your partner, your next session — and every
 * thing it offers is a card with one button. The real conversation (cloud) sits underneath
 * when available; any local availability notices remain distinct from model replies.
 */
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronRight,
  MapPin,
  Search,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { AssistantOrb, useAssistantStatus } from "@/components/assistant-hero";
import { ChatBubble } from "@/components/assistant-kit";
import { PressScale } from "@/components/motion";
import { PlanTrack } from "@/components/assistant-plan";
import { Card, T, withAlpha } from "@/components/ui";
import { HitTarget, Radius, Spacing } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import type { ApiSession } from "@/lib/api";
import { formatWhen, inCheckinWindow } from "@/lib/format";
import { firstName } from "@/lib/names";
import { nextAgentSession } from "@/lib/assistant/home-session";
import { useMine } from "@/lib/queries";
import type { Me, TrainingBlock } from "@/lib/types";

/** A thing the agent offers: one line, one button. */
export function AgentCard({
  icon: Icon,
  eyebrow,
  title,
  detail,
  action,
  onPress,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  detail?: string;
  action: string;
  onPress: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <Icon size={18} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <T variant="eyebrow" color="accent">
            {eyebrow}
          </T>
          <T variant="label">{title}</T>
          {detail ? (
            <T variant="caption" color="textSecondary">
              {detail}
            </T>
          ) : null}
        </View>
      </View>
      {children}
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onPress}
        style={[styles.action, { backgroundColor: theme.primary }]}
      >
        <T variant="label" style={{ color: theme.onPrimary }}>
          {action}
        </T>
        <ChevronRight size={18} color={theme.onPrimary} />
      </PressScale>
    </Card>
  );
}

/** Quick replies under the agent's opening. */
export function Chips({ items }: { items: { label: string; onPress: () => void }[] }) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {items.map((item) => (
        <PressScale
          key={item.label}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          onPress={item.onPress}
          style={[
            styles.chip,
            { backgroundColor: theme.chip, borderColor: withAlpha(theme.accent, 0.4) },
          ]}
        >
          <T variant="label" color="accent">
            {item.label}
          </T>
        </PressScale>
      ))}
    </View>
  );
}

/**
 * The agent's opening: what it knows, what's next, what it offers. Everything here reads real
 * state; nothing is invented. `onSay` puts words in the composer so a chip is a message.
 */
export function AgentOpening({
  me,
  session,
  onSay,
}: {
  me: Me;
  session: ApiSession;
  onSay: (text: string) => void;
}) {
  const router = useRouter();
  const mine = useMine();
  const status = useAssistantStatus(me.id, session);
  const privateGoal = useQuery({
    queryKey: ["private-agent-goal", me.id],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{
        goal: { label: string; activity: string; date: string; revision: number } | null;
      }>("/assistant/goal", { signal }),
  });
  const name = firstName(me.name);
  const now = useNow(15_000);

  const goals = (mine.data?.trainingBlocks ?? []).filter(
    (b) => b.viewer === "member" && (b.status === "forming" || b.status === "active"),
  );
  const goal: TrainingBlock | undefined = goals[0];
  const savedGoal = privateGoal.error ? null : privateGoal.data?.goal;
  const intention = savedGoal
    ? { label: savedGoal.label, date: savedGoal.date }
    : goal
      ? { label: goal.goalLabel, date: goal.goalDate.split("T")[0] }
      : null;
  const plan = !mine.error
    ? nextAgentSession(me.id, mine.data?.sessions ?? [], mine.data?.bookings ?? [], now)
    : undefined;
  const next = plan?.session;
  const myBooking = plan?.booking;
  const awaitingApproval = myBooking?.status === "pending";
  const live = next && myBooking?.status === "confirmed" && inCheckinWindow(next.startAt, now);
  const otherId =
    myBooking?.status === "confirmed"
      ? plan?.hosting
        ? myBooking.participantId
        : next?.hostId
      : undefined;
  const other = otherId ? (mine.data?.people ?? []).find((p) => p.id === otherId) : undefined;
  const looking = status.data?.state === "looking";
  const needsMe = status.data?.state === "needs_you";
  const hasLevel = Object.keys(me.abilities).length > 0;

  // The one sentence, chosen by what's true.
  let greeting: string;
  if (live && next)
    greeting = `Check-in is open for ${next.title}. Check in when you reach the meeting point.`;
  else if (needsMe) greeting = status.data!.headline + ".";
  else if (next)
    greeting = `${awaitingApproval ? "Waiting for approval" : "Next up"}: ${next.title}, ${formatWhen(next.startAt)}.`;
  else if (looking)
    greeting = `Your saved preferences are guiding the search${intention ? ` for ${intention.label}` : ""}. Your agents can coordinate within your shared-planning permissions.`;
  else if (intention)
    greeting = `You're working toward ${intention.label} by ${intention.date}. Want me to find you a partner for it?`;
  else if (!hasLevel)
    greeting = `Hi${name ? ` ${name}` : ""}. I can help you plan your workouts and look for a partner at your level. What are you working toward?`;
  else
    greeting = `Hi${name ? ` ${name}` : ""}. What are you working toward? I can help you plan and look for someone with a similar goal.`;

  const chips = live
    ? []
    : needsMe
      ? []
      : next && !intention
        ? [
            { label: "Set a goal", onPress: () => onSay("I want to set a goal") },
            { label: "Find me a partner", onPress: () => onSay("Find me a partner") },
            { label: "Post another", onPress: () => onSay("Post a session this week") },
          ]
        : looking
          ? [
              { label: "How's it going?", onPress: () => onSay("How's the search going?") },
              {
                label: "Post a run instead",
                onPress: () => onSay("Post a run this week that others can join"),
              },
            ]
          : intention
            ? [
                {
                  label: "Find me a partner",
                  onPress: () => onSay(`Find me a partner for ${intention.label}`),
                },
                { label: "Post a session", onPress: () => onSay("Post a session this week") },
                {
                  label: "Make me a plan",
                  onPress: () => onSay(`Make me a training plan for ${intention.label}`),
                },
              ]
            : [
                { label: "A race", onPress: () => onSay("I'm training for a race") },
                { label: "A habit", onPress: () => onSay("I want to work out three times a week") },
                { label: "Get stronger", onPress: () => onSay("I want to get stronger") },
              ];

  return (
    <View style={styles.opening}>
      <ChatBubble from="assistant" source="Your agent">
        <T>{greeting}</T>
      </ChatBubble>
      {chips.length > 0 && <Chips items={chips} />}

      {live && next && (
        <AgentCard
          icon={MapPin}
          eyebrow="Now"
          title={next.title}
          detail="Both of you check in at the meeting point."
          action="Check in"
          onPress={() =>
            myBooking
              ? router.push({ pathname: "/live/[id]", params: { id: myBooking.id } })
              : router.push({ pathname: "/session/[id]", params: { id: next.id } })
          }
        />
      )}
      {needsMe && status.data?.negotiationId && (
        <AgentCard
          icon={UserRound}
          eyebrow="Needs you"
          title={status.data.headline}
          detail={status.data.detail}
          action="Review"
          onPress={() =>
            router.push({
              pathname: "/assistant/plan/[id]",
              params: { id: status.data!.negotiationId! },
            })
          }
        />
      )}
      {!live && next && (
        <AgentCard
          icon={CalendarPlus}
          eyebrow={awaitingApproval ? "Waiting for approval" : "Next session"}
          title={next.title}
          detail={`${formatWhen(next.startAt)}${other ? ` · with ${firstName(other.name)}` : ""}`}
          action="Open session"
          onPress={() => router.push({ pathname: "/session/[id]", params: { id: next.id } })}
        />
      )}
      {savedGoal && !goal && (
        <AgentCard
          icon={Target}
          eyebrow="Your goal"
          title={savedGoal.label}
          detail={`Working toward ${savedGoal.date}`}
          action="See progress"
          onPress={() => onSay(`How am I progressing toward ${savedGoal.label}?`)}
        />
      )}
      {goal && (
        <AgentCard
          icon={Target}
          eyebrow="Your goal"
          title={goal.goalLabel}
          detail={`${goal.my.kept} of ${goal.my.planned} sessions kept · ends ${formatWhen(goal.goalDate).split(" · ")[0]}`}
          action="See progress"
          onPress={() => router.push({ pathname: "/training-block/[id]", params: { id: goal.id } })}
        >
          <PlanTrack
            done={Math.min(5, Math.round((5 * goal.my.kept) / Math.max(1, goal.my.planned)))}
          />
        </AgentCard>
      )}
      {looking && !needsMe && (
        <Card style={styles.looking}>
          <AssistantOrb state="looking" size={44} />
          <View style={styles.flex}>
            <T variant="label">Looking for your partner</T>
            <T variant="caption" color="textSecondary">
              {status.data?.detail}
            </T>
          </View>
        </Card>
      )}
      {!intention && !next && !looking && hasLevel && (
        <AgentCard
          icon={Search}
          eyebrow="Or"
          title="Find me a partner now"
          detail="Someone at your level, nearby, free when you are."
          action="Start looking"
          onPress={() => onSay("Find me a partner")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  opening: { gap: Spacing.two },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one, paddingLeft: 44 },
  chip: {
    minHeight: HitTarget - 4,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: "center",
  },
  card: { gap: Spacing.two },
  cardHead: { flexDirection: "row", gap: Spacing.two, alignItems: "center" },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    minHeight: HitTarget + 4,
    borderRadius: Radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  looking: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
});
