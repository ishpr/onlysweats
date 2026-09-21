import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AssistantDiscovery } from "@/components/assistant-discovery";
import { ReportLink } from "@/components/report-link";
import { AssistantCoordinationPanel } from "@/components/assistant-coordination";
import { AssistantCredentials } from "@/components/assistant-credentials";
import { AssistantPreferencesEditor } from "@/components/assistant-preferences";
import { PrivateMember, type PrivateMemberProps } from "@/components/private-member";
import { Button, Card, Notice, Screen, StateView, T } from "@/components/ui";
import { usePrivateAction } from "@/hooks/use-private-action";
import { abilityLabel } from "@/lib/ability";
import { ApiError, type ApiSession } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useRefreshOnFocus } from "@/lib/queries";
import { ACTIVITIES, type Booking, type Person, type Session, type Venue } from "@/lib/types";
import type {
  AssistantBookingReview,
  AssistantCandidates,
  AssistantHistoryEvent,
  AssistantNegotiation,
  AssistantPlan,
  AssistantPreferences,
} from "../../../shared/assistant";

type Mine = { bookings: Booking[]; sessions: Session[]; people: Person[] };

export default function AssistantRoute() {
  return <PrivateMember component={Assistant} />;
}

function Assistant({ member, session }: PrivateMemberProps) {
  useRefreshOnFocus();
  const params = useLocalSearchParams<{ negotiationId?: string }>();
  const routeId = typeof params.negotiationId === "string" ? params.negotiationId : null;
  const [selection, setSelection] = useState<{ routeId: string | null; id: string | null }>({
    routeId,
    id: routeId,
  });
  const selected = selection.routeId === routeId ? selection.id : routeId;
  const setSelected = (id: string) => setSelection({ routeId, id });
  const [showPreferences, setShowPreferences] = useState(false);
  const action = usePrivateAction(session);
  const client = useQueryClient();
  const key = ["private-assistant", member.id];
  const preferences = useQuery({
    queryKey: [...key, "preferences"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) =>
      session.request<{ preferences: AssistantPreferences }>("/agents/preferences", { signal }),
  });
  const list = useQuery({
    queryKey: [...key, "negotiations"],
    gcTime: 0,
    retry: false,
    enabled: Boolean(preferences.data),
    refetchInterval: 10_000,
    queryFn: ({ signal }) =>
      session.request<{ negotiations: AssistantNegotiation[] }>("/agents/negotiations", { signal }),
  });
  const mine = useQuery({
    queryKey: [...key, "completed-bookings"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => session.request<Mine>("/bookings", { signal }),
  });
  const venues = useQuery({
    queryKey: [...key, "venues"],
    gcTime: 0,
    queryFn: ({ signal }) => session.request<{ venues: Venue[] }>("/venues", { signal }),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const partnerName = (ids: string[], names?: Record<string, string>) =>
    names?.[ids.find((id) => id !== member.id) ?? ""] ??
    mine.data?.people.find((person) => ids.includes(person.id) && person.id !== member.id)?.name ??
    "Your workout partner";
  const completed = mine.data?.bookings.filter((booking) => booking.status === "completed") ?? [];
  const unavailable = preferences.error instanceof ApiError && preferences.error.status === 404;
  return (
    <Screen onRefresh={() => void refresh()} refreshing={list.isRefetching}>
      <Stack.Screen options={{ title: "Workout assistant" }} />
      <T variant="heading">Make your next plan together</T>
      <T color="textSecondary">
        Find a time and place with a past partner, or choose to discover someone new. Each person
        joins the conversation, reviews the plan, and accepts booking terms.
      </T>
      {unavailable ? (
        <Notice>
          Workout planning is not enabled on this server yet. Your existing sessions and bookings
          are unchanged.
        </Notice>
      ) : (
        (preferences.isPending || preferences.error) && (
          <StateView
            loading={preferences.isPending}
            error={preferences.error}
            onRetry={() => void preferences.refetch()}
          />
        )
      )}
      {preferences.data && (
        <>
          {venues.error && <StateView error={venues.error} onRetry={() => void venues.refetch()} />}
          {preferences.data.preferences.enabled && (
            <Button
              label="Stop preference sharing"
              variant="ghost"
              disabled={action.busy}
              onPress={() =>
                void action.run((signal) => {
                  const current = preferences.data!.preferences;
                  return session.request("/agents/preferences", {
                    method: "PUT",
                    signal,
                    json: {
                      enabled: false,
                      activity: current.activity,
                      ability: current.ability,
                      durationMin: current.durationMin,
                      venueIds: current.venueIds,
                      availability: current.availability,
                      approvedIntent: current.approvedIntent,
                    },
                  });
                }, refresh)
              }
            />
          )}
          <Button
            label={showPreferences ? "Hide planning preferences" : "Edit planning preferences"}
            variant="soft"
            onPress={() => setShowPreferences((value) => !value)}
          />
          {!preferences.data.preferences.enabled && (
            <Notice>
              Preference sharing is off. Turn it on in planning preferences to find plans that fit
              both people.
            </Notice>
          )}
          {showPreferences && (
            <>
              {(venues.isPending || venues.error) && (
                <StateView
                  loading={venues.isPending}
                  error={venues.error}
                  onRetry={() => void venues.refetch()}
                />
              )}
              {venues.data && (
                <AssistantPreferencesEditor
                  key={preferences.data.preferences.revision}
                  session={session}
                  initial={preferences.data.preferences}
                  venues={venues.data.venues}
                  abilities={member.abilities}
                  onSaved={refresh}
                />
              )}
            </>
          )}
          <AssistantDiscovery
            ownerId={member.id}
            session={session}
            preferences={preferences.error ? null : preferences.data.preferences}
            onInvited={async (room) => {
              setSelected(room.id);
              await refresh();
            }}
          />
          <T variant="heading">Planning conversations</T>
          {(list.isPending || list.error) && (
            <StateView
              loading={list.isPending}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          )}
          {!list.error && list.data?.negotiations.length === 0 && (
            <Notice>
              Choose a past workout below, or opt in to discover a new partner. Each person decides
              whether to join.
            </Notice>
          )}
          {!list.error &&
            list.data?.negotiations.map((room) => (
              <Card key={room.id}>
                <T variant="label">{partnerName(room.memberIds, room.memberNames)}</T>
                <T>{room.plan?.title ?? "A new workout plan"}</T>
                <T variant="caption" color="textSecondary">
                  {room.booked
                    ? "Booked"
                    : room.state === "approved"
                      ? "Plan approved · booking terms still apply"
                      : room.state}{" "}
                  · revision {room.revision}
                </T>
                <Button
                  label={selected === room.id ? "Conversation open below" : "Open conversation"}
                  variant="soft"
                  disabled={selected === room.id}
                  onPress={() => setSelected(room.id)}
                />
              </Card>
            ))}
          {selected && (
            <Conversation
              key={selected}
              id={selected}
              session={session}
              ownerId={member.id}
              preferences={preferences.error ? null : preferences.data.preferences}
              venues={venues.error ? [] : (venues.data?.venues ?? [])}
              people={mine.data?.people ?? []}
              onChange={refresh}
            />
          )}
          <T variant="heading">Plan with a past partner</T>
          {(mine.isPending || mine.error) && (
            <StateView
              loading={mine.isPending}
              error={mine.error}
              onRetry={() => void mine.refetch()}
            />
          )}
          {mine.data && completed.length === 0 && (
            <Notice>
              Complete a SamePace workout together first. That shared booking opens planning with
              your partner.
            </Notice>
          )}
          {completed.map((booking) => {
            const workout = mine.data?.sessions.find((item) => item.id === booking.sessionId);
            return (
              <Card key={booking.id}>
                <T variant="label">{partnerName([booking.hostId, booking.participantId])}</T>
                <T variant="caption" color="textSecondary">
                  {workout?.title ?? "Completed workout"}
                  {workout ? ` · ${new Date(workout.startAt).toLocaleDateString()}` : ""}
                </T>
                <T variant="caption" color="textSecondary">
                  Starting a conversation records your consent to plan with this partner.
                </T>
                <Button
                  label="Start planning together"
                  variant="soft"
                  disabled={action.busy}
                  onPress={() =>
                    void action.run(
                      (signal) =>
                        session.request<{ negotiation: AssistantNegotiation }>(
                          "/agents/negotiations",
                          { method: "POST", json: { bookingId: booking.id }, signal },
                        ),
                      async ({ negotiation }) => {
                        setSelected(negotiation.id);
                        await refresh();
                      },
                    )
                  }
                />
              </Card>
            );
          })}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
        </>
      )}
      {!unavailable && <AssistantCredentials session={session} ownerId={member.id} />}
      {!preferences.data && !unavailable && selected && (
        <Conversation
          key={selected}
          id={selected}
          session={session}
          ownerId={member.id}
          preferences={null}
          venues={venues.error ? [] : (venues.data?.venues ?? [])}
          people={mine.data?.people ?? []}
          onChange={refresh}
        />
      )}
    </Screen>
  );
}

function PlanDetails({ plan, venues }: { plan: AssistantPlan; venues: Venue[] }) {
  const venue = venues.find((item) => item.id === plan.venueId);
  return (
    <View style={{ gap: 4 }}>
      <T variant="heading">{plan.title}</T>
      <T>
        {ACTIVITIES[plan.activity].label} · {plan.durationMin} minutes
      </T>
      <T>
        {new Date(plan.startAt).toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "short",
        })}{" "}
        (your local time)
      </T>
      {venue ? (
        <>
          <T>{venue.name}</T>
          <T variant="caption" color="textSecondary">
            {venue.neighborhood} · {venue.type.replaceAll("_", " ")}
          </T>
        </>
      ) : (
        <Notice>
          Meeting-place details are unavailable. Refresh the screen before approving this plan.
        </Notice>
      )}
      <T variant="caption" color="textSecondary">
        {abilityLabel(plan.ability)}
      </T>
    </View>
  );
}

function Conversation({
  id,
  ownerId,
  session,
  venues,
  people,
  preferences,
  onChange,
}: {
  id: string;
  ownerId: string;
  session: ApiSession;
  venues: Venue[];
  people: Person[];
  preferences: AssistantPreferences | null;
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
  return (
    <Card>
      <T variant="heading">Current conversation</T>
      <T variant="label">
        With{" "}
        {value.memberNames?.[value.memberIds.find((memberId) => memberId !== ownerId) ?? ""] ??
          people.find((person) => value.memberIds.includes(person.id) && person.id !== ownerId)
            ?.name ??
          "your workout partner"}
      </T>
      <T variant="caption" color="textSecondary">
        {value.booked ? "Booked" : value.state} · expires{" "}
        {new Date(value.expiresAt).toLocaleString()}
      </T>
      {value.state === "open" && !consented && (
        <>
          <Notice>
            Join to let this partner and their assistant exchange workout plans with you. Your
            private fitness history is not part of the conversation.
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
        <Notice>Waiting for your partner to join before proposals can be exchanged.</Notice>
      )}
      {value.plan && (
        <>
          <T variant="label">Proposal revision {value.revision}</T>
          <PlanDetails plan={value.plan} venues={venues} />
          <T variant="caption" color="textSecondary">
            {value.confirmedIds.length} of {value.memberIds.length} people approved this revision.
            Every change requires fresh approval.
          </T>
          {mutual && value.state === "open" && !value.confirmedIds.includes(ownerId) && (
            <Button
              label={`Approve plan revision ${value.revision}`}
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
            <Notice>You approved this revision. Your partner still needs to review it.</Notice>
          )}
        </>
      )}
      {mutual && (
        <AssistantCoordinationPanel
          room={value}
          ownerId={ownerId}
          session={session}
          preferences={preferences}
          onChange={refresh}
        />
      )}
      {mutual && active && (
        <Candidates
          key={value.revision}
          room={value}
          ownerId={ownerId}
          session={session}
          venues={venues}
          onChange={refresh}
        />
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
              "this partner"
            }
            negotiationId={value.id}
          />
        ))}
      <History
        id={id}
        revision={value.revision}
        state={value.state}
        confirmations={value.confirmedIds.length}
        ownerId={ownerId}
        session={session}
        venues={venues}
        people={people}
        memberNames={value.memberNames}
      />
    </Card>
  );
}

function Candidates({
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
  const action = usePrivateAction(session);
  const [result, setResult] = useState<AssistantCandidates | null>(null);
  return (
    <View style={{ gap: 12 }}>
      <Button
        label={room.plan ? "Find another plan" : "Find plans that fit both of us"}
        variant="soft"
        disabled={action.busy}
        onPress={() =>
          void action.run(
            (signal) =>
              session.request<AssistantCandidates>(`/agents/negotiations/${room.id}/candidates`, {
                signal,
              }),
            setResult,
          )
        }
      />
      <T variant="caption" color="textSecondary">
        Matches use both people’s entered times, public venues and workout preferences. No private
        calendar or health readings are used.
      </T>
      {result?.reason && <Notice>{result.reason}</Notice>}
      {result?.candidates.map((plan, index) => (
        <Card key={`${plan.startAt}:${plan.venueId}:${index}`}>
          <PlanDetails plan={plan} venues={venues} />
          <Button
            label={room.plan ? "Send this counterproposal" : "Propose this plan"}
            disabled={action.busy || !venues.some((venue) => venue.id === plan.venueId)}
            onPress={() =>
              void action.run(
                (signal) =>
                  session.request(`/agents/negotiations/${room.id}/proposal`, {
                    method: "POST",
                    json: { messageId: Crypto.randomUUID(), expectedRevision: room.revision, plan },
                    signal,
                  }),
                onChange,
              )
            }
          />
        </Card>
      ))}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
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
        <Notice>
          Your workout is booked. Open the session for check-in, chat and cancellation.
        </Notice>
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
      <PlanDetails plan={value.terms.plan} venues={venues} />
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
        <Notice>You accepted these terms. Waiting for your partner’s acceptance.</Notice>
      ) : (
        <Button
          label={`Accept terms and book revision ${value.terms.revision}`}
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
  venues,
  people,
  memberNames,
}: {
  id: string;
  revision: number;
  state: string;
  confirmations: number;
  ownerId: string;
  session: ApiSession;
  venues: Venue[];
  people: Person[];
  memberNames?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const events = useQuery({
    queryKey: ["private-assistant", ownerId, "history", id, revision, state, confirmations],
    gcTime: 0,
    retry: false,
    enabled: expanded,
    queryFn: ({ signal }) =>
      session.request<{ events: AssistantHistoryEvent[] }>(`/agents/negotiations/${id}/history`, {
        signal,
      }),
  });
  const labels: Record<AssistantHistoryEvent["kind"], string> = {
    consent: "Consent changed",
    proposal: "Proposal sent",
    confirmation: "Plan approved",
    cancel: "Conversation cancelled",
    booking_approval: "Booking terms accepted",
    booked: "Workout booked",
  };
  return (
    <View style={{ gap: 12 }}>
      <Button
        label={expanded ? "Hide conversation history" : "View conversation history"}
        variant="ghost"
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded && (
        <>
          {(events.isPending || events.error) && (
            <StateView
              loading={events.isPending}
              error={events.error}
              onRetry={() => void events.refetch()}
            />
          )}
          {!events.error &&
            events.data?.events.map((event) => (
              <View key={event.sequence} style={{ gap: 4 }}>
                <T variant="label">
                  {labels[event.kind]} · revision {event.revision}
                </T>
                <T variant="caption" color="textSecondary">
                  {typeof event.data.agentLabel === "string" && event.data.agentLabel !== "Member"
                    ? `${event.data.agentLabel} (on behalf of ${event.actorId === ownerId ? "you" : "your partner"})`
                    : event.actorId === ownerId
                      ? "You"
                      : (memberNames?.[event.actorId] ??
                        people.find((person) => person.id === event.actorId)?.name ??
                        "Your partner")}{" "}
                  · {new Date(event.createdAt).toLocaleString()}
                </T>
                {event.kind === "proposal" && event.data.plan ? (
                  <PlanDetails plan={event.data.plan as AssistantPlan} venues={venues} />
                ) : null}
                {event.kind === "consent" && (
                  <T variant="caption" color="textSecondary">
                    {event.data.allowed ? "Joined the conversation" : "Withdrew consent"}
                  </T>
                )}
              </View>
            ))}
        </>
      )}
    </View>
  );
}
