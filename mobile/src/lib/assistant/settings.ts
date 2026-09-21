import {
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_NOTICE_VERSION,
  type ChatSettings,
} from "../../../../shared/conversation.ts";

export type ChatPermission =
  "cloudEnabled" | "fitnessContextEnabled" | "manualWorkoutContextEnabled";

/** One explicit choice may preserve other grants, but never creates another grant. */
export function chatPermissionUpdate(
  settings: Pick<ChatSettings, ChatPermission>,
  permission: ChatPermission,
  enabled: boolean,
) {
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
    noticeVersion: CHAT_NOTICE_VERSION,
    manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  };
}

/** Older servers have no manual-record grant; malformed or newer notices fail closed. */
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
  if (
    typeof settings.cloudEnabled !== "boolean" ||
    typeof settings.fitnessContextEnabled !== "boolean" ||
    (!legacyManualSettings &&
      (typeof settings.manualWorkoutContextEnabled !== "boolean" ||
        settings.manualWorkoutContextNoticeVersion !== CHAT_MANUAL_WORKOUT_NOTICE_VERSION)) ||
    (!settings.cloudEnabled &&
      (settings.fitnessContextEnabled || settings.manualWorkoutContextEnabled === true)) ||
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
    consentGeneration: settings.consentGeneration,
    historyGeneration: settings.historyGeneration,
    noticeVersion: CHAT_NOTICE_VERSION,
    providerAvailable: settings.providerAvailable,
    model: settings.model,
  };
}
