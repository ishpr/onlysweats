/**
 * A plan with one buddy is a place: this screen. One pinned button whose label is the
 * next step; three sheets; a menu. Approving from the chat happens in the Plan peek
 * instead, which draws the same body (components/plan-summary.tsx).
 */
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Clock, Flag, History, Sparkles, XCircle } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { ListCard, ListRow } from "@/components/list";
import { Skeleton } from "@/components/motion";
import { OverflowMenu } from "@/components/overflow-menu";
import { PlanSummary } from "@/components/plan-summary";
import { AssistantsSheet, HistorySheet, OtherTimesSheet } from "@/components/plan-sheets";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { useToast } from "@/components/toast";
import { Button, Notice, Screen, StateView, T } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { usePlanRoom } from "@/lib/plan-room";
import { useRefreshOnFocus } from "@/lib/queries";

export default function PlanRoute() {
  return <PrivateMember component={Plan} />;
}

type Open = "times" | "assistants" | "history" | "end" | null;

function Plan({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = usePlanRoom(id, member.id, session);
  const [open, setOpen] = useState<Open>(null);
  const { value, next, buddy } = plan;

  const press = async () => {
    if (!next) return;
    if (next.kind === "open-session")
      return router.push({ pathname: "/session/[id]", params: { id: next.sessionId } });
    if (next.kind === "find" || next.kind === "ended") return setOpen("assistants");
    const receipt = await plan.act();
    if (receipt) toast.show({ message: receipt });
  };
  const disabled =
    !next ||
    next.kind === "waiting" ||
    plan.busy ||
    ((next.kind === "approve" || next.kind === "book") && !plan.venueKnown);

  return (
    <Screen
      onRefresh={() => void plan.refresh()}
      refreshing={plan.room.isRefetching}
      footer={
        value && next ? (
          <>
            {next.kind === "join" && (
              <T variant="caption" color="textSecondary" style={styles.center}>
                {buddy} sees your first name, level and the times you allow — never your health
                data.
              </T>
            )}
            {(next.kind === "approve" || next.kind === "book") && !plan.venueKnown && (
              <T variant="caption" color="textSecondary" style={styles.center}>
                That meeting point isn’t offered any more. Suggest another time.
              </T>
            )}
            <View style={styles.actions}>
              {next.kind === "approve" && (
                <Button
                  style={styles.flex}
                  variant="soft"
                  label="Suggest another"
                  onPress={() => setOpen("times")}
                />
              )}
              <Button
                style={styles.flex}
                variant="accent"
                label={next.label}
                loading={plan.busy}
                disabled={disabled}
                onPress={() => void press()}
              />
            </View>
          </>
        ) : undefined
      }
    >
      <Stack.Screen
        options={{
          title: value ? `With ${buddy}` : "Plan",
          headerRight: () =>
            value ? (
              <OverflowMenu
                accessibilityLabel="Plan options"
                items={[
                  ...(plan.active
                    ? [
                        {
                          icon: XCircle,
                          label: "End this plan",
                          danger: true,
                          onPress: () => setOpen("end"),
                        },
                      ]
                    : []),
                  {
                    icon: Flag,
                    label: `Report ${buddy}`,
                    danger: true,
                    onPress: () =>
                      router.push({
                        pathname: "/report",
                        params: {
                          memberId: value.memberIds.find((m) => m !== member.id) ?? "",
                          name: buddy,
                          negotiationId: value.id,
                        },
                      }),
                  },
                ]}
              />
            ) : null,
        }}
      />
      {plan.ended && (
        <Notice>You left this plan. A booked session, if there was one, stays booked.</Notice>
      )}
      {plan.room.isPending && <Skeleton rows={4} />}
      {plan.room.error && (
        <StateView error={plan.room.error} onRetry={() => void plan.room.refetch()} />
      )}
      {value && <PlanSummary plan={plan} ownerId={member.id} />}
      {value && plan.joined && (
        <ListCard>
          {plan.bothJoined && plan.active && (
            <ListRow
              icon={Clock}
              label="Other times that fit both"
              onPress={() => setOpen("times")}
            />
          )}
          {plan.bothJoined && (
            <ListRow
              icon={Sparkles}
              label="Let our assistants work it out"
              onPress={() => setOpen("assistants")}
            />
          )}
          <ListRow icon={History} label="What’s happened" onPress={() => setOpen("history")} />
        </ListCard>
      )}
      {plan.error && <Notice tone="danger">{plan.error}</Notice>}

      <OtherTimesSheet
        visible={open === "times"}
        onClose={() => setOpen(null)}
        plan={plan}
        ownerId={member.id}
        session={session}
      />
      <AssistantsSheet
        visible={open === "assistants"}
        onClose={() => setOpen(null)}
        plan={plan}
        ownerId={member.id}
        session={session}
      />
      <HistorySheet
        visible={open === "history"}
        onClose={() => setOpen(null)}
        plan={plan}
        ownerId={member.id}
        session={session}
      />
      <ConfirmSheet
        visible={open === "end"}
        onClose={() => setOpen(null)}
        title="End this plan?"
        body={`Ends planning with ${buddy}. A booked session stays booked.`}
        confirm={{
          label: "End plan",
          danger: true,
          onPress: () => void plan.end().then(() => setOpen(null)),
        }}
        cancelLabel="Keep planning"
        busy={plan.busy}
        error={open === "end" ? plan.error : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  actions: { flexDirection: "row", gap: Spacing.one },
});
