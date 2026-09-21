/** Local suggestions only: these are not sensor readings, saved logs, or approvals. */
export type WorkoutDraft = {
  source: "text" | "photo";
  sourceText: string;
  title: string | null;
  activity: "run" | "ride" | "walk" | "hike" | "strength" | "mobility" | null;
  intent: "planned" | "completed" | "unclear";
  startedAt: null;
  durationMin: number | null;
  note: string;
  exercises: {
    name: string;
    sets: number | null;
    reps: number | null;
    weight: number | null;
    unit: "kg" | "lb" | "bodyweight" | null;
  }[];
  requiresReview: true;
};

export type IntelligenceCapability = {
  available: boolean;
  reason: string | null;
  photoTextRecognition: boolean;
  execution: "on_device";
};
export type IntelligenceHistory = { role: "user" | "assistant"; text: string };
export type WorkoutRecapInput = {
  activity: "run" | "ride" | "walk" | "hike" | "strength" | "mobility" | "other";
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  averageHeartRateBpm?: number | null;
  activeEnergyKcal?: number | null;
  memberNote?: string;
};
export type LocalFailure = {
  status: "unavailable" | "cancelled" | "error";
  reason: string;
  execution: "on_device";
};
export type LocalDraftResult =
  | LocalFailure
  | {
      status: "available";
      draft: WorkoutDraft;
      /** False means Vision read the photo, but no model populated draft fields. */
      modelUsed: boolean;
      reason: string | null;
      execution: "on_device";
    };
export type LocalTextResult =
  | LocalFailure
  | {
      status: "available";
      text: string;
      modelUsed: boolean;
      execution: "on_device";
    };
export type IntelligenceOptions = {
  signal?: AbortSignal;
  requestId?: string;
  /** Provisional text only; discard it if the final result is not available. */
  onPartial?: (text: string) => void;
};

export const LOCAL_AI_NOTICE =
  "Apple's on-device model processes only what you submit here. Photos are read on this device and are not uploaded. Suggestions may be wrong: review every field. Nothing is saved, shared, or booked until you choose an explicit app action.";

export function intelligenceReason(reason: string | null | undefined): string {
  switch (reason) {
    case "device_not_eligible":
      return "This device does not support Apple's on-device model. You can still enter a workout yourself.";
    case "intelligence_disabled":
      return "Turn on Apple Intelligence in Settings to use local assistance.";
    case "model_not_ready":
      return "Apple's model is still becoming available. Try again after its download finishes.";
    case "unsupported_os":
      return "Local language assistance needs iOS 26 or newer on a supported device.";
    case "native_module_missing":
      return "This build does not include local intelligence yet. Install the new iPhone build.";
    case "unsupported_platform":
      return "Local Apple intelligence is available on supported iPhones.";
    case "no_text":
      return "No readable text was found. Try a clearer picture or type the workout.";
    case "too_much_text":
      return "Choose a closer crop containing only the workout.";
    case "image_too_large":
      return "Choose a smaller picture, up to 25 MB.";
    case "image_unavailable":
      return "That picture cannot be read. Pick it again.";
    case "busy":
      return "Another local request is finishing. Try again in a moment.";
    case "timeout":
      return "Local processing took too long. Try a shorter note.";
    case "invalid_input":
      return "Use a shorter note or a supported local picture.";
    case "cancelled":
      return "Local processing was stopped.";
    default:
      return "Local assistance is unavailable for this request. You can continue manually; nothing was sent to a cloud model.";
  }
}
