import type { AssistantHistoryEvent } from "./assistant.ts";

export type AgentTranscriptEntry = {
  id: string;
  sequence: number;
  actorId: string;
  actorKind: "agent" | "member" | "system";
  title: string;
  body: string;
  createdAt: string;
};

/** Render recorded actions, never invented dialogue. Old human messages remain human. */
export function agentTranscriptEntry(event: AssistantHistoryEvent): AgentTranscriptEntry {
  const data = event.data;
  const humanAction = ["consent", "confirmation", "booking_approval"].includes(event.kind);
  const legacyAgent =
    typeof data.agentLabel === "string" &&
    data.agentLabel !== "Member" &&
    data.agentLabel.length > 0;
  const actorKind = humanAction
    ? "member"
    : event.kind === "booked"
      ? "system"
      : data.actorKind === "agent" || (!data.actorKind && legacyAgent)
        ? "agent"
        : data.actorKind === "member" || data.agentLabel === "Member"
          ? "member"
          : "system";
  let title = "Recorded activity";
  let body = "This action is part of the conversation history.";
  switch (event.kind) {
    case "agent_message": {
      const actions: Record<string, [string, string]> = {
        preferences_changed: [
          "Planning updated",
          "Saved preferences changed. The agents are checking a fresh proposal; earlier plan and booking approvals no longer apply.",
        ],
        planning_limited: [
          "Planning limit reached",
          "This conversation reached its planning limit. The agent cannot start another run yet.",
        ],
        contact: [
          "Contact initiated",
          "Found compatible planning preferences and contacted the other member’s agent.",
        ],
        matched_preferences: [
          "Preferences matched",
          "Checked the shared activity, public venues and available times for a possible workout.",
        ],
        checked_preferences: [
          "Proposal checked",
          "Checked this proposal against the member’s saved planning preferences.",
        ],
        ready_for_review: [
          "Ready for your review",
          "Both agents have compared the plan. Both people must approve it before a workout is booked.",
        ],
      };
      [title, body] = actions[String(data.action)] ?? [
        "Agent activity recorded",
        "An agent recorded a planning action.",
      ];
      break;
    }
    case "proposal":
      title = "Workout proposed";
      body =
        "Review the proposed activity, time and meeting place. Earlier approvals do not apply to a changed plan.";
      break;
    case "confirmation":
      title = "Plan confirmed";
      body =
        "Confirmed this version of the plan. Booking terms still require both people’s approval.";
      break;
    case "booking_approval":
      title = "Booking terms approved";
      body = "Approved the exact booking terms for this version of the workout.";
      break;
    case "booked":
      title = "Workout booked";
      body = "Both people approved the plan and booking terms. The workout is now scheduled.";
      break;
    case "consent":
      title =
        data.allowed === false ? "Planning permission withdrawn" : "Planning permission recorded";
      body =
        data.allowed === false
          ? "Withdrew permission for this conversation."
          : "Recorded a member’s permission for this planning conversation.";
      break;
    case "cancel":
      title = "Conversation closed";
      body =
        "Stopped planning in this conversation. This action does not cancel an existing booking.";
      break;
  }
  return {
    id: String(event.sequence),
    sequence: event.sequence,
    actorId: event.actorId,
    actorKind,
    title,
    body,
    createdAt: event.createdAt,
  };
}
