import type { Activity } from "../src/lib/pace/types.ts";

/** Private assistant contract; never an A2A message or permission to act. */
export const CHAT_NOTICE_VERSION = "private-assistant-v1" as const;
export const CHAT_CONSENT_NOTICE =
  "Allow SamePace to send this private conversation and relevant planning information to its cloud AI provider through Vercel. Replies may be wrong. Actions stay in your control; nothing is booked, sent to another member, or saved as a workout without your review. History is kept for up to 30 days. Turn this off or clear the conversation to remove it sooner.";
export const CHAT_FITNESS_NOTICE =
  "Also allow the assistant to read summaries of your five most recent imported workouts, including recorded duration, distance, energy and heart-rate summary when available. Raw samples, sleep and HRV history are excluded. These summaries are sent to the cloud AI provider only when requested during this conversation. Turning this off clears the conversation. Removing imported health data also clears conversations that used workout summaries.";
export type ChatSettings = {
  cloudEnabled: boolean;
  fitnessContextEnabled: boolean;
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
  kind: "preferences" | "discovery" | "negotiation" | "session" | "workout" | "fitness";
  label: string;
  description: string;
  targetId?: string;
  /** Suggestions only; present solely on preference review actions. */
  preferenceDraft?: ChatPreferenceDraft;
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
};
export type ChatEvent =
  | { type: "start"; requestId: string }
  | { type: "delta"; text: string }
  | { type: "action"; action: ChatAction }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };
