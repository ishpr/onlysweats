import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Approvals, PlanCard, PlanTrack, TimelineItem } from "@/components/assistant-plan";
import { ReportLink } from "@/components/report-link";
import { Button, Card, Notice, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import { agentTranscriptEntry } from "../../../shared/agent-transcript";
import type { ApiSession } from "@/lib/api";
import { formatUsd, formatWhen } from "@/lib/format";
import type { Person, Venue } from "@/lib/types";
import type {
  AssistantBookingReview,
  AssistantCoordination,
  AssistantHistoryEvent,
  AssistantNegotiation,
  AssistantPlan,
} from "../../../shared/assistant";

function PlanDetails({
  plan,
  venues,
  label,
  footer,
}: {
  plan: AssistantPlan;
  venues: Venue[];
  label?: string;
  footer?: React.ReactNode;
}) {
  return <PlanCard plan={plan} venues={venues} label={label} footer={footer} />;
}

export function AgentConversation({
  id,
  ownerId,
  session,
  venues,
  people,
  onChange,
}: {
  id: string;
  ownerId: string;
  session: ApiSession;
  venues: Venue[];
  people: Person[];
  onChange: () => Promise<void>;
}) {
  const action = usePrivateAction(session);
  const [ending, setEnding] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const room = useQuery({
    queryKey: ["private-assistant", ownerId, "negotiation", id],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    queryFn: ({ signal }) =>
      session.request<{ negotiation: AssistantNegotiation }>(
        `/agents/negotiations/${encodeURIComponent(id)}`,
        { signal },
      ),
  });
  const refresh = async () => {
    await room.refetch();
    await onChange();
  };
  if (withdrawn)
    return (
      <Card>
        <Notice>
          Your consent was withdrawn and this planning conversation has ended. Existing booked
          workouts are unchanged.
        </Notice>
      </Card>
    );
  if (!room.data || room.error)
    return (
      <Card>
        <StateView
          loading={room.isPending}
          error={room.error}
          onRetry={() => void room.refetch()}
        />
        {room.error && (
          <>
            <T variant="caption" color="textSecondary">
              You can withdraw consent even if the conversation is no longer available to view.
            </T>
            <Button
              label="Withdraw my consent"
              variant="ghost"
              disabled={action.busy}
              onPress={() =>
                void action.run(
                  (signal) =>
                    session.request(`/agents/negotiations/${id}/consent`, {
                      method: "POST",
                      json: { allow: false },
                      signal,
                    }),
                  async () => {
                    setWithdrawn(true);
                    await onChange();
                  },
                )
              }
            />
            {action.error && <Notice tone="danger">{action.error}</Notice>}
          </>
        )}
      </Card>
    );
  const value = room.data.negotiation;
  const consented = value.consentedIds.includes(ownerId);
  const mutual = value.memberIds.every((memberId) => value.consentedIds.includes(memberId));
  const active = ["open", "approved"].includes(value.state) && !value.booked;
  const buddyId = value.memberIds.find((memberId) => memberId !== ownerId) ?? "";
  const buddy =
    value.memberNames?.[buddyId] ??
    people.find((person) => person.id === buddyId)?.name ??
    "your workout buddy";
  return (
    <Card>
      <T variant="heading">With {buddy}</T>
      <PlanTrack
        done={value.booked ? 5 : value.state === "approved" ? 3 : value.plan ? 2 : mutual ? 1 : 0}
        stopped={value.state === "cancelled" || value.state === "expired"}
      />
      <T variant="caption" color="textSecondary">
        {value.booked
          ? "Booked — it’s a session now."
          : value.state === "cancelled"
            ? "This plan was ended."
            : value.state === "expired"
              ? "This plan ran out of time."
              : `Open until ${formatWhen(value.expiresAt)}.`}
      </T>
      <History
        id={id}
        revision={value.revision}
        state={value.state}
        confirmations={value.confirmedIds.length}
        ownerId={ownerId}
        session={session}
        people={people}
        memberNames={value.memberNames}
      />
      {mutual && value.state === "open" && !value.booked && (
        <PlanningStatus id={id} ownerId={ownerId} session={session} />
      )}
      {value.state === "open" && !consented && (
        <>
          <Notice>
            Join to let this buddy and their assistant exchange workout plans with you. Your private
            fitness history is not part of the conversation.
          </Notice>
          <Button
            label="Join this planning conversation"
            disabled={action.busy}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request(`/agents/negotiations/${id}/consent`, {
                    method: "POST",
                    json: { allow: true },
                    signal,
                  }),
                refresh,
              )
            }
          />
        </>
      )}
      {consented && !mutual && active && (
        <Notice>Waiting for {buddy} to join. Nothing is shared until they do.</Notice>
      )}
      {value.plan && (
        <>
          <PlanDetails
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
                : "Both of you approve before anything is booked. Any change asks again."
            }
          />
          {mutual && value.state === "open" && !value.confirmedIds.includes(ownerId) && (
            <Button
              label="Approve this plan"
              disabled={action.busy || !venues.some((venue) => venue.id === value.plan!.venueId)}
              onPress={() =>
                void action.run(
                  (signal) =>
                    session.request(`/agents/negotiations/${id}/confirm`, {
                      method: "POST",
                      json: { revision: value.revision },
                      signal,
                    }),
                  refresh,
                )
              }
            />
          )}
          {value.confirmedIds.includes(ownerId) && value.state === "open" && (
            <Notice>You approved this plan. {buddy} still needs to look at it.</Notice>
          )}
        </>
      )}
      {(value.state === "approved" || value.booked) && (
        <BookingReview
          room={value}
          ownerId={ownerId}
          session={session}
          venues={venues}
          onChange={refresh}
        />
      )}
      {active && (
        <Button
          label={consented ? "Withdraw and end conversation" : "Decline conversation"}
          variant="ghost"
          disabled={action.busy}
          onPress={() => setEnding(true)}
        />
      )}
      {ending && active && (
        <>
          <Notice>
            This ends the planning conversation and clears approvals. It does not cancel an existing
            booked session.
          </Notice>
          <Button
            label="End this conversation"
            variant="danger"
            disabled={action.busy}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request(`/agents/negotiations/${id}/consent`, {
                    method: "POST",
                    json: { allow: false },
                    signal,
                  }),
                async () => {
                  setEnding(false);
                  await refresh();
                },
              )
            }
          />
          <Button label="Keep planning" variant="ghost" onPress={() => setEnding(false)} />
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {value.memberIds
        .filter((memberId) => memberId !== ownerId)
        .map((memberId) => (
          <ReportLink
            key={memberId}
            memberId={memberId}
            name={
              value.memberNames?.[memberId] ??
              people.find((person) => person.id === memberId)?.name ??
              "this buddy"
            }
            negotiationId={value.id}
          />
        ))}
    </Card>
  );
}

function PlanningStatus({
  id,
  ownerId,
  session,
}: {
  id: string;
  ownerId: string;
  session: ApiSession;
}) {
  const router = useRouter();
  const status = useQuery({
    queryKey: ["private-assistant", ownerId, "coordination", id],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    queryFn: ({ signal }) =>
      session.request<{ coordination: AssistantCoordination }>(
        `/agents/negotiations/${encodeURIComponent(id)}/coordination`,
        { signal },
      ),
  });
  const coordination = status.error ? undefined : status.data?.coordination;
  const run = coordination?.latestRun;
  const message =
    coordination?.reason ??
    run?.reason ??
    (run?.status === "queued" || run?.status === "negotiating"
      ? "Your agents are comparing workout options. Nothing is booked."
      : run?.status === "awaiting_review"
        ? "Your agents found a plan for you to review. Both people approve it and the booking terms themselves."
        : null);
  return (
    <View style={{ gap: 12 }}>
      {(status.isPending || status.error) && (
        <StateView
          loading={status.isPending}
          error={status.error}
          onRetry={() => void status.refetch()}
        />
      )}
      {message && <Notice>{message}</Notice>}
      <Button
        label="Review my times and preferences"
        variant="ghost"
        onPress={() => router.push({ pathname: "/assistant", params: { planning: "1" } })}
      />
    </View>
  );
}

function BookingReview({
  room,
  ownerId,
  session,
  venues,
  onChange,
}: {
  room: AssistantNegotiation;
  ownerId: string;
  session: ApiSession;
  venues: Venue[];
  onChange: () => Promise<void>;
}) {
  const router = useRouter();
  const action = usePrivateAction(session);
  const review = useQuery({
    queryKey: ["private-assistant", ownerId, "booking-terms", room.id, room.revision, room.booked],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    queryFn: ({ signal }) =>
      session.request<AssistantBookingReview>(`/agents/negotiations/${room.id}/booking-terms`, {
        signal,
      }),
  });
  if (!review.data || review.error)
    return (
      <StateView
        loading={review.isPending}
        error={review.error}
        onRetry={() => void review.refetch()}
      />
    );
  const value = review.data;
  if (value.booked && value.sessionId)
    return (
      <>
        <Notice>Your workout is booked. Open the session for check-in and cancellation.</Notice>
        <Button
          label="Open booked workout"
          onPress={() =>
            router.push({ pathname: "/session/[id]", params: { id: value.sessionId! } })
          }
        />
      </>
    );
  return (
    <Card>
      <T variant="heading">Review booking terms</T>
      <PlanDetails plan={value.terms.plan} venues={venues} label="Agreed" />
      <T>
        You will be the {value.terms.hostId === ownerId ? "host" : "participant"}. This is an
        unlisted workout for two people.
      </T>
      <T variant="caption" color="textSecondary">
        Late cancellation within {value.terms.lateCancelHours} hours:{" "}
        {formatUsd(value.terms.lateCancelFeeCents)}. No-show fee:{" "}
        {formatUsd(value.terms.noShowFeeCents)}. {formatUsd(value.terms.chargeNowCents)} charged
        now. Payment collection is currently disabled.
      </T>
      <T variant="caption" color="textSecondary">
        A booking is created only after both people accept these exact terms. A changed plan or
        changed preferences requires review again.
      </T>
      {value.approvedIds.includes(ownerId) ? (
        <Notice>You accepted. Waiting for your buddy to accept too.</Notice>
      ) : (
        <Button
          label="Accept and book"
          loading={action.busy}
          disabled={action.busy || !venues.some((venue) => venue.id === value.terms.plan.venueId)}
          onPress={() =>
            void action.run(
              (signal) =>
                session.request<AssistantBookingReview>(`/agents/negotiations/${room.id}/book`, {
                  method: "POST",
                  json: { revision: value.terms.revision, termsHash: value.terms.termsHash },
                  signal,
                }),
              async () => {
                await review.refetch();
                await onChange();
              },
            )
          }
        />
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Card>
  );
}

function History({
  id,
  revision,
  state,
  confirmations,
  ownerId,
  session,
  people,
  memberNames,
}: {
  id: string;
  revision: number;
  state: string;
  confirmations: number;
  ownerId: string;
  session: ApiSession;
  people: Person[];
  memberNames?: Record<string, string>;
}) {
  const events = useQuery({
    queryKey: ["private-assistant", ownerId, "history", id, revision, state, confirmations],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    queryFn: ({ signal }) =>
      session.request<{ events: AssistantHistoryEvent[] }>(`/agents/negotiations/${id}/history`, {
        signal,
      }),
  });
  const entries = events.error ? [] : (events.data?.events ?? []).map(agentTranscriptEntry);
  return (
    <View style={{ gap: 12 }}>
      <T variant="heading">Agent conversation</T>
      <T variant="caption" color="textSecondary">
        Your agents exchange proposals here. You review the plan and accept the booking terms
        yourself.
      </T>
      {(events.isPending || events.error) && (
        <StateView
          loading={events.isPending}
          error={events.error}
          onRetry={() => void events.refetch()}
        />
      )}
      {entries.map((entry, index) => {
        const mine = entry.actorId === ownerId;
        const name =
          memberNames?.[entry.actorId] ??
          people.find((person) => person.id === entry.actorId)?.name ??
          "Your buddy";
        const who =
          entry.actorKind === "system"
            ? "SamePace"
            : entry.actorKind === "agent"
              ? mine
                ? "Your agent"
                : `${name}’s agent`
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
      {!events.isPending && !events.error && entries.length === 0 && (
        <Notice>No exchanges yet. Your agent will add its planning updates here.</Notice>
      )}
    </View>
  );
}
