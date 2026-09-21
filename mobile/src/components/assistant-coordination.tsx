import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { View } from "react-native";
import { Button, Notice, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import type {
  AssistantCoordination,
  AssistantNegotiation,
  AssistantPreferences,
} from "../../../shared/assistant";

const STATUS = {
  queued: "Ready to start",
  negotiating: "Assistants are finding a plan",
  awaiting_review: "A proposal is ready for your review",
  no_match: "No shared plan found",
  cancelled: "Coordination stopped",
  expired: "Coordination expired",
} as const;
const STEP = {
  proposed: "Proposed a plan",
  counterproposed: "Suggested a different plan",
  checked_preferences: "Checked entered preferences",
  ready_for_review: "Left the plan for human review",
} as const;

export function AssistantCoordinationPanel({
  room,
  ownerId,
  session,
  preferences,
  onChange,
}: {
  room: AssistantNegotiation;
  ownerId: string;
  session: ApiSession;
  preferences: AssistantPreferences | null;
  onChange: () => Promise<void>;
}) {
  const action = usePrivateAction(session);
  const state = useQuery({
    queryKey: [
      "private-assistant",
      ownerId,
      "coordination",
      room.id,
      room.revision,
      preferences?.revision,
    ],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    queryFn: async ({ signal }) =>
      (
        await session.request<{ coordination: AssistantCoordination }>(
          `/agents/negotiations/${room.id}/coordination`,
          { signal },
        )
      ).coordination,
  });
  const refresh = async () => {
    await state.refetch();
    await onChange();
  };
  const value = state.error ? undefined : state.data;
  const mine = value?.permissions.find((permission) => permission.memberId === ownerId);
  const partner = value?.permissions.find((permission) => permission.memberId !== ownerId);
  const run = value?.latestRun;
  const active = run?.status === "queued" || run?.status === "negotiating";
  const canPlan = room.state === "open" && !room.booked;
  return (
    <View style={{ gap: 12 }}>
      <T variant="heading">Let our assistants coordinate</T>
      <T variant="caption" color="textSecondary">
        Give permission for this conversation only. Both assistants can exchange proposals using the
        preferences you each entered. Permission lasts 24 hours; changing your preferences requires
        permission again. You both still review the exact plan and booking terms yourselves.
      </T>
      {(state.isPending || state.error) && (
        <StateView
          loading={state.isPending}
          error={state.error}
          onRetry={() => void state.refetch()}
        />
      )}
      {value && (
        <>
          <T variant="caption" color="textSecondary">
            Your permission:{" "}
            {mine?.valid
              ? `on until ${new Date(mine.expiresAt).toLocaleString()}`
              : "off or needs renewal"}
            . Your partner’s permission: {partner?.valid ? "on" : "not ready"}.
          </T>
          {!mine?.valid && canPlan && (
            <>
              {!preferences?.enabled && (
                <Notice>
                  Save and share your entered planning preferences before enabling coordination.
                </Notice>
              )}
              <Button
                label={
                  mine?.enabled
                    ? "Renew my assistant’s permission"
                    : "Allow my assistant to propose in this conversation"
                }
                variant="soft"
                disabled={action.busy || !preferences?.enabled}
                onPress={() =>
                  void action.run(
                    (signal) =>
                      session.request(`/agents/negotiations/${room.id}/coordination`, {
                        method: "PUT",
                        json: {
                          enabled: true,
                          preferenceRevision: preferences?.revision,
                          expectedRevision: room.revision,
                        },
                        signal,
                      }),
                    refresh,
                  )
                }
              />
            </>
          )}
          {value.reason && <Notice>{value.reason}</Notice>}
          {value.ready && canPlan && (
            <Button
              label="Ask our assistants to find a plan"
              loading={action.busy}
              onPress={() => {
                const requestId = Crypto.randomUUID();
                void action.run(
                  (signal) =>
                    session.request(`/agents/negotiations/${room.id}/coordinate`, {
                      method: "POST",
                      json: { requestId, expectedRevision: room.revision },
                      signal,
                    }),
                  refresh,
                );
              }}
            />
          )}
          {run && (
            <>
              <T variant="label">{STATUS[run.status]}</T>
              {run.reason && (
                <T variant="caption" color="textSecondary">
                  {run.reason}
                </T>
              )}
              <T variant="caption" color="textSecondary">
                {run.stepsUsed} of at most {run.maxSteps} steps used
                {active ? ` · finishes by ${new Date(run.deadlineAt).toLocaleTimeString()}` : ""}.
              </T>
              {run.steps.map((step) => (
                <T key={step.number} variant="caption" color="textSecondary">
                  {step.memberId === ownerId ? "Your assistant" : "Your partner’s assistant"}:{" "}
                  {STEP[step.action]} · revision {step.proposalRevision}
                </T>
              ))}
              {run.status === "awaiting_review" && (
                <Notice>
                  Review the current proposal above. Coordination has not approved or booked it for
                  you.
                </Notice>
              )}
            </>
          )}
        </>
      )}
      {(mine?.enabled || state.error || active) && (
        <Button
          label="Stop my assistant and withdraw coordination permission"
          variant="ghost"
          disabled={action.busy}
          onPress={() =>
            void action.run(
              (signal) =>
                session.request(`/agents/negotiations/${room.id}/coordination`, {
                  method: "DELETE",
                  signal,
                }),
              refresh,
            )
          }
        />
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </View>
  );
}
