export {
  getIntelligenceCapability,
  draftText,
  draftPhoto,
  draftWorkoutPlan,
  respond,
  summarizeWorkout,
  cancelAllIntelligence,
  setNextSessionShortcut,
} from "../../../modules/samepace-intelligence";
export { intelligenceReason, LOCAL_AI_NOTICE, LOCAL_PLAN_NOTICE } from "./types";
export { planContentFromAIDraft } from "../../../../shared/workout-plan-draft";
export {
  getPrivateCloudCapability,
  respondWithPrivateCloud,
} from "../../../modules/samepace-intelligence/private-cloud";
export { PRIVATE_CLOUD_NOTICE } from "./private-cloud";
export type { PrivateCloudCapability, PrivateCloudResult } from "./private-cloud";
export type {
  IntelligenceCapability,
  IntelligenceHistory,
  IntelligenceOptions,
  WorkoutDraft,
  WorkoutRecapInput,
  LocalDraftResult,
  LocalTextResult,
  LocalWorkoutPlanResult,
  LocalFailure,
} from "./types";
