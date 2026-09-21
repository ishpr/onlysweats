import assert from "node:assert/strict";
import test from "node:test";
import { chatHistoryUseUpdate, chatPermissionUpdate, readChatSettings } from "./settings.ts";
import {
  CHAT_HISTORY_USE_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_NOTICE_VERSION,
} from "../../../../shared/conversation.ts";

const settings = {
  cloudEnabled: true,
  fitnessContextEnabled: false,
  manualWorkoutContextEnabled: false,
  consentReviewed: true,
  historyUse: "when_requested",
  historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
  consentGeneration: "consent-generation",
  historyGeneration: "history-generation",
  noticeVersion: CHAT_NOTICE_VERSION,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  providerAvailable: true,
  model: "test/model",
};
const applied = (update) => ({ ...settings, ...update });

test("Apple Health and manual workout context require independent explicit choices", () => {
  const health = chatPermissionUpdate(settings, "fitnessContextEnabled", true);
  assert.equal(health.fitnessContextEnabled, true);
  assert.equal(health.manualWorkoutContextEnabled, false);
  const manual = chatPermissionUpdate(settings, "manualWorkoutContextEnabled", true);
  assert.equal(manual.manualWorkoutContextEnabled, true);
  assert.equal(manual.fitnessContextEnabled, false);
  assert.equal(manual.manualWorkoutContextNoticeVersion, CHAT_MANUAL_WORKOUT_NOTICE_VERSION);
  assert.equal(manual.historyUse, "when_requested");
  const both = chatPermissionUpdate(applied(health), "manualWorkoutContextEnabled", true);
  assert.equal(both.fitnessContextEnabled, true);
  assert.equal(both.manualWorkoutContextEnabled, true);
  assert.equal(
    chatPermissionUpdate(applied(both), "fitnessContextEnabled", false).manualWorkoutContextEnabled,
    true,
  );
  assert.equal(
    chatPermissionUpdate(applied(both), "manualWorkoutContextEnabled", false).fitnessContextEnabled,
    true,
  );
});

test("cloud off revokes optional grants and relevance; re-enabling never restores them", () => {
  const enabled = {
    ...settings,
    fitnessContextEnabled: true,
    manualWorkoutContextEnabled: true,
    historyUse: "when_relevant",
  };
  const off = chatPermissionUpdate(enabled, "cloudEnabled", false);
  for (const choice of [off, chatPermissionUpdate(applied(off), "cloudEnabled", true)]) {
    assert.equal(choice.fitnessContextEnabled, false);
    assert.equal(choice.manualWorkoutContextEnabled, false);
    assert.equal(choice.historyUse, "when_requested");
  }
  for (const permission of ["fitnessContextEnabled", "manualWorkoutContextEnabled"]) {
    const attempted = chatPermissionUpdate(applied(off), permission, true);
    assert.equal(attempted.cloudEnabled, false);
    assert.equal(attempted[permission], false);
  }
  // Even inconsistent cached input must not revive a previously revoked grant.
  const stale = chatPermissionUpdate({ ...enabled, cloudEnabled: false }, "cloudEnabled", true);
  assert.equal(stale.fitnessContextEnabled, false);
  assert.equal(stale.manualWorkoutContextEnabled, false);
  assert.equal(stale.historyUse, "when_requested");
});

test("existing Health or manual grants never broaden before explicit relevance review", () => {
  for (const permission of ["fitnessContextEnabled", "manualWorkoutContextEnabled"]) {
    const previous = { ...settings, [permission]: true };
    const unchanged = chatPermissionUpdate(previous, "cloudEnabled", true);
    assert.equal(unchanged.historyUse, "when_requested");
    const reviewed = chatHistoryUseUpdate(previous, "when_relevant");
    assert.equal(reviewed.fitnessContextEnabled, previous.fitnessContextEnabled);
    assert.equal(reviewed.manualWorkoutContextEnabled, previous.manualWorkoutContextEnabled);
    assert.equal(reviewed.historyUse, "when_relevant");
    assert.equal(reviewed.expectedConsentGeneration, previous.consentGeneration);
    const narrowed = chatHistoryUseUpdate(applied(reviewed), "when_requested");
    assert.equal(narrowed[permission], true);
    assert.equal(narrowed.historyUse, "when_requested");
  }
  assert.throws(() => chatHistoryUseUpdate({ ...settings, cloudEnabled: false }, "when_relevant"));
});

test("every settings mutation binds to the reviewed permission generation", () => {
  const current = { ...settings, consentGeneration: "newest-reviewed-generation" };
  for (const update of [
    chatPermissionUpdate(current, "manualWorkoutContextEnabled", true),
    chatPermissionUpdate(current, "fitnessContextEnabled", false),
    chatPermissionUpdate(current, "cloudEnabled", false),
    chatHistoryUseUpdate(current, "when_relevant"),
  ])
    assert.equal(update.expectedConsentGeneration, "newest-reviewed-generation");
});

test("older server settings are treated as reviewed and never infer new history consent", () => {
  assert.deepEqual(readChatSettings(settings), settings);
  const {
    manualWorkoutContextEnabled,
    manualWorkoutContextNoticeVersion,
    consentReviewed,
    historyUse,
    historyUseNoticeVersion,
    ...legacy
  } = settings;
  const parsed = readChatSettings({ ...legacy, fitnessContextEnabled: true });
  assert.equal(parsed.manualWorkoutContextEnabled, false);
  assert.equal(parsed.fitnessContextEnabled, true);
  assert.equal(parsed.consentReviewed, true);
  assert.equal(parsed.historyUse, "when_requested");
  assert.equal(parsed.consentGeneration, settings.consentGeneration);
  assert.equal(parsed.historyGeneration, settings.historyGeneration);
  assert.equal(
    chatPermissionUpdate(parsed, "fitnessContextEnabled", false).manualWorkoutContextEnabled,
    false,
  );
});

test("malformed permissions and unrecognized notices cannot populate privacy switches", () => {
  for (const invalid of [
    null,
    [],
    { ...settings, cloudEnabled: "true" },
    { ...settings, fitnessContextEnabled: 1 },
    { ...settings, manualWorkoutContextEnabled: "true" },
    { ...settings, manualWorkoutContextNoticeVersion: "future-notice" },
    { ...settings, manualWorkoutContextNoticeVersion: undefined },
    { ...settings, manualWorkoutContextEnabled: undefined },
    { ...settings, consentReviewed: undefined },
    { ...settings, consentReviewed: "true" },
    { ...settings, consentReviewed: false },
    { ...settings, historyUse: "always" },
    { ...settings, historyUse: ["when_requested"] },
    { ...settings, historyUse: undefined },
    { ...settings, historyUseNoticeVersion: undefined },
    { ...settings, historyUseNoticeVersion: "future-notice" },
    { ...settings, cloudEnabled: false, manualWorkoutContextEnabled: true },
    { ...settings, cloudEnabled: false, fitnessContextEnabled: true },
    { ...settings, cloudEnabled: false, historyUse: "when_relevant" },
    { ...settings, consentGeneration: "" },
    { ...settings, historyGeneration: null },
    { ...settings, noticeVersion: "future-notice" },
  ])
    assert.throws(() => readChatSettings(invalid), /permissions could not be loaded/);
});
