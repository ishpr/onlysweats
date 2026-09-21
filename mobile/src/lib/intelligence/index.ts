export {
  getIntelligenceCapability,
  draftText,
  draftPhoto,
  respond,
  summarizeWorkout,
  cancelAllIntelligence,
  setNextSessionShortcut,
} from "../../../modules/samepace-intelligence";
export { intelligenceReason, LOCAL_AI_NOTICE } from "./types";
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
  LocalFailure,
} from "./types";
