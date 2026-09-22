/**
 * The body a plan shows wherever it appears — the Plan screen and the Plan peek share
 * it, so the two never disagree. Track, the plan as the session it will become, who has
 * approved, and the terms as chips once it's time to book.
 */
import { StyleSheet, View } from "react-native";

import { Approvals, PlanCard, PlanTrack } from "@/components/assistant-plan";
import { T } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { termsChips, type PlanRoom } from "@/lib/plan-room";

export function PlanSummary({ plan, ownerId }: { plan: PlanRoom; ownerId: string }) {
  const theme = useTheme();
  const { value, buddy, done, stopped, status, review, next, venues } = plan;
  if (!value) return null;
  const chips =
    next?.kind === "book" || next?.kind === "waiting" ? termsChips(ownerId, review) : [];
  return (
    <View style={styles.wrap}>
      <PlanTrack done={done} stopped={stopped} />
      <T variant="caption" color="textSecondary">
        {status}
      </T>
      {value.plan ? (
        <>
          <PlanCard
            plan={value.plan}
            venues={venues}
            label={value.state === "approved" || value.booked ? "Agreed" : "Proposed"}
          />
          <Approvals
            people={value.memberIds.map((memberId) => ({
              id: memberId,
              name: memberId === ownerId ? "You" : buddy,
              approved: value.confirmedIds.includes(memberId),
            }))}
            caption={
              value.confirmedIds.length === value.memberIds.length
                ? "You’ve both approved this plan."
                : "Both of you approve before anything is booked."
            }
          />
        </>
      ) : (
        <T color="textSecondary">
          {plan.joined
            ? plan.bothJoined
              ? "No plan yet. Your assistants can look for times that fit you both."
              : `Nothing is shared until ${buddy} joins.`
            : `${buddy} wants to plan a workout with you. Join and you’ll both see times and places you each allow — never your health data.`}
        </T>
      )}
      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <View
              key={chip}
              style={[styles.chip, { backgroundColor: theme.chip, borderColor: theme.border }]}
            >
              <T variant="caption">{chip}</T>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
});
