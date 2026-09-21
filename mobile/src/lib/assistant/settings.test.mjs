import assert from "node:assert/strict";
import test from "node:test";
import { chatPermissionUpdate, readChatSettings } from "./settings.ts";
import {
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_NOTICE_VERSION,
} from "../../../../shared/conversation.ts";

const settings = {
  cloudEnabled: true,
  fitnessContextEnabled: false,
  manualWorkoutContextEnabled: false,
  consentGeneration: "consent-generation",
  historyGeneration: "history-generation",
  noticeVersion: CHAT_NOTICE_VERSION,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  providerAvailable: true,
  model: "test/model",
};

test("Apple Health and manual workout context require independent explicit choices", () => {
  const health = chatPermissionUpdate(settings, "fitnessContextEnabled", true);
  assert.equal(health.fitnessContextEnabled, true);
  assert.equal(health.manualWorkoutContextEnabled, false);
  const manual = chatPermissionUpdate(settings, "manualWorkoutContextEnabled", true);
  assert.equal(manual.manualWorkoutContextEnabled, true);
  assert.equal(manual.fitnessContextEnabled, false);
  assert.equal(manual.manualWorkoutContextNoticeVersion, CHAT_MANUAL_WORKOUT_NOTICE_VERSION);
  const both = chatPermissionUpdate(health, "manualWorkoutContextEnabled", true);
  assert.equal(both.fitnessContextEnabled, true);
  assert.equal(both.manualWorkoutContextEnabled, true);
  assert.equal(
    chatPermissionUpdate(both, "fitnessContextEnabled", false).manualWorkoutContextEnabled,
    true,
  );
  assert.equal(
    chatPermissionUpdate(both, "manualWorkoutContextEnabled", false).fitnessContextEnabled,
    true,
  );
});

test("cloud off revokes both optional grants, and re-enabling does not restore them", () => {
  const enabled = { ...settings, fitnessContextEnabled: true, manualWorkoutContextEnabled: true };
  const off = chatPermissionUpdate(enabled, "cloudEnabled", false);
  for (const choice of [off, chatPermissionUpdate(off, "cloudEnabled", true)]) {
    assert.equal(choice.fitnessContextEnabled, false);
    assert.equal(choice.manualWorkoutContextEnabled, false);
  }
  for (const permission of ["fitnessContextEnabled", "manualWorkoutContextEnabled"]) {
    const attempted = chatPermissionUpdate(off, permission, true);
    assert.equal(attempted.cloudEnabled, false);
    assert.equal(attempted[permission], false);
  }
  // Even inconsistent cached input must not revive a previously revoked grant.
  const stale = chatPermissionUpdate({ ...enabled, cloudEnabled: false }, "cloudEnabled", true);
  assert.equal(stale.fitnessContextEnabled, false);
  assert.equal(stale.manualWorkoutContextEnabled, false);
});

test("settings keep server generations and never interpret legacy Health consent as manual consent", () => {
  assert.deepEqual(readChatSettings(settings), settings);
  const { manualWorkoutContextEnabled, manualWorkoutContextNoticeVersion, ...legacy } = settings;
  const parsed = readChatSettings({ ...legacy, fitnessContextEnabled: true });
  assert.equal(parsed.manualWorkoutContextEnabled, false);
  assert.equal(parsed.fitnessContextEnabled, true);
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
    { ...settings, cloudEnabled: false, manualWorkoutContextEnabled: true },
    { ...settings, cloudEnabled: false, fitnessContextEnabled: true },
    { ...settings, consentGeneration: "" },
    { ...settings, historyGeneration: null },
    { ...settings, noticeVersion: "future-notice" },
  ])
    assert.throws(() => readChatSettings(invalid), /permissions could not be loaded/);
});
