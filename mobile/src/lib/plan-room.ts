/**
 * One plan with one buddy, read and acted on. Shared by the Plan screen and the Plan
 * peek so they never disagree about what the next step is. Member-facing words only:
 * the server's "negotiation", "revision" and "consent" stay in here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { usePrivateAction } from "@/hooks/use-private-action";
import type { ApiSession } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { firstName } from "@/lib/names";
import type { Venue } from "@/lib/types";

import type { AssistantBookingReview, AssistantNegotiation } from "../../../shared/assistant";

/** What the one pinned button does right now. */
export type NextStep =
  | { kind: "join"; label: "Join planning" }
  | { kind: "find"; label: "Find times that fit both" }
  | { kind: "approve"; label: "Approve" }
  | { kind: "waiting"; label: string }
  | { kind: "book"; label: "Accept and book" }
  | { kind: "open-session"; label: "Open session"; sessionId: string }
  | { kind: "ended"; label: "Plan again" };

export function usePlanRoom(id: string, ownerId: string, session: ApiSession) {
  const client = useQueryClient();
  const action = usePrivateAction(session);
  const [ended, setEnded] = useState(false);
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
  const value = room.data?.negotiation ?? null;
  const terms = useQuery({
    queryKey: ["private-assistant", ownerId, "booking-terms", id, value?.revision, value?.booked],
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
    enabled: value?.state === "approved" || value?.booked === true,
    queryFn: ({ signal }) =>
      session.request<AssistantBookingReview>(`/agents/negotiations/${id}/booking-terms`, {
        signal,
      }),
  });
  const venues = useQuery({
    queryKey: ["private-assistant", ownerId, "venues"],
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => session.request<{ venues: Venue[] }>("/venues", { signal }),
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["private-assistant", ownerId] });
  };
  const post = (path: string, json: object) => (signal: AbortSignal) =>
    session.request(`/agents/negotiations/${id}/${path}`, { method: "POST", json, signal });

  const buddyId = value?.memberIds.find((memberId) => memberId !== ownerId) ?? "";
  const buddy = firstName(value?.memberNames?.[buddyId]) ?? "your buddy";
  const joined = Boolean(value?.consentedIds.includes(ownerId));
  const bothJoined = Boolean(value?.memberIds.every((m) => value.consentedIds.includes(m)));
  const active = value ? ["open", "approved"].includes(value.state) && !value.booked : false;
  const iApproved = Boolean(value?.confirmedIds.includes(ownerId));
  const review = terms.error ? null : (terms.data ?? null);
  const venueKnown = Boolean(
    value?.plan && (venues.data?.venues ?? []).some((v) => v.id === value.plan!.venueId),
  );

  let next: NextStep | null = null;
  if (value) {
    if (value.booked) {
      const sessionId = value.sessionId ?? review?.sessionId ?? null;
      next = sessionId
        ? { kind: "open-session", label: "Open session", sessionId }
        : { kind: "waiting", label: "Booked" };
    } else if (value.state === "cancelled" || value.state === "expired") {
      next = { kind: "ended", label: "Plan again" };
    } else if (!joined) next = { kind: "join", label: "Join planning" };
    else if (!bothJoined) next = { kind: "waiting", label: `Waiting for ${buddy} to join` };
    else if (value.state === "approved") {
      next = review?.approvedIds.includes(ownerId)
        ? { kind: "waiting", label: `Waiting for ${buddy} to accept` }
        : { kind: "book", label: "Accept and book" };
    } else if (!value.plan) next = { kind: "find", label: "Find times that fit both" };
    else if (iApproved) next = { kind: "waiting", label: `Waiting for ${buddy}` };
    else next = { kind: "approve", label: "Approve" };
  }

  const done = !value
    ? 0
    : value.booked
      ? 5
      : value.state === "approved"
        ? 3
        : value.plan
          ? 2
          : bothJoined
            ? 1
            : 0;
  const stopped = value?.state === "cancelled" || value?.state === "expired";
  const status = !value
    ? ""
    : value.booked
      ? "Booked — it’s a session now."
      : value.state === "cancelled"
        ? "This plan was ended."
        : value.state === "expired"
          ? "This plan ran out of time."
          : `Open until ${formatWhen(value.expiresAt)}.`;

  /** The one deliberate tap. Returns what it did, for the receipt. */
  const act = async (): Promise<string | null> => {
    if (!value || !next) return null;
    switch (next.kind) {
      case "join":
        await action.run(post("consent", { allow: true }), refresh);
        return `You joined. ${buddy} sees your first name, level and the times you allow.`;
      case "approve":
        await action.run(post("confirm", { revision: value.revision }), refresh);
        return `You approved the plan. Waiting for ${buddy}.`;
      case "book":
        if (!review) return null;
        await action.run(
          post("book", { revision: review.terms.revision, termsHash: review.terms.termsHash }),
          refresh,
        );
        return "Accepted. It books once you’ve both accepted.";
      default:
        return null;
    }
  };
  const end = async () => {
    await action.run(post("consent", { allow: false }), async () => {
      setEnded(true);
      await refresh();
    });
  };

  return {
    room,
    value,
    review,
    venues: venues.data?.venues ?? [],
    venueKnown,
    buddy,
    joined,
    bothJoined,
    active,
    iApproved,
    next,
    done,
    stopped,
    status,
    ended,
    busy: action.busy,
    error: action.error,
    act,
    end,
    refresh,
  };
}

export type PlanRoom = ReturnType<typeof usePlanRoom>;

export const termsChips = (ownerId: string, review: AssistantBookingReview | null) =>
  review
    ? [
        review.terms.hostId === ownerId ? "You host" : `${"Your buddy"} hosts`,
        `Free to cancel until ${review.terms.lateCancelHours} h before`,
        `$${(review.terms.lateCancelFeeCents / 100).toFixed(0)} late cancel`,
        `$${(review.terms.noShowFeeCents / 100).toFixed(0)} no-show`,
        "Nothing charged today",
      ]
    : [];
