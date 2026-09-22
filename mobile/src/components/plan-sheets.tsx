/**
 * The three sheets a plan owns (master plan §3.3): other times that fit both, letting
 * the assistants work it out, and what's happened. Each is one sheet, childless.
 */
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { View } from "react-native";

import { PlanCard, TimelineItem } from "@/components/assistant-plan";
import { Sheet } from "@/components/sheet";
import { Button, Notice, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import type { PlanRoom } from "@/lib/plan-room";

import { agentTranscriptEntry } from "../../../shared/agent-transcript";
import type {
  AssistantCandidates,
  AssistantCoordination,
  AssistantHistoryEvent,
} from "../../../shared/assistant";

/** Other times that fit both — pick one to suggest it. */
export function OtherTimesSheet({
  visible,
  onClose,
  plan,
  ownerId,
  session,
}: {
  visible: boolean;
  onClose: () => void;
  plan: PlanRoom;
  ownerId: string;
  session: ApiSession;
}) {
  const action = usePrivateAction(session);
  const id = plan.value?.id ?? "";
  const options = useQuery({
    queryKey: ["private-assistant", ownerId, "candidates", id, plan.value?.revision],
    gcTime: 0,
    retry: false,
    enabled: visible && Boolean(id),
    queryFn: ({ signal }) =>
      session.request<AssistantCandidates>(`/agents/negotiations/${id}/candidates`, { signal }),
  });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Other times that fit both"
      subtitle="From the times and places you’ve each allowed."
      startFull
    >
      {(options.isPending || options.error) && (
        <StateView
          loading={options.isPending}
          error={options.error}
          onRetry={() => void options.refetch()}
        />
      )}
      {options.data?.reason && <Notice>{options.data.reason}</Notice>}
      {options.data?.candidates.map((candidate, index) => (
        <PlanCard
          key={`${candidate.startAt}:${candidate.venueId}:${index}`}
          plan={candidate}
          venues={plan.venues}
          label={`Option ${index + 1}`}
          footer={
            <Button
              label="Suggest this"
              variant="soft"
              disabled={action.busy}
              onPress={() =>
                void action.run(
                  (signal) =>
                    session.request(`/agents/negotiations/${id}/proposal`, {
                      method: "POST",
                      json: {
                        messageId: Crypto.randomUUID(),
                        expectedRevision: plan.value?.revision,
                        plan: candidate,
                      },
                      signal,
                    }),
                  async () => {
                    onClose();
                    await plan.refresh();
                  },
                )
              }
            />
          }
        />
      ))}
      {options.data && options.data.candidates.length === 0 && !options.data.reason && (
        <T color="textSecondary">Nothing else fits you both right now.</T>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Sheet>
  );
}

/** Let our assistants work it out — a 24-hour permission for this plan only. */
export function AssistantsSheet({
  visible,
  onClose,
  plan,
  ownerId,
  session,
}: {
  visible: boolean;
  onClose: () => void;
  plan: PlanRoom;
  ownerId: string;
  session: ApiSession;
}) {
  const action = usePrivateAction(session);
  const id = plan.value?.id ?? "";
  const state = useQuery({
    queryKey: ["private-assistant", ownerId, "coordination", id, plan.value?.revision],
    gcTime: 0,
    retry: false,
    enabled: Boolean(id),
    refetchInterval: visible ? 5000 : false,
    queryFn: async ({ signal }) =>
      (
        await session.request<{ coordination: AssistantCoordination }>(
          `/agents/negotiations/${id}/coordination`,
          { signal },
        )
      ).coordination,
  });
  const value = state.error ? undefined : state.data;
  const mine = value?.permissions.find((p) => p.memberId === ownerId);
  const run = value?.latestRun;
  const working = run?.status === "queued" || run?.status === "negotiating";
  const message =
    value?.reason ??
    run?.reason ??
    (working
      ? "Your assistants are comparing times and places. Nothing is booked."
      : run?.status === "awaiting_review"
        ? "They found a plan. It’s on the plan page for you both to approve."
        : null);
  const allow = () =>
    void action.run(
      (signal) =>
        session.request(`/agents/negotiations/${id}/coordination`, {
          method: "PUT",
          json: { enabled: true, expectedRevision: plan.value?.revision },
          signal,
        }),
      async () => {
        await state.refetch();
        await plan.refresh();
      },
    );
  const go = () =>
    void action.run(
      (signal) =>
        session.request(`/agents/negotiations/${id}/coordinate`, {
          method: "POST",
          json: { requestId: Crypto.randomUUID(), expectedRevision: plan.value?.revision },
          signal,
        }),
      async () => {
        await state.refetch();
        await plan.refresh();
      },
    );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Let our assistants work it out"
      subtitle={`They swap the times and places you’ve each allowed — nothing else. You both still approve the plan.`}
      footer={
        mine?.valid ? (
          value?.ready && plan.active ? (
            <Button label="Find a plan" variant="accent" loading={action.busy} onPress={go} />
          ) : (
            <Button label="Done" variant="soft" onPress={onClose} />
          )
        ) : (
          <Button
            label="Allow for 24 hours"
            variant="accent"
            loading={action.busy}
            disabled={!plan.active}
            onPress={allow}
          />
        )
      }
    >
      {(state.isPending || state.error) && (
        <StateView
          loading={state.isPending}
          error={state.error}
          onRetry={() => void state.refetch()}
        />
      )}
      {value && (
        <T variant="caption" color="textSecondary">
          Yours: {mine?.valid ? `on until ${formatWhen(mine.expiresAt)}` : "off"} · {plan.buddy}’s:{" "}
          {value.permissions.find((p) => p.memberId !== ownerId)?.valid ? "on" : "not yet"}
        </T>
      )}
      {message && <Notice>{message}</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Sheet>
  );
}

/** What's happened — the timeline of both sides and their assistants. */
export function HistorySheet({
  visible,
  onClose,
  plan,
  ownerId,
  session,
}: {
  visible: boolean;
  onClose: () => void;
  plan: PlanRoom;
  ownerId: string;
  session: ApiSession;
}) {
  const id = plan.value?.id ?? "";
  const events = useQuery({
    queryKey: [
      "private-assistant",
      ownerId,
      "history",
      id,
      plan.value?.revision,
      plan.value?.state,
    ],
    gcTime: 0,
    retry: false,
    enabled: visible && Boolean(id),
    queryFn: ({ signal }) =>
      session.request<{ events: AssistantHistoryEvent[] }>(`/agents/negotiations/${id}/history`, {
        signal,
      }),
  });
  const entries = events.error ? [] : (events.data?.events ?? []).map(agentTranscriptEntry);
  return (
    <Sheet visible={visible} onClose={onClose} title="What’s happened" startFull>
      {(events.isPending || events.error) && (
        <StateView
          loading={events.isPending}
          error={events.error}
          onRetry={() => void events.refetch()}
        />
      )}
      <View>
        {entries.map((entry, index) => {
          const mine = entry.actorId === ownerId;
          const name = plan.value?.memberNames?.[entry.actorId] ?? plan.buddy;
          const who =
            entry.actorKind === "system"
              ? "SamePace"
              : entry.actorKind === "agent"
                ? mine
                  ? "Your assistant"
                  : `${name}’s assistant`
                : mine
                  ? "You"
                  : name;
          return (
            <TimelineItem
              key={entry.id}
              title={entry.title}
              mine={mine}
              last={index === entries.length - 1}
              when={formatWhen(entry.createdAt)}
              who={who}
            >
              <T variant="caption" color="textSecondary">
                {entry.body}
              </T>
            </TimelineItem>
          );
        })}
      </View>
      {!events.isPending && !events.error && entries.length === 0 && (
        <T color="textSecondary">Nothing yet. Your assistant adds its updates here.</T>
      )}
    </Sheet>
  );
}
