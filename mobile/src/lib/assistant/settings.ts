import {
  CHAT_HISTORY_USE_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_NOTICE_VERSION,
  type ChatSettings,
} from "../../../../shared/conversation.ts";

export type ChatPermission =
  "cloudEnabled" | "fitnessContextEnabled" | "manualWorkoutContextEnabled";
type PermissionSettings = Pick<
  ChatSettings,
  ChatPermission | "consentGeneration" | "consentReviewed" | "historyUse"
>;
export type ChatSettingsUpdate = {
  cloudEnabled: boolean;
  fitnessContextEnabled: boolean;
  manualWorkoutContextEnabled: boolean;
  noticeVersion: typeof CHAT_NOTICE_VERSION;
  manualWorkoutContextNoticeVersion: typeof CHAT_MANUAL_WORKOUT_NOTICE_VERSION;
  historyUse: ChatSettings["historyUse"];
  historyUseNoticeVersion: typeof CHAT_HISTORY_USE_NOTICE_VERSION;
  expectedConsentGeneration: string;
  initialSetup?: true;
};
const notices = {
  noticeVersion: CHAT_NOTICE_VERSION,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
};

/** One explicit choice preserves other grants, but never creates another grant. */
export function chatPermissionUpdate(
  settings: PermissionSettings,
  permission: ChatPermission,
  enabled: boolean,
): ChatSettingsUpdate {
  const cloudEnabled = permission === "cloudEnabled" ? enabled : settings.cloudEnabled;
  return {
    cloudEnabled,
    fitnessContextEnabled:
      cloudEnabled &&
      settings.cloudEnabled &&
      (permission === "fitnessContextEnabled" ? enabled : settings.fitnessContextEnabled),
    manualWorkoutContextEnabled:
      cloudEnabled &&
      settings.cloudEnabled &&
      (permission === "manualWorkoutContextEnabled"
        ? enabled
        : settings.manualWorkoutContextEnabled === true),
    historyUse: cloudEnabled && settings.cloudEnabled ? settings.historyUse : "when_requested",
    expectedConsentGeneration: settings.consentGeneration,
    ...notices,
  };
}

/** Reviewing relevance changes timing, never which sources the member allowed. */
export function chatHistoryUseUpdate(
  settings: PermissionSettings,
  historyUse: ChatSettings["historyUse"],
): ChatSettingsUpdate {
  if (!settings.cloudEnabled) throw new Error("Start coaching before changing history use.");
  return {
    ...chatPermissionUpdate(settings, "cloudEnabled", true),
    historyUse,
  };
}

/** Older servers never make someone a new member or upgrade a context permission. */
export function readChatSettings(value: unknown): ChatSettings {
  const invalid = () =>
    new Error("Your conversation permissions could not be loaded. Please refresh.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const settings = value as Record<string, unknown>;
  const generation = (input: unknown): input is string =>
    typeof input === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(input);
  const legacyManualSettings =
    settings.manualWorkoutContextEnabled === undefined &&
    settings.manualWorkoutContextNoticeVersion === undefined;
  const legacyHistorySettings =
    settings.consentReviewed === undefined &&
    settings.historyUse === undefined &&
    settings.historyUseNoticeVersion === undefined;
  if (
    typeof settings.cloudEnabled !== "boolean" ||
    typeof settings.fitnessContextEnabled !== "boolean" ||
    (!legacyManualSettings &&
      (typeof settings.manualWorkoutContextEnabled !== "boolean" ||
        settings.manualWorkoutContextNoticeVersion !== CHAT_MANUAL_WORKOUT_NOTICE_VERSION)) ||
    (!legacyHistorySettings &&
      (typeof settings.consentReviewed !== "boolean" ||
        (settings.historyUse !== "when_requested" && settings.historyUse !== "when_relevant") ||
        settings.historyUseNoticeVersion !== CHAT_HISTORY_USE_NOTICE_VERSION)) ||
    (!settings.cloudEnabled &&
      (settings.fitnessContextEnabled ||
        settings.manualWorkoutContextEnabled === true ||
        settings.historyUse === "when_relevant")) ||
    (settings.consentReviewed === false &&
      (settings.cloudEnabled ||
        settings.fitnessContextEnabled ||
        settings.manualWorkoutContextEnabled === true ||
        settings.historyUse === "when_relevant")) ||
    settings.noticeVersion !== CHAT_NOTICE_VERSION ||
    !generation(settings.consentGeneration) ||
    !generation(settings.historyGeneration) ||
    typeof settings.providerAvailable !== "boolean" ||
    typeof settings.model !== "string" ||
    settings.model.length > 200
  )
    throw invalid();
  return {
    cloudEnabled: settings.cloudEnabled,
    fitnessContextEnabled: settings.fitnessContextEnabled,
    manualWorkoutContextEnabled: settings.manualWorkoutContextEnabled === true,
    manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
    consentReviewed: legacyHistorySettings || settings.consentReviewed === true,
    historyUse: settings.historyUse === "when_relevant" ? "when_relevant" : "when_requested",
    historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
    consentGeneration: settings.consentGeneration,
    historyGeneration: settings.historyGeneration,
    noticeVersion: CHAT_NOTICE_VERSION,
    providerAvailable: settings.providerAvailable,
    model: settings.model,
  };
}
