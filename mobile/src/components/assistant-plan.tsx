/**
 * How a plan the assistant is working on looks: the same photo card a session gets
 * (it becomes one), a five-step track from "joined" to "booked", who has approved,
 * and a timeline of what each side — and each side's assistant — has done.
 */
import { Check, Clock, MapPin } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { PhotoCard, Tag } from "@/components/session-card";
import { Notice, T, withAlpha } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { abilityLabel } from "@/lib/ability";
import { formatDuration, formatWhen } from "@/lib/format";
import { ACTIVITIES, type Venue } from "@/lib/types";

import type { AssistantPlan } from "../../../shared/assistant";

/** A proposed plan, drawn as the session it will become. */
export function PlanCard({
  plan,
  venues,
  label,
  footer,
}: {
  plan: AssistantPlan;
  venues: Venue[];
  /** A second tag beside the activity: "Proposed", "Option 2", "Agreed". */
  label?: string;
  footer?: ReactNode;
}) {
  const venue = venues.find((item) => item.id === plan.venueId);
  return (
    <PhotoCard
      venue={venue}
      minHeight={188}
      photoHeight={112}
      tags={
        <>
          <Tag label={ACTIVITIES[plan.activity].label} />
          {label ? <Tag label={label} /> : null}
        </>
      }
      footer={footer}
    >
      <View
        accessible
        accessibilityLabel={`${plan.title}. ${formatWhen(plan.startAt)}, ${formatDuration(plan.durationMin)}, at ${venue?.name ?? "a meeting point to be confirmed"}. ${abilityLabel(plan.ability)}.`}
      >
        <T variant="eyebrow" color="textSecondary">
          {formatWhen(plan.startAt)}
        </T>
        <T variant="heading">{plan.title}</T>
        <T variant="label">{abilityLabel(plan.ability)}</T>
        <View style={styles.meta}>
          <Fact icon={MapPin} text={venue ? `${venue.name} · ${venue.neighborhood}` : "—"} />
          <Fact icon={Clock} text={formatDuration(plan.durationMin)} />
        </View>
      </View>
      {!venue && (
        <Notice>
          The meeting point’s details didn’t load. Pull to refresh before approving this plan.
        </Notice>
      )}
    </PhotoCard>
  );
}

function Fact({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  const theme = useTheme();
  const color = withAlpha(theme.text, 0.82);
  return (
    <View style={styles.fact}>
      <Icon size={14} color={color} />
      <T variant="caption" style={{ color }}>
        {text}
      </T>
    </View>
  );
}

export const PLAN_STEPS = ["Joined", "Plan", "Approved", "Terms", "Booked"] as const;

/** Where a plan stands. `done` = how many steps are complete (0–5). */
export function PlanTrack({ done, stopped }: { done: number; stopped?: boolean }) {
  const theme = useTheme();
  const current = PLAN_STEPS[Math.min(done, PLAN_STEPS.length - 1)];
  return (
    <View
      accessible
      accessibilityLabel={
        stopped
          ? "This plan has ended."
          : done >= PLAN_STEPS.length
            ? "Booked."
            : `Step ${done + 1} of ${PLAN_STEPS.length}: ${current}.`
      }
      style={styles.track}
    >
      {PLAN_STEPS.map((step, index) => {
        const complete = index < done;
        const active = index === done && !stopped;
        const tone = stopped ? theme.textFaint : theme.accent;
        return (
          <View key={step} style={styles.trackStep}>
            <View style={styles.trackLine}>
              <View
                style={[
                  styles.rail,
                  {
                    backgroundColor:
                      index === 0 ? "transparent" : complete || active ? tone : theme.border,
                  },
                ]}
              />
              <View
                style={[
                  styles.dot,
                  complete
                    ? { backgroundColor: tone, borderColor: tone }
                    : active
                      ? { backgroundColor: withAlpha(tone, 0.16), borderColor: tone }
                      : { backgroundColor: "transparent", borderColor: theme.border },
                ]}
              >
                {complete && <Check size={11} color={theme.onAccent} strokeWidth={3} />}
              </View>
              <View
                style={[
                  styles.rail,
                  {
                    backgroundColor:
                      index === PLAN_STEPS.length - 1
                        ? "transparent"
                        : complete
                          ? tone
                          : theme.border,
                  },
                ]}
              />
            </View>
            <T
              variant="caption"
              color={complete || active ? "text" : "textFaint"}
              style={styles.trackLabel}
              numberOfLines={1}
            >
              {step}
            </T>
          </View>
        );
      })}
    </View>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

/** Who has said yes to the current plan: a ring closes around each person who has. */
export function Approvals({
  people,
  caption,
}: {
  people: { id: string; name: string; approved: boolean }[];
  caption: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.approvals}>
      <View style={styles.faces}>
        {people.map((person) => (
          <View
            key={person.id}
            accessible
            accessibilityLabel={`${person.name}: ${person.approved ? "approved" : "not yet approved"}`}
            style={[
              styles.face,
              {
                borderColor: person.approved ? theme.accent : theme.border,
                backgroundColor: person.approved ? theme.accentSoft : theme.field,
              },
            ]}
          >
            <T variant="caption" style={styles.faceText}>
              {initials(person.name)}
            </T>
            {person.approved && (
              <View style={[styles.tick, { backgroundColor: theme.accent }]}>
                <Check size={9} color={theme.onAccent} strokeWidth={3.5} />
              </View>
            )}
          </View>
        ))}
      </View>
      <T variant="caption" color="textSecondary" style={styles.flex}>
        {caption}
      </T>
    </View>
  );
}

/** One thing that happened, on a rail. `mine` events sit on the accent colour. */
export function TimelineItem({
  title,
  who,
  when,
  mine,
  last,
  children,
}: {
  title: string;
  who: string;
  when: string;
  mine: boolean;
  last: boolean;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.event}>
      <View style={styles.eventRail}>
        <View style={[styles.eventDot, { backgroundColor: mine ? theme.accent : theme.stand }]} />
        {!last && <View style={[styles.eventLine, { backgroundColor: theme.border }]} />}
      </View>
      <View style={styles.eventBody}>
        <T variant="label">{title}</T>
        <T variant="caption" color="textSecondary">
          {who} · {when}
        </T>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  meta: {
    marginTop: Spacing.one,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: Spacing.two,
    rowGap: Spacing.half,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: Spacing.half },
  track: { flexDirection: "row" },
  trackStep: { flex: 1, alignItems: "center", gap: Spacing.half },
  trackLine: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  rail: { flex: 1, height: 2 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  trackLabel: { fontSize: 11, lineHeight: 14 },
  approvals: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  faces: { flexDirection: "row", gap: 6 },
  face: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  faceText: { fontSize: 12, lineHeight: 16 },
  tick: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  event: { flexDirection: "row", gap: Spacing.two },
  eventRail: { width: 12, alignItems: "center" },
  eventDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  eventLine: { flex: 1, width: 2, marginTop: 4 },
  eventBody: { flex: 1, gap: 2, paddingBottom: Spacing.three },
});
