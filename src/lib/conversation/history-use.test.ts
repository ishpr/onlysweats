import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { fixtureMember } from "../workout-plans/fixtures.ts";
import {
  CHAT_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  CHAT_HISTORY_USE_NOTICE_VERSION,
  type ChatSettings,
  type ChatEvent,
} from "../../../shared/conversation.ts";
import { ChatError, chatResponse, getHistory, setSettings, turnInput } from "./service.server.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const legacy = (enabled = true) => ({
  cloudEnabled: enabled,
  fitnessContextEnabled: false,
  noticeVersion: CHAT_NOTICE_VERSION,
});
const relevant = () => ({
  ...legacy(),
  manualWorkoutContextEnabled: true,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  historyUse: "when_relevant" as const,
  historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
});
const turn = (settings: ChatSettings) => ({
  requestId: randomUUID(),
  text: "What could I work on today?",
  consentGeneration: settings.consentGeneration,
  historyGeneration: settings.historyGeneration,
});
const conflict = (error: unknown) => error instanceof ChatError && error.status === 409;
const events = async (response: Response): Promise<ChatEvent[]> =>
  (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe("built-in coaching consent compatibility", () => {
  it("backfills existing opt-outs as reviewed without broadening either legacy history grant", async () => {
    const db = new PGlite();
    try {
      await db.exec('create table "user" (id text primary key)');
      for (const name of ["0027_conversation.sql", "0030_manual_workout_context.sql"])
        await db.exec(
          await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"),
        );
      await db.exec(`insert into "user" values ('off'), ('old-grants');`);
      for (const id of ["off", "old-grants"])
        await db.query(
          `insert into assistant_chat_settings
          (user_id,cloud_enabled,fitness_context_enabled,manual_workout_context_enabled,
           manual_workout_notice_version,consent_generation,history_generation,notice_version)
          values ($1,$2,$2,$2,$3,$4,$5,$6)`,
          [
            id,
            id === "old-grants",
            id === "old-grants" ? CHAT_MANUAL_WORKOUT_NOTICE_VERSION : null,
            randomUUID(),
            randomUUID(),
            CHAT_NOTICE_VERSION,
          ],
        );
      await db.exec(
        await readFile(
          new URL("../../../migrations/0032_conversation_history_use.sql", import.meta.url),
          "utf8",
        ),
      );
      const { rows } = await db.query<{
        user_id: string;
        cloud_enabled: boolean;
        fitness_context_enabled: boolean;
        manual_workout_context_enabled: boolean;
        consent_reviewed: boolean;
        history_use: string;
      }>("select * from assistant_chat_settings order by user_id");
      for (const row of rows) {
        assert.equal(row.consent_reviewed, true);
        assert.equal(row.history_use, "when_requested");
        assert.equal(row.cloud_enabled, row.user_id === "old-grants");
        assert.equal(row.fitness_context_enabled, row.user_id === "old-grants");
        assert.equal(row.manual_workout_context_enabled, row.user_id === "old-grants");
      }
      await db.exec("insert into \"user\" values ('fresh')");
      await db.query(
        "insert into assistant_chat_settings (user_id,consent_generation,history_generation,notice_version) values ('fresh',$1,$2,$3)",
        [randomUUID(), randomUUID(), CHAT_NOTICE_VERSION],
      );
      assert.equal(
        (
          await db.query<{ consent_reviewed: boolean }>(
            "select consent_reviewed from assistant_chat_settings where user_id='fresh'",
          )
        ).rows[0].consent_reviewed,
        false,
      );
    } finally {
      await db.close();
    }
  });

  it("does not grant anything on read, and accepts combined first use once with Health still off", async () => {
    const id = await fixtureMember(sql);
    const initial = (await getHistory(sql, id)).settings;
    assert.equal(initial.consentReviewed, false);
    assert.equal(initial.cloudEnabled, false);
    assert.equal(initial.manualWorkoutContextEnabled, false);
    assert.equal(initial.historyUse, "when_requested");
    const body = {
      ...relevant(),
      initialSetup: true,
      expectedConsentGeneration: initial.consentGeneration,
    };
    const accepted = (await setSettings(sql, id, body)).settings;
    assert.equal(accepted.consentReviewed, true);
    assert.equal(accepted.cloudEnabled, true);
    assert.equal(accepted.manualWorkoutContextEnabled, true);
    assert.equal(accepted.fitnessContextEnabled, false);
    assert.equal(accepted.historyUse, "when_relevant");
    await assert.rejects(setSettings(sql, id, body), conflict);
    assert.deepEqual((await getHistory(sql, id)).settings, accepted);
  });

  it("rejects stale first use after another device opted out, and rejects stale broader permission review", async () => {
    const id = await fixtureMember(sql);
    const first = (await getHistory(sql, id)).settings;
    const off = (await setSettings(sql, id, legacy(false))).settings;
    await assert.rejects(setSettings(sql, id, { ...relevant(), initialSetup: true }), conflict);
    await assert.rejects(
      setSettings(sql, id, { ...relevant(), expectedConsentGeneration: first.consentGeneration }),
      conflict,
    );
    assert.deepEqual((await getHistory(sql, id)).settings, off);
    assert.equal(off.consentReviewed, true);
    assert.equal(off.cloudEnabled, false);
  });

  it("requires a current notice and cloud grant, preserves legacy behavior and revokes broader use on cloud off", async () => {
    const id = await fixtureMember(sql);
    const old = (await setSettings(sql, id, legacy())).settings;
    assert.equal(old.consentReviewed, true);
    assert.equal(old.historyUse, "when_requested");
    for (const body of [
      { ...relevant(), historyUseNoticeVersion: undefined },
      { ...relevant(), historyUseNoticeVersion: "future-version" },
      { ...relevant(), manualWorkoutContextEnabled: false, cloudEnabled: false },
      { ...relevant(), historyUse: "always" },
    ])
      await assert.rejects(setSettings(sql, id, body), z.ZodError);
    const accepted = (await setSettings(sql, id, relevant())).settings;
    const legacyUpdate = (await setSettings(sql, id, legacy())).settings;
    assert.equal(legacyUpdate.historyUse, "when_relevant");
    assert.equal(
      legacyUpdate.manualWorkoutContextEnabled,
      false,
      "Older clients do not grant a new data source.",
    );
    assert.notEqual(legacyUpdate.consentGeneration, accepted.consentGeneration);
    const off = (await setSettings(sql, id, legacy(false))).settings;
    assert.equal(off.historyUse, "when_requested");
    const on = (await setSettings(sql, id, legacy())).settings;
    assert.equal(on.historyUse, "when_requested");
    assert.equal(on.manualWorkoutContextEnabled, false);
    assert.equal(on.fitnessContextEnabled, false);
  });

  it("passes only the server-accepted mode to the provider, and mode alone grants no record access", async () => {
    const id = await fixtureMember(sql);
    for (const mode of ["when_requested", "when_relevant"] as const) {
      const settings = (
        await setSettings(sql, id, {
          ...legacy(),
          historyUse: mode,
          historyUseNoticeVersion: CHAT_HISTORY_USE_NOTICE_VERSION,
        })
      ).settings;
      assert.equal(
        turnInput.safeParse({ ...turn(settings), historyUse: "when_relevant" }).success,
        false,
      );
      const result = await events(
        await chatResponse(sql, id, turn(settings), new AbortController().signal, {
          available: true,
          provider: async ({ historyUse, tools, onText }) => {
            assert.equal(historyUse, mode);
            assert.equal(
              ((await tools.manualWorkouts!()) as { available: boolean }).available,
              false,
            );
            assert.equal(((await tools.workouts()) as { available: boolean }).available, false);
            await onText("No recorded history has been shared.");
          },
        }),
      );
      assert.equal(result.at(-1)?.type, "done");
    }
  });

  it("downgrading history mode clears the conversation and stops a pending private reply", async () => {
    const id = await fixtureMember(sql);
    const settings = (await setSettings(sql, id, relevant())).settings;
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const response = await chatResponse(sql, id, turn(settings), new AbortController().signal, {
      available: true,
      provider: async ({ tools, onText }) => {
        assert.equal(((await tools.manualWorkouts!()) as { available: boolean }).available, true);
        started();
        await resumed;
        await onText("This old reply must not escape.");
      },
    });
    await entered;
    const downgraded = (
      await setSettings(sql, id, {
        ...relevant(),
        historyUse: "when_requested",
        expectedConsentGeneration: settings.consentGeneration,
      })
    ).settings;
    release();
    const result = await events(response);
    assert.equal(result.at(-1)?.type, "error");
    assert.equal(
      result.some((event) => event.type === "delta"),
      false,
    );
    assert.notEqual(downgraded.consentGeneration, settings.consentGeneration);
    assert.notEqual(downgraded.historyGeneration, settings.historyGeneration);
    assert.deepEqual((await getHistory(sql, id)).messages, []);
    await assert.rejects(
      chatResponse(sql, id, turn(settings), new AbortController().signal, { available: true }),
      conflict,
    );
  });
});
