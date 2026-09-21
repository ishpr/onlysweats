import type { Activity } from "../src/lib/pace/types.ts";
import type { AIWorkoutPlanDraft } from "./workout-plans.ts";

/** Private assistant contract; never an A2A message or permission to act. */
export const CHAT_NOTICE_VERSION = "private-assistant-v1" as const;
export const CHAT_CONSENT_NOTICE =
  "Allow SamePace to send this private conversation and relevant planning information to its cloud AI provider through Vercel. Replies may be wrong. Actions stay in your control; nothing is booked, sent to another member, or saved as a workout without your review. History is kept for up to 30 days. Turn this off or clear the conversation to remove it sooner.";
export const CHAT_FITNESS_NOTICE =
  "Also allow the assistant to read summaries of your five most recent imported workouts, including recorded duration, distance, energy and heart-rate summary when available. Raw samples, sleep and HRV history are excluded. These summaries are sent to the cloud AI provider only when requested during this conversation. Turning this off clears the conversation. Removing imported health data also clears conversations that used workout summaries.";
export const CHAT_MANUAL_WORKOUT_NOTICE_VERSION = "manual-workout-context-v1" as const;
export const CHAT_MANUAL_WORKOUT_NOTICE =
  "Also allow the private cloud assistant to read up to three recently updated saved workout plans, three recent workout records and five recent individual exercise logs when requested during this conversation. This includes plan titles and instructions, your entered notes, targets and actual sets, repetitions, time, distance and external load. Long records are shortened and identified as incomplete. Plans are not proof of exercise; missing results remain unknown. Apple Health data and other members' results are excluded. This permission does not share records with buddies or A2A agents. Turning this off clears the conversation. Adding, changing or deleting these manual records clears conversations that used this context and stops outdated replies.";
export type ChatHistoryUse = "when_requested" | "when_relevant";
export const CHAT_HISTORY_USE_NOTICE_VERSION = "relevant-workout-history-v1" as const;
export const CHAT_HISTORY_USE_NOTICE =
  "Let SamePace use the workout history you allow whenever it is relevant to this private cloud conversation, even when you do not specifically ask for history. This changes when allowed saved plans, entered results and separately enabled Apple Health workout summaries may be used. Only bounded recent records are shared with the cloud AI provider. Plans are targets, not completed exercise; missing results remain unknown. Nothing is sent to buddies or A2A agents, and saving or sharing still needs your review. Changing this permission clears the conversation.";
export type ChatSettings = {
  /** False only for new settings that the member has never reviewed. */
  consentReviewed: boolean;
  cloudEnabled: boolean;
  fitnessContextEnabled: boolean;
  manualWorkoutContextEnabled: boolean;
  manualWorkoutContextNoticeVersion: typeof CHAT_MANUAL_WORKOUT_NOTICE_VERSION;
  historyUse: ChatHistoryUse;
  historyUseNoticeVersion: typeof CHAT_HISTORY_USE_NOTICE_VERSION;
  consentGeneration: string;
  historyGeneration: string;
  noticeVersion: typeof CHAT_NOTICE_VERSION;
  providerAvailable: boolean;
  /** Public provider/model identifier; never a credential. */
  model: string;
};
export type ChatPreferenceDraft = {
  activity?: Activity;
  durationMin?: number;
  approvedIntent?: string;
};
export type ChatAction = {
  id: string;
  kind:
    | "preferences"
    | "discovery"
    | "negotiation"
    | "session"
    | "workout"
    | "fitness"
    | "workout_plan";
  label: string;
  description: string;
  targetId?: string;
  /** Suggestions only; present solely on preference review actions. */
  preferenceDraft?: ChatPreferenceDraft;
  /** An unsaved suggestion. Opening the editor never records completed exercise. */
  workoutPlanDraft?: AIWorkoutPlanDraft;
};
export type ChatMessage = {
  id: string;
  requestId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  actions: ChatAction[];
  status: "complete" | "interrupted";
};
export type ChatHistory = { settings: ChatSettings; messages: ChatMessage[] };
export type ChatTurnInput = {
  requestId: string;
  text: string;
  consentGeneration: string;
  historyGeneration: string;
  /** Omitted by older clients, which cannot render structured plan cards. */
  workoutPlanDrafts?: boolean;
};
export type ChatEvent =
  | { type: "start"; requestId: string }
  | { type: "delta"; text: string }
  | { type: "action"; action: ChatAction }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };
