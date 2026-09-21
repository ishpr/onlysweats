import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import { fixtureMember } from "../workout-plans/fixtures.ts";
import { getConsent, setConsent } from "../fitness/service.server.ts";
import { deleteAccount } from "../pace/safety.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { CHAT_NOTICE_VERSION } from "../../../shared/conversation.ts";
import { FITNESS_AI_NOTICE_VERSION } from "../../../shared/fitness.ts";
import {
  acceptAppTerms,
  getAppTerms,
  getHistory,
  setSettings,
  chatResponse,
  ChatError,
} from "./service.server.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const body = { version: APP_TERMS_VERSION };
const oldSettings = (enabled = false) => ({
  cloudEnabled: enabled,
  fitnessContextEnabled: false,
  noticeVersion: CHAT_NOTICE_VERSION,
});

describe("product terms acceptance initializes coaching without undoing privacy choices", () => {
  it("lets paused members accept terms without granting new AI access", async () => {
    const id = await fixtureMember(sql);
    await sql`update profiles set suspended_at=now() where id=${id}`;
    const accepted = await acceptAppTerms(sql, id, body);
    assert.equal(accepted.accepted, true);
    const settings = (await getHistory(sql, id)).settings;
    assert.equal(settings.consentReviewed, true);
    assert.equal(settings.cloudEnabled, false);
    assert.equal(settings.fitnessContextEnabled, false);
    assert.equal(settings.manualWorkoutContextEnabled, false);
    assert.equal(settings.historyUse, "when_requested");
    assert.equal((await getConsent(sql, id)).enabled, false);
    let called = false;
    await assert.rejects(
      chatResponse(
        sql,
        id,
        {
          requestId: randomUUID(),
          text: "Test",
          consentGeneration: settings.consentGeneration,
          historyGeneration: settings.historyGeneration,
        },
        new AbortController().signal,
        {
          available: true,
          provider: async () => {
            called = true;
          },
        },
      ),
      (error) => error instanceof ChatError && error.status === 403,
    );
    assert.equal(called, false);
    await sql`update profiles set suspended_at=null where id=${id}`;
    assert.deepEqual(await acceptAppTerms(sql, id, body), accepted);
    assert.deepEqual((await getHistory(sql, id)).settings, settings);
    assert.equal((await getConsent(sql, id)).enabled, false);
  });
  it("removes acceptance and generation receipts when the member deletes their account", async () => {
    const id = await fixtureMember(sql);
    await acceptAppTerms(sql, id, body);
    await deleteAccount(sql, id);
    assert.equal((await sql`select * from app_terms_acceptances where user_id=${id}`).length, 0);
    assert.equal((await sql`select * from assistant_chat_settings where user_id=${id}`).length, 0);
    assert.equal((await sql`select * from fitness_consents where user_id=${id}`).length, 0);
    await assert.rejects(
      getAppTerms(sql, id),
      (error) => error instanceof ChatError && error.status === 401,
    );
  });
  it("reads without granting anything, then atomically records fresh defaults and their generations", async () => {
    const id = await fixtureMember(sql);
    assert.deepEqual(await getAppTerms(sql, id), {
      ownerId: id,
      version: APP_TERMS_VERSION,
      accepted: false,
      acceptedVersion: null,
      acceptedAt: null,
    });
    assert.equal((await sql`select * from assistant_chat_settings where user_id=${id}`).length, 0);
    assert.equal((await sql`select * from fitness_consents where user_id=${id}`).length, 0);
    const accepted = await acceptAppTerms(sql, id, body);
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.ownerId, id);
    assert.equal(accepted.acceptedVersion, APP_TERMS_VERSION);
    assert.ok(accepted.acceptedAt);
    const settings = (await getHistory(sql, id)).settings;
    assert.equal(settings.consentReviewed, true);
    assert.equal(settings.cloudEnabled, true);
    assert.equal(settings.manualWorkoutContextEnabled, true);
    assert.equal(settings.fitnessContextEnabled, true);
    assert.equal(settings.historyUse, "when_relevant");
    const fitness = await getConsent(sql, id);
    assert.equal(fitness.enabled, true);
    assert.equal(fitness.noticeVersion, FITNESS_AI_NOTICE_VERSION);
    const [receipt] = await sql`select * from app_terms_acceptances where user_id=${id}`;
    assert.equal(receipt.assistant_consent_generation, settings.consentGeneration);
    assert.equal(receipt.fitness_consent_generation, fitness.generation);
    assert.equal((await sql`select * from health_connections where user_id=${id}`).length, 0);
    assert.equal((await sql`select * from fitness_pilot_consents where user_id=${id}`).length, 0);
    assert.equal((await sql`select * from assistant_chat_messages where user_id=${id}`).length, 0);
    assert.deepEqual(await getAppTerms(sql, id), accepted);
  });

  it("preserves existing opt-outs, and replay after later revocation cannot restore fresh defaults", async () => {
    const id = await fixtureMember(sql);
    await setSettings(sql, id, oldSettings());
    await setConsent(sql, id, { enabled: false });
    const before = (await getHistory(sql, id)).settings;
    const beforeFitness = await getConsent(sql, id);
    await acceptAppTerms(sql, id, body);
    assert.deepEqual((await getHistory(sql, id)).settings, before);
    assert.deepEqual(await getConsent(sql, id), beforeFitness);

    const fresh = await fixtureMember(sql);
    const accepted = await acceptAppTerms(sql, fresh, body, Date.now() - 1000);
    const off = (await setSettings(sql, fresh, oldSettings())).settings;
    const fitnessOff = await setConsent(sql, fresh, { enabled: false });
    assert.deepEqual(await acceptAppTerms(sql, fresh, body), accepted);
    assert.deepEqual((await getHistory(sql, fresh)).settings, off);
    assert.deepEqual(await getConsent(sql, fresh), fitnessOff);
  });

  it("does not change a reviewed member's source permissions, history or usage on acceptance", async () => {
    const id = await fixtureMember(sql);
    const settings = (await setSettings(sql, id, oldSettings(true))).settings;
    const response = await chatResponse(
      sql,
      id,
      {
        requestId: randomUUID(),
        text: "A general question.",
        consentGeneration: settings.consentGeneration,
        historyGeneration: settings.historyGeneration,
      },
      new AbortController().signal,
      {
        available: true,
        provider: async ({ onText }) => {
          await onText("A general answer.");
        },
      },
    );
    await response.text();
    await setConsent(sql, id, { enabled: true });
    await sql`update fitness_consents set request_count=21,request_day='2026-09-21' where user_id=${id}`;
    const [before] = await sql`select * from assistant_chat_settings where user_id=${id}`;
    const [beforeFitness] = await sql`select * from fitness_consents where user_id=${id}`;
    const history = await getHistory(sql, id);
    await acceptAppTerms(sql, id, body);
    assert.deepEqual(
      (await sql`select * from assistant_chat_settings where user_id=${id}`)[0],
      before,
    );
    assert.deepEqual(
      (await sql`select * from fitness_consents where user_id=${id}`)[0],
      beforeFitness,
    );
    assert.deepEqual(await getHistory(sql, id), history);
    assert.equal(history.settings.historyUse, "when_requested");
    assert.equal(history.settings.fitnessContextEnabled, false);
    assert.equal(history.settings.manualWorkoutContextEnabled, false);
  });

  it("rejects old versions, owner injection and nonexistent owners before acceptance", async () => {
    const id = await fixtureMember(sql);
    for (const value of [
      { version: "older" },
      { ...body, ownerId: randomUUID() },
      { ...body, cloudEnabled: true },
    ])
      await assert.rejects(acceptAppTerms(sql, id, value), z.ZodError);
    assert.equal((await getAppTerms(sql, id)).accepted, false);
    await assert.rejects(
      acceptAppTerms(sql, randomUUID(), body),
      (error) => error instanceof ChatError && error.status === 401,
    );
  });

  it("rolls back all new grants if persisting acceptance fails", async () => {
    const id = await fixtureMember(sql);
    const fail = (tx: Sql): Sql => {
      const wrap = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (/insert into app_terms_acceptances/.test(strings.join("")))
          throw new Error("Synthetic receipt failure");
        return tx(strings, ...values);
      }) as Sql;
      wrap.query = tx.query;
      wrap.transaction = (fn) => fn(wrap);
      return wrap;
    };
    const faulty = Object.assign((...args: Parameters<Sql>) => sql(...args), {
      query: sql.query,
      transaction: <T>(fn: (tx: Sql) => Promise<T>) => sql.transaction((tx) => fn(fail(tx))),
    }) as Sql;
    await assert.rejects(acceptAppTerms(faulty, id, body), /Synthetic receipt failure/);
    assert.equal((await getAppTerms(sql, id)).accepted, false);
    assert.equal((await sql`select * from assistant_chat_settings where user_id=${id}`).length, 0);
    assert.equal((await sql`select * from fitness_consents where user_id=${id}`).length, 0);
  });
});
