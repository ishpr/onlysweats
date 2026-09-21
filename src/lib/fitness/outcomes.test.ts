import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import type { StrengthLogInput } from "../../../shared/fitness.ts";
import * as fitness from "./service.server.ts";
import * as pilot from "./outcomes.server.ts";
import { FitnessError } from "./contracts.ts";
import { FITNESS_MODEL } from "./questions.ts";
import type { FitnessProvider } from "./typesafe.server.ts";

let sql: Sql;
const now = Date.now();
const logInput: StrengthLogInput = {
  startedAt: new Date(now - 3600_000).toISOString(),
  exerciseId: "squat",
  note: "Private synthetic note; must not appear in telemetry",
  sets: Array.from({ length: 3 }, () => ({ reps: 8, weight: 40, unit: "kg" })),
};
const note = "Squat 3 sets of 8 at 40 kg.";
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (error: unknown) => error instanceof FitnessError && error.status === status,
  );
const provider =
  (missing: string[] = []): FitnessProvider =>
  async (_state, questions) => {
    const selections: Record<string, string> = {
      log_scope: "single_exercise",
      exercise: "squat",
      sets: "n0",
      reps: "n1",
      weight: "n2",
      unit: "kg",
    };
    return {
      model: FITNESS_MODEL,
      latencyMs: 10,
      usage: { inputTokens: 3, outputTokens: 4 },
      answers: Object.fromEntries(
        Object.keys(questions).map((key) => {
          const choice = missing.includes(key) ? "not_stated" : selections[key];
          return [
            key,
            { type: "choice", choice, confidence: 0.99, probabilities: { [choice]: 1 } },
          ];
        }),
      ),
    };
  };
async function member(db = sql, enabled = true) {
  const id = randomUUID();
  await db`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Synthetic pilot member', ${`${id}@example.test`}, true)`;
  if (enabled) {
    await fitness.setConsent(db, id, { enabled: true }, now);
    await pilot.setPilotConsent(db, id, { enabled: true }, now);
  }
  return id;
}
async function prepared(id: string, missing: string[] = [], at = now, db = sql) {
  const session = (await pilot.startLoggingSession(db, id, {}, at))!;
  const draft = await fitness.draftExercise(
    db,
    id,
    { note, loggingSessionId: session.id },
    { provider: provider(missing), now: at + 1000 },
  );
  assert.ok(draft.measurement);
  return { session, draft, input: { ...logInput, measurement: draft.measurement } };
}
before(async () => {
  sql = await makeDb();
});

describe("separate, optional fitness feedback consent", () => {
  it("is off by default, requires AI permission, and creates no telemetry for ordinary logs or drafts", async () => {
    const id = await member(sql, false);
    assert.equal((await pilot.getPilotConsent(sql, id)).enabled, false);
    assert.equal(await pilot.startLoggingSession(sql, id, {}, now), null);
    await rejects(pilot.setPilotConsent(sql, id, { enabled: true }, now), 403);
    await fitness.setConsent(sql, id, { enabled: true }, now);
    const draft = await fitness.draftExercise(sql, id, { note }, { provider: provider(), now });
    assert.equal(draft.measurement, undefined);
    await fitness.createStrengthLog(sql, id, logInput, now);
    const rows = await sql`select * from fitness_logging_sessions where user_id = ${id}`;
    assert.equal(rows.length, 0);
    await assert.rejects(pilot.startLoggingSession(sql, id, { elapsedMs: 1 }, now));
  });
  it("allows restricted members to read/revoke consent but not enable the pilot", async () => {
    const id = await member();
    await sql`insert into profiles (id, name, handle, initials, suspended_at) values (${id}, 'Restricted', ${id}, 'R', ${new Date(now)})`;
    assert.equal((await pilot.getPilotConsent(sql, id)).enabled, true);
    await rejects(pilot.setPilotConsent(sql, id, { enabled: true }, now), 403);
    assert.equal((await pilot.setPilotConsent(sql, id, { enabled: false }, now)).enabled, false);
    await sql`update profiles set suspended_at = null, deleted_at = ${new Date(now)} where id = ${id}`;
    await rejects(pilot.setPilotConsent(sql, id, { enabled: true }, now), 403);
    assert.equal((await pilot.setPilotConsent(sql, id, { enabled: false }, now)).enabled, false);
  });
  it("purges on either consent revocation and invalidates in-flight results across re-enable", async () => {
    const id = await member();
    const session = (await pilot.startLoggingSession(sql, id, {}, now))!;
    const delayed: FitnessProvider = async (state, questions) => {
      await pilot.setPilotConsent(sql, id, { enabled: false }, now + 1100);
      await pilot.setPilotConsent(sql, id, { enabled: true }, now + 1200);
      return provider()(state, questions);
    };
    const draft = await fitness.draftExercise(
      sql,
      id,
      { note, loggingSessionId: session.id },
      { provider: delayed, now: now + 1000 },
    );
    assert.equal(draft.measurement, undefined);
    await rejects(pilot.getLoggingOutcome(sql, id, session.id, now + 2000), 404);
    const next = await prepared(id, [], now + 5000);
    await fitness.createStrengthLog(sql, id, next.input, now + 10000);
    await fitness.setConsent(sql, id, { enabled: false }, now + 11000);
    assert.equal((await pilot.getPilotConsent(sql, id)).enabled, false);
    assert.equal(
      (await sql`select id from fitness_logging_sessions where user_id = ${id}`).length,
      0,
    );
    assert.equal((await fitness.listStrengthLogs(sql, id, { limit: 10 })).logs.length, 1);
  });
  it("isolates receipts and feedback by owner without exposing an existing receipt", async () => {
    const a = await member();
    const b = await member();
    const { draft, session } = await prepared(a);
    const isolated = await fitness.createStrengthLog(
      sql,
      b,
      { ...logInput, measurement: draft.measurement },
      now + 2000,
    );
    assert.equal(isolated.measurementSessionId, undefined);
    assert.equal((await pilot.getLoggingOutcome(sql, a, session.id, now)).status, "open");
    await rejects(
      fitness.draftExercise(
        sql,
        b,
        { note, loggingSessionId: session.id },
        { provider: provider(), now },
      ),
      404,
    );
    await rejects(pilot.getLoggingOutcome(sql, b, session.id, now), 404);
    await rejects(
      pilot.recordPilotFeedback(
        sql,
        b,
        session.id,
        { helpfulness: "helpful", timeSaved: "yes" },
        now,
      ),
      404,
    );
  });
});

describe("server-verified draft outcomes", () => {
  it("compares actual saved fields, keeps absence separate, and deduplicates save and feedback retries", async () => {
    const id = await member();
    const { session, draft, input } = await prepared(id, ["weight"]);
    assert.equal(draft.weight, null);
    const log = await fitness.createStrengthLog(sql, id, input, now + 12345);
    assert.equal((await fitness.createStrengthLog(sql, id, input, now + 12346)).id, log.id);
    assert.equal(log.measurementSessionId, session.id);
    assert.equal(
      (await fitness.listStrengthLogs(sql, id, { limit: 10 })).logs[0].measurementSessionId,
      session.id,
    );
    const result = await pilot.getLoggingOutcome(sql, id, session.id, now + 14000);
    assert.deepEqual(result, {
      sessionId: session.id,
      logId: log.id,
      startedAt: new Date(now).toISOString(),
      savedAt: new Date(now + 12345).toISOString(),
      status: "saved",
      mode: "linked_draft",
      draftStatus: "available",
      elapsedMs: 12345,
      suggestedFields: 4,
      unchangedSuggestedFields: 4,
      changedSuggestedFields: 0,
      filledMissingFields: 1,
      comparisonRevision: 1,
      feedback: null,
    });
    await rejects(
      fitness.createStrengthLog(sql, id, { ...input, note: "different log" }, now + 15000),
      409,
    );
    const feedback = { helpfulness: "helpful", timeSaved: "unsure" };
    const first = await pilot.recordPilotFeedback(sql, id, session.id, feedback, now + 16000);
    assert.deepEqual(
      await pilot.recordPilotFeedback(sql, id, session.id, feedback, now + 16001),
      first,
    );
    await rejects(
      pilot.recordPilotFeedback(
        sql,
        id,
        session.id,
        { ...feedback, timeSaved: "yes" },
        now + 16002,
      ),
      409,
    );
    await assert.rejects(
      pilot.recordPilotFeedback(sql, id, session.id, { ...feedback, accuracy: 1 }, now),
    );
    const rows = await sql<
      Record<string, unknown>
    >`select * from fitness_logging_sessions where user_id = ${id}`;
    assert.equal(rows.length, 1);
    const raw = JSON.stringify(rows);
    for (const forbidden of [
      logInput.note,
      '"squat"',
      '"answers"',
      '"probabilities"',
      '"inputTokens"',
      '"weight":40',
    ])
      assert.equal(raw.includes(forbidden), false);
    const exported = await fitness.exportFitness(sql, id, { limit: 1 });
    assert.equal(exported.pilotConsent.enabled, true);
    assert.equal(exported.records[0].kind, "pilot_outcome");
    assert.ok(exported.nextCursor);
    assert.equal(
      (await fitness.exportFitness(sql, id, { limit: 1, cursor: exported.nextCursor! })).records[0]
        .kind,
      "strength_log",
    );
  });
  it("recomputes one outcome on edits, including mixed sets, without treating missing weight as accepted", async () => {
    const id = await member();
    const { session, input } = await prepared(id);
    const log = await fitness.createStrengthLog(sql, id, input, now + 3000);
    const revised = {
      ...logInput,
      sets: [
        { reps: 8, weight: null, unit: "kg" as const },
        { reps: 9, weight: 40, unit: "kg" as const },
      ],
    };
    await fitness.updateStrengthLog(
      sql,
      id,
      log.id,
      { ...revised, expectedRevision: 1 },
      now + 4000,
    );
    const outcome = await pilot.getLoggingOutcome(sql, id, session.id, now + 5000);
    assert.equal(outcome.unchangedSuggestedFields, 2); // exercise and unit
    assert.equal(outcome.changedSuggestedFields, 3); // set count, mixed reps, mixed weight
    assert.equal(outcome.comparisonRevision, 2);
    assert.equal(
      (await sql`select id from fitness_logging_sessions where user_id = ${id}`).length,
      1,
    );
    await rejects(
      fitness.updateStrengthLog(sql, id, log.id, { ...logInput, expectedRevision: 1 }, now + 5000),
      409,
    );
    assert.equal(
      (await pilot.getLoggingOutcome(sql, id, session.id, now + 6000)).comparisonRevision,
      2,
    );
  });
  it("does not infer draft acceptance from an unlinked manual save or a separate AI request", async () => {
    const id = await member();
    const { session } = await prepared(id);
    await fitness.createStrengthLog(
      sql,
      id,
      { ...logInput, measurement: { sessionId: session.id } },
      now + 3000,
    );
    let outcome = await pilot.getLoggingOutcome(sql, id, session.id, now + 4000);
    assert.equal(outcome.mode, "unobserved_draft_use");
    assert.equal(outcome.unchangedSuggestedFields, null);
    const next = (await pilot.startLoggingSession(sql, id, {}, now + 6000))!;
    await fitness.draftExercise(sql, id, { note }, { provider: provider(), now: now + 7000 });
    await fitness.createStrengthLog(
      sql,
      id,
      { ...logInput, measurement: { sessionId: next.id } },
      now + 9000,
    );
    outcome = await pilot.getLoggingOutcome(sql, id, next.id, now + 10000);
    assert.equal(outcome.mode, "unobserved_draft_use");
    assert.equal(outcome.changedSuggestedFields, null);
    const manual = (await pilot.startLoggingSession(sql, id, {}, now + 12000))!;
    await fitness.createStrengthLog(
      sql,
      id,
      { ...logInput, measurement: { sessionId: manual.id } },
      now + 15000,
    );
    assert.equal(
      (await pilot.getLoggingOutcome(sql, id, manual.id, now + 16000)).mode,
      "no_linked_draft",
    );
  });
  it("saves stale receipts as unknown use and ignores late results after a save", async () => {
    const id = await member();
    const { session, draft } = await prepared(id);
    await fitness.draftExercise(
      sql,
      id,
      { note, loggingSessionId: session.id },
      { provider: provider(), now: now + 5000 },
    );
    await fitness.createStrengthLog(
      sql,
      id,
      { ...logInput, measurement: draft.measurement },
      now + 6000,
    );
    assert.equal(
      (await pilot.getLoggingOutcome(sql, id, session.id, now + 7000)).mode,
      "unobserved_draft_use",
    );
    assert.equal(
      (await pilot.getLoggingOutcome(sql, id, session.id, now + 7000)).unchangedSuggestedFields,
      null,
    );
    const other = await member();
    const open = (await pilot.startLoggingSession(sql, other, {}, now))!;
    const duringSave: FitnessProvider = async (state, questions) => {
      await fitness.createStrengthLog(
        sql,
        other,
        { ...logInput, measurement: { sessionId: open.id } },
        now + 2000,
      );
      return provider()(state, questions);
    };
    const late = await fitness.draftExercise(
      sql,
      other,
      { note, loggingSessionId: open.id },
      { provider: duringSave, now: now + 1000 },
    );
    assert.equal(late.measurement, undefined);
    assert.equal(
      (await pilot.getLoggingOutcome(sql, other, open.id, now + 3000)).mode,
      "unobserved_draft_use",
    );
  });
  it("records abstention and provider outage as missing fields, with no implied successful suggestions", async () => {
    for (const unavailable of [false, true]) {
      const id = await member();
      const session = (await pilot.startLoggingSession(sql, id, {}, now))!;
      const draft = await fitness.draftExercise(
        sql,
        id,
        { note, loggingSessionId: session.id },
        { provider: unavailable ? async () => null : provider(["log_scope"]), now: now + 1000 },
      );
      await fitness.createStrengthLog(
        sql,
        id,
        { ...logInput, measurement: draft.measurement },
        now + 2000,
      );
      const outcome = await pilot.getLoggingOutcome(sql, id, session.id, now + 3000);
      assert.equal(outcome.draftStatus, unavailable ? "provider_unavailable" : "insufficient_data");
      assert.equal(outcome.suggestedFields, 0);
      assert.equal(outcome.unchangedSuggestedFields, 0);
      assert.equal(outcome.filledMissingFields, 5);
    }
  });
});

describe("bounded storage and aggregate privacy", () => {
  it("does not block ordinary saves after expiry and limits open measurements", async () => {
    const id = await member();
    const session = (await pilot.startLoggingSession(sql, id, {}, now))!;
    await rejects(
      pilot.recordPilotFeedback(
        sql,
        id,
        session.id,
        { helpfulness: "unknown", timeSaved: "unsure" },
        now,
      ),
      409,
    );
    const log = await fitness.createStrengthLog(
      sql,
      id,
      { ...logInput, measurement: { sessionId: session.id } },
      now + 7200001,
    );
    assert.ok(log.id);
    const outcome = await pilot.getLoggingOutcome(sql, id, session.id, now + 7200001);
    assert.equal(outcome.status, "expired");
    assert.equal(outcome.elapsedMs, null);
    for (let i = 0; i < 19; i++) await pilot.startLoggingSession(sql, id, {}, now);
    await rejects(pilot.startLoggingSession(sql, id, {}, now), 429);
    assert.ok(await fitness.createStrengthLog(sql, id, logInput, now));
    await assert.rejects(
      fitness.createStrengthLog(
        sql,
        id,
        { ...logInput, measurement: { sessionId: session.id, unchangedSuggestedFields: 5 } },
        now,
      ),
    );
  });
  it("cascades from log/account deletion and prunes after 30 days", async () => {
    const id = await member();
    const { session, input } = await prepared(id);
    const log = await fitness.createStrengthLog(sql, id, input, now + 2000);
    await fitness.deleteStrengthLog(sql, id, log.id);
    await rejects(pilot.getLoggingOutcome(sql, id, session.id, now), 404);
    const next = (await pilot.startLoggingSession(sql, id, {}, now))!;
    await sql`delete from "user" where id = ${id}`;
    assert.equal(
      (await sql`select id from fitness_logging_sessions where id = ${next.id}`).length,
      0,
    );
    const old = await member();
    const expired = (await pilot.startLoggingSession(sql, old, {}, now))!;
    await pilot.pruneFitnessOutcomes(sql, now + 31 * 86400_000);
    assert.equal(
      (await sql`select id from fitness_logging_sessions where id = ${expired.id}`).length,
      0,
    );
  });
  it("suppresses cohorts below five distinct members and returns no ids, notes, or claimed measured time saved", async () => {
    const db = await makeDb();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await member(db);
      ids.push(id);
      const { session, input } = await prepared(id, [], now, db);
      await fitness.createStrengthLog(db, id, input, now + (i + 1) * 1000);
      await pilot.recordPilotFeedback(
        db,
        id,
        session.id,
        { helpfulness: "helpful", timeSaved: "yes" },
        now + 10000,
      );
      if (i < 4)
        assert.deepEqual((await pilot.fitnessPilotOverview(db, now + 10000)).summary, null);
    }
    const overview = await pilot.fitnessPilotOverview(db, now + 10000);
    assert.equal(overview.suppressed, false);
    assert.equal(overview.summary!.members, 5);
    assert.equal(overview.summary!.reportsTimeSaved, 5);
    assert.equal(overview.measuredTimeSavedMs, null);
    assert.deepEqual(overview.groups, [
      {
        mode: "linked_draft",
        members: 5,
        savedLogs: 5,
        suggestedFields: 25,
        unchangedSuggestedFields: 25,
        changedSuggestedFields: 0,
        filledMissingFields: 0,
        medianElapsedMs: 3000,
        p95ElapsedMs: 4800,
      },
    ]);
    for (const forbidden of [...ids, logInput.note, '"squat"', "field_hashes", "model"])
      assert.equal(JSON.stringify(overview).includes(forbidden), false);
    const smallGroup = await member(db);
    const session = (await pilot.startLoggingSession(db, smallGroup, {}, now))!;
    await fitness.createStrengthLog(
      db,
      smallGroup,
      { ...logInput, measurement: { sessionId: session.id } },
      now + 1000,
    );
    assert.equal((await pilot.fitnessPilotOverview(db, now + 10000)).groups.length, 1);
    await pilot.setPilotConsent(db, ids[0], { enabled: false }, now + 11000);
    assert.equal((await pilot.fitnessPilotOverview(db, now + 12000)).groups.length, 0);
  });
});
