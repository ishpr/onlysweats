import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as health from "../health/service.server.ts";
import type { WorkoutRecord, HealthConnection, HealthRecord } from "../../../shared/health.ts";
import type { StrengthLogInput } from "../../../shared/fitness.ts";
import * as fitness from "./service.server.ts";
import { FitnessError, strengthLogInput } from "./contracts.ts";
import { draftFromAnswers, exerciseQuestions, numericCandidates, FITNESS_MODEL, type FitnessQuestions } from "./questions.ts";
import { createTypeSafeProvider, inferenceAvailable, validateProviderResponse, type FitnessProvider } from "./typesafe.server.ts";
import { evaluateExerciseFixtures } from "./evaluation.ts";
import { evaluateWorkoutFixtures } from "./workout-evaluation.ts";

let sql: Sql;
const now = Date.parse("2026-09-21T12:00:00.000Z");
const source = { bundleId: "synthetic.recorder", name: "Synthetic test only" };
const logInput: StrengthLogInput = { startedAt: "2026-09-20T10:00:00.000Z", exerciseId: "bench_press", note: "Synthetic manual fixture", sets: [{ reps: 8, weight: 135, unit: "lb" }, { reps: 8, weight: 60, unit: "kg" }] };
const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (error: unknown) => error instanceof FitnessError && error.status === status);
function answer(questions: FitnessQuestions, selections: Record<string, string>, confidence = 0.98) {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    const choice = selections[id] ?? (id === "log_scope" ? "single_exercise" : "not_stated");
    const options = Object.keys(question.criteria);
    return [id, { type: "choice" as const, choice, confidence,
      probabilities: Object.fromEntries(options.map((option) => [option, option === choice ? 1 : 0])) }];
  }));
}
function provider(selections: Record<string, string>, observe?: (state: object) => void): FitnessProvider {
  return async (state, questions) => { observe?.(state); return { model: FITNESS_MODEL, answers: answer(questions, selections), usage: { inputTokens: 123, outputTokens: 45 }, latencyMs: 7 }; };
}
async function member(withWorkout = false) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Fitness fixture', ${`${id}@example.test`}, true)`;
  let connection: HealthConnection | undefined;
  const record: WorkoutRecord = { externalId: randomUUID(), type: "workout", source, startAt: "2026-09-20T10:00:00.000Z", endAt: "2026-09-20T11:00:00.000Z", activity: "run", durationSeconds: 3000, distanceMeters: 5000, activeEnergyKilocalories: null };
  if (withWorkout) {
    connection = await health.connect(sql, id, { deviceId: randomUUID(), types: ["workout", "heart_rate"] }, now);
    connection = await importRecord(id, connection, record);
  }
  return { id, record, connection };
}
async function importRecord(id: string, connection: HealthConnection, record: HealthRecord, time = now) {
  return health.sync(sql, id, { deviceId: connection.deviceId, generation: connection.generation, type: record.type,
    expectedSequence: connection.cursors[record.type]?.sequence ?? 0, records: [record], deletedIds: [], anchor: `fixture-${randomUUID()}`, hasMore: false }, time);
}
before(async () => { sql = await makeDb(); });

describe("private member strength logs and source corrections", () => {
  it("records only explicit manual values, calculates external load in code, and keeps unknown bodyweight volume null", async () => {
    const { id } = await member();
    const log = await fitness.createStrengthLog(sql, id, logInput, now);
    assert.equal(log.revision, 1);
    assert.equal(log.totalRepetitions, 16);
    assert.equal(log.totalVolumeKg, 969.88);
    const bodyweight = await fitness.createStrengthLog(sql, id, { ...logInput, exerciseId: "push_up", sets: [{ reps: 10, weight: null, unit: "bodyweight" }] }, now);
    assert.equal(bodyweight.totalVolumeKg, null);
    assert.equal(bodyweight.totalRepetitions, 10);
    const unknownLoad = await fitness.createStrengthLog(sql, id, { ...logInput, sets: [{ reps: 8, weight: null, unit: "kg" }] }, now);
    assert.equal(unknownLoad.totalVolumeKg, null);
    assert.equal(unknownLoad.sets[0].weight, null);
    assert.equal((await fitness.getConsent(sql, id)).enabled, false);
  });
  it("enforces owner isolation and optimistic revisions for manual editing", async () => {
    const a = await member(); const b = await member();
    const log = await fitness.createStrengthLog(sql, a.id, logInput, now);
    await rejects(fitness.updateStrengthLog(sql, b.id, log.id, { ...logInput, expectedRevision: 1 }, now), 404);
    await rejects(fitness.deleteStrengthLog(sql, b.id, log.id), 404);
    assert.deepEqual((await fitness.listStrengthLogs(sql, b.id, { limit: 50 })).logs, []);
    const changed = await fitness.updateStrengthLog(sql, a.id, log.id, { ...logInput, note: "Corrected by member", expectedRevision: 1 }, now);
    assert.equal(changed.revision, 2);
    await rejects(fitness.updateStrengthLog(sql, a.id, log.id, { ...logInput, expectedRevision: 1 }, now), 409);
    await fitness.deleteStrengthLog(sql, a.id, log.id);
    assert.deepEqual((await fitness.listStrengthLogs(sql, a.id, { limit: 50 })).logs, []);
  });
  it("validates finite values, units, ranges, fields, time and unnamed exercise", async () => {
    const { id } = await member();
    for (const patch of [{ sets: [{ reps: 0, weight: 10, unit: "kg" }] }, { sets: [{ reps: 8, weight: Infinity, unit: "kg" }] },
      { sets: [{ reps: 8, weight: 10, unit: "bodyweight" }] },
      { sets: [] }, { exerciseId: "other", note: "" }, { inventedCalories: 400 }]) assert.equal(strengthLogInput.safeParse({ ...logInput, ...patch }).success, false);
    await rejects(fitness.createStrengthLog(sql, id, { ...logInput, startedAt: "2026-09-22T12:00:00.000Z" }, now), 400);
    await rejects(fitness.createStrengthLog(sql, randomUUID(), logInput, now), 401);
  });
  it("keeps member corrections across import revisions without altering measurements", async () => {
    const { id, record, connection } = await member(true);
    const correction = await fitness.saveCorrection(sql, id, record.externalId, { expectedRevision: 0, title: "Evening walk", note: "I chose a walk", activity: "walk" }, now);
    await importRecord(id, connection!, { ...record, durationSeconds: 2500 }, now + 1000);
    assert.deepEqual(await fitness.getCorrection(sql, id, record.externalId), correction);
    const imported = await health.getWorkout(sql, id, record.externalId);
    assert.equal(imported.record.activity, "run");
    assert.equal(imported.record.durationSeconds, 2500);
    assert.equal(imported.revision, 2);
    await rejects(fitness.saveCorrection(sql, id, record.externalId, { expectedRevision: 0, title: null, note: null, activity: null }, now), 409);
    const other = await member();
    await rejects(fitness.getCorrection(sql, other.id, record.externalId), 404);
    await rejects(fitness.saveCorrection(sql, other.id, record.externalId, { expectedRevision: 0, title: null, note: null, activity: null }, now), 404);
  });
  it("purges overlays on source tombstones and disconnect while retaining independent manual logs", async () => {
    for (const removal of ["source", "member", "disconnect"] as const) {
      const { id, record, connection } = await member(true);
      await fitness.createStrengthLog(sql, id, logInput, now);
      await fitness.saveCorrection(sql, id, record.externalId, { expectedRevision: 0, title: "Mine", note: "Private correction", activity: null }, now);
      if (removal === "source") await health.sync(sql, id, { deviceId: connection!.deviceId, generation: connection!.generation, type: "workout", expectedSequence: 1, records: [], deletedIds: [record.externalId], anchor: "deleted", hasMore: false }, now);
      else if (removal === "member") await health.deleteWorkout(sql, id, record.externalId);
      else await health.disconnect(sql, id);
      assert.equal((await sql`select * from fitness_workout_corrections where user_id = ${id}`).length, 0);
      assert.equal((await fitness.listStrengthLogs(sql, id, { limit: 50 })).logs.length, 1);
    }
  });
  it("paginates owner exports across logs and overlays and rejects cross-kind cursors", async () => {
    const { id, record } = await member(true);
    const other = await member();
    await fitness.createStrengthLog(sql, id, logInput, now);
    await fitness.createStrengthLog(sql, id, logInput, now);
    await fitness.saveCorrection(sql, id, record.externalId, { expectedRevision: 0, title: "Private", note: null, activity: null }, now);
    const first = await fitness.exportFitness(sql, id, { limit: 2 });
    assert.equal(first.records.length, 2); assert.ok(first.nextCursor);
    const second = await fitness.exportFitness(sql, id, { limit: 2, cursor: first.nextCursor! });
    assert.equal(second.records.length, 1); assert.equal(second.nextCursor, null);
    assert.equal(second.records[0].kind, "workout_correction");
    assert.deepEqual((await fitness.exportFitness(sql, other.id, { limit: 100 })).records, []);
    await rejects(fitness.listStrengthLogs(sql, id, { limit: 2, cursor: first.nextCursor! }), 400);
    await assert.rejects(fitness.exportFitness(sql, id, { limit: 101 }), z.ZodError);
  });
  it("cascades every private fitness table on account deletion", async () => {
    const { id, record } = await member(true);
    await fitness.createStrengthLog(sql, id, logInput, now);
    await fitness.saveCorrection(sql, id, record.externalId, { expectedRevision: 0, title: null, note: "Private", activity: null }, now);
    await fitness.setConsent(sql, id, { enabled: true }, now);
    await fitness.assessWorkout(sql, id, record.externalId, { goal: "Easy run", note: "I followed my planned easy run." }, { now, provider: provider({ interpretation: "goal_aligned" }) });
    await sql`delete from "user" where id = ${id}`;
    for (const table of ["fitness_consents", "fitness_strength_logs", "fitness_workout_corrections", "fitness_workout_assessments"]) assert.equal((await sql.query(`select * from ${table} where user_id = $1`, [id])).length, 0);
  });
});

describe("separate AI consent, bounded drafts and freshness", () => {
  const note = "Bench press 3 sets of 8 at 135 lb";
  it("requires separate consent and never calls inference from a manual save", async () => {
    const { id } = await member(); let calls = 0;
    const mocked: FitnessProvider = async () => { calls++; return null; };
    await rejects(fitness.draftExercise(sql, id, { note }, { now, provider: mocked }), 403);
    await fitness.createStrengthLog(sql, id, logInput, now);
    assert.equal(calls, 0);
    const first = await fitness.setConsent(sql, id, { enabled: true }, now);
    assert.deepEqual(await fitness.setConsent(sql, id, { enabled: true }, now + 1000), first);
    const disabled = await fitness.setConsent(sql, id, { enabled: false }, now + 2000);
    assert.notEqual(first.generation, disabled.generation);
  });
  it("selects only source values into an editable draft and exposes provenance without saving", async () => {
    const { id } = await member(); await fitness.setConsent(sql, id, { enabled: true }, now);
    let sent: object | undefined;
    const draft = await fitness.draftExercise(sql, id, { note }, { now, provider: provider({ exercise: "bench_press", sets: "n0", reps: "n1", weight: "n2", unit: "lb" }, (state) => { sent = state; }) });
    assert.equal(draft.status, "available"); assert.equal(draft.sets, 3); assert.equal(draft.reps, 8); assert.equal(draft.weight, 135);
    assert.deepEqual(draft.missingFields, []); assert.equal(draft.metadata?.model, FITNESS_MODEL);
    assert.equal(draft.metadata?.usage.inputTokens, 123); assert.equal(draft.metadata?.questionVersion, "exercise-draft-v2");
    assert.deepEqual(Object.keys(sent!).sort(), ["candidates", "note"]);
    assert.equal(JSON.stringify(sent).includes(id), false);
    assert.deepEqual((await fitness.listStrengthLogs(sql, id, { limit: 50 })).logs, []);
  });
  it("does not invent a missing unit or numeric field and abstains for low confidence", () => {
    const candidates = numericCandidates("Three sets of 8 bench at 135");
    assert.deepEqual(candidates.map((c) => c.value), [3, 8, 135]);
    const questions = exerciseQuestions(candidates, []);
    const answers = answer(questions, { exercise: "bench_press", sets: "n0", reps: "n1", weight: "n2" });
    const draft = draftFromAnswers(answers, candidates, []);
    assert.equal(draft.weight, null); assert.equal(draft.unit, null);
    const uncertain = draftFromAnswers(answer(questions, { exercise: "bench_press", sets: "n0", reps: "n1" }, 0.4), candidates, []);
    assert.equal(uncertain.exerciseId, null); assert.equal(uncertain.sets, null);
    assert.equal(uncertain.status, "insufficient_data");
    assert.deepEqual(numericCandidates("3x8 at 12.5 kg").map((c) => c.value), [3, 8, 12.5]);
    assert.deepEqual(numericCandidates("three sets of eight at one hundred thirty five pounds").map((c) => c.value), [3, 8, 135]);
    const reused = draftFromAnswers(answer(questions, { sets: "n0", reps: "n0" }), candidates, []);
    assert.equal(reused.sets, null); assert.equal(reused.reps, null);
  });
  it("abstains from the whole draft for multiple exercises, instructions or uncertain log eligibility", () => {
    const candidates = numericCandidates(note);
    const questions = exerciseQuestions(candidates, ["lb"]);
    for (const logScope of ["multiple_exercises", "not_a_log", "not_stated"]) {
      const draft = draftFromAnswers(answer(questions, { log_scope: logScope, exercise: "bench_press", sets: "n0", reps: "n1", weight: "n2", unit: "lb" }), candidates, ["lb"]);
      assert.equal(draft.status, "insufficient_data");
      assert.equal(draft.exerciseId, null); assert.equal(draft.sets, null); assert.equal(draft.unit, null);
    }
    const uncertain = answer(questions, { exercise: "bench_press", sets: "n0", reps: "n1", weight: "n2", unit: "lb" });
    uncertain.log_scope.confidence = 0.5;
    assert.equal(draftFromAnswers(uncertain, candidates, ["lb"]).status, "insufficient_data");
  });
  it("keeps manual fallback for unavailable providers and excessive candidates", async () => {
    const { id } = await member(); await fitness.setConsent(sql, id, { enabled: true }, now);
    const failed = await fitness.draftExercise(sql, id, { note }, { now, provider: async () => null });
    assert.equal(failed.status, "provider_unavailable"); assert.equal(failed.metadata, null);
    let called = false;
    const tooMany = await fitness.draftExercise(sql, id, { note: Array.from({ length: 33 }, (_, i) => i + 1).join(" ") }, { now: now + 5000, provider: async () => { called = true; return null; } });
    assert.equal(tooMany.status, "insufficient_data"); assert.equal(called, false);
    await fitness.createStrengthLog(sql, id, logInput, now);
  });
  it("invalidates drafts if permission is revoked while the provider runs", async () => {
    const { id } = await member(); await fitness.setConsent(sql, id, { enabled: true }, now);
    const mocked: FitnessProvider = async (state, questions) => {
      await fitness.setConsent(sql, id, { enabled: false }, now + 100);
      return provider({ exercise: "bench_press" })(state, questions);
    };
    await rejects(fitness.draftExercise(sql, id, { note }, { now, provider: mocked }), 403);
  });
  it("rate limits consecutive and daily requests without blocking manual logging", async () => {
    const { id } = await member(); await fitness.setConsent(sql, id, { enabled: true }, now);
    await fitness.draftExercise(sql, id, { note }, { now, provider: async () => null });
    await rejects(fitness.draftExercise(sql, id, { note }, { now: now + 100, provider: async () => null }), 429);
    await sql`update fitness_consents set request_count = 60 where user_id = ${id}`;
    await rejects(fitness.draftExercise(sql, id, { note }, { now: now + 5000, provider: async () => null }), 429);
    assert.ok(await fitness.createStrengthLog(sql, id, logInput, now));
  });
  it("requires owner, a useful note and fresh sync before interpreting intent, without sending vital signs", async () => {
    const { id, record } = await member(true); await fitness.setConsent(sql, id, { enabled: true }, now);
    const other = await member(); await fitness.setConsent(sql, other.id, { enabled: true }, now);
    let calls = 0; let sent: object | undefined;
    const mocked = provider({ interpretation: "intentional_change" }, (state) => { calls++; sent = state; });
    await rejects(fitness.assessWorkout(sql, other.id, record.externalId, { goal: "Run", note: "I changed the plan." }, { now, provider: mocked }), 404);
    const missing = await fitness.assessWorkout(sql, id, record.externalId, { goal: "Run", note: "" }, { now, provider: mocked });
    assert.equal(missing.status, "insufficient_data"); assert.equal(calls, 0);
    const stale = await fitness.assessWorkout(sql, id, record.externalId, { goal: "Run", note: "Changed the plan for a meeting." }, { now: now + 8 * 86_400_000, provider: mocked });
    assert.equal(stale.status, "insufficient_data"); assert.equal(calls, 0);
    const result = await fitness.assessWorkout(sql, id, record.externalId, { goal: "Run", note: "Changed the plan for a meeting." }, { now, provider: mocked });
    assert.equal(result.interpretation, "intentional_change"); assert.equal(result.status, "available");
    assert.deepEqual(Object.keys(sent!).sort(), ["goal", "note", "workout"]);
    assert.equal(/heart|sleep|source|externalId|deviceId|userId/.test(JSON.stringify(sent).replace("sourceActivity", "activity")), false);
    const saved = await fitness.getWorkoutAssessment(sql, id, record.externalId);
    assert.equal(saved?.snapshotRevision, result.snapshotRevision);
    assert.equal(saved?.request?.goal, "Run");
    const exported = (await fitness.exportFitness(sql, id, { limit: 100 })).records[0];
    assert.equal(exported.kind, "workout_assessment");
    assert.ok(exported.kind === "workout_assessment" && exported.value.request.note === "Changed the plan for a meeting.");
    await fitness.setConsent(sql, id, { enabled: false }, now + 5000);
    assert.equal((await sql`select * from fitness_workout_assessments where user_id = ${id}`).length, 0);
  });
  it("rejects an in-flight interpretation when late samples arrive and discards saved stale snapshots", async () => {
    const { id, record, connection } = await member(true); await fitness.setConsent(sql, id, { enabled: true }, now);
    const heart: HealthRecord = { type: "heart_rate", externalId: randomUUID(), source, startAt: "2026-09-20T10:30:00.000Z", endAt: "2026-09-20T10:30:00.000Z", value: 140, unit: "bpm" };
    const mocked: FitnessProvider = async (state, questions) => {
      await importRecord(id, connection!, heart, now + 100);
      return provider({ interpretation: "goal_aligned" })(state, questions);
    };
    await rejects(fitness.assessWorkout(sql, id, record.externalId, { goal: "Easy run", note: "I stuck with the planned easy run." }, { now, provider: mocked }), 409);
    const result = await fitness.assessWorkout(sql, id, record.externalId, { goal: "Easy run", note: "I stuck with the planned easy run." }, { now: now + 5000, provider: provider({ interpretation: "goal_aligned" }) });
    assert.equal(result.status, "available");
    await fitness.saveCorrection(sql, id, record.externalId, { expectedRevision: 0, title: null, note: "Correction", activity: null }, now + 6000);
    assert.equal(await fitness.getWorkoutAssessment(sql, id, record.externalId), null);
  });
});

describe("bounded TypeSafe HTTP adapter and evaluation harness", () => {
  const questions = exerciseQuestions(numericCandidates("Bench 3x8 at 135 lb"), ["lb"]);
  const rawResponse = () => ({ model: FITNESS_MODEL, answers: answer(questions, { exercise: "bench_press", sets: "n0", reps: "n1", weight: "n2", unit: "lb" }), usage: { input_tokens: 50, output_tokens: 10 } });
  it("requires exact answer ids, selected options, full normalized distributions and pinned model", () => {
    assert.equal(validateProviderResponse(rawResponse(), questions).model, FITNESS_MODEL);
    for (const invalid of [
      { ...rawResponse(), model: "jev-latest" }, { ...rawResponse(), extra: "private" },
      { ...rawResponse(), answers: {} }, { ...rawResponse(), usage: { input_tokens: -1, output_tokens: 1 } },
    ]) assert.throws(() => validateProviderResponse(invalid, questions));
    const unknown = rawResponse(); unknown.answers.sets.choice = "invented";
    assert.throws(() => validateProviderResponse(unknown, questions));
    const distribution = rawResponse(); distribution.answers.sets.probabilities.n1 = 0.9;
    assert.throws(() => validateProviderResponse(distribution, questions));
  });
  it("uses only the fixed endpoint, emits bounded metrics, and falls back on HTTP or schema failure", async () => {
    const metrics: object[] = [];
    const mocked = createTypeSafeProvider({ apiKey: "synthetic-test-key", onMetric: (metric) => { metrics.push(metric); }, fetch: async (url, init) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone"); assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, FITNESS_MODEL);
      return Response.json(rawResponse());
    } });
    assert.equal((await mocked({ note: "synthetic private note" }, questions))?.usage.inputTokens, 50);
    assert.equal(JSON.stringify(metrics).includes("private"), false);
    for (const fetcher of [async () => new Response("do not log this body", { status: 429 }), async () => Response.json({ bad: "private" }), async () => { throw new Error("private transport message"); }, async () => new Response("x".repeat(64_001))]) {
      assert.equal(await createTypeSafeProvider({ apiKey: "synthetic", fetch: fetcher })({ note: "private" }, questions), null);
    }
  });
  it("bounds latency even for an uncooperative transport and never retries", async () => {
    let calls = 0; let signal: AbortSignal | undefined;
    const mocked = createTypeSafeProvider({ apiKey: "synthetic", timeoutMs: 10, fetch: async (_url, init) => {
      calls++; signal = init?.signal ?? undefined; return new Promise<Response>(() => undefined);
    } });
    const started = performance.now();
    assert.equal(await mocked({ note: "synthetic" }, questions), null);
    assert.ok(performance.now() - started < 500); assert.equal(signal?.aborted, true); assert.equal(calls, 1);
  });
  it("fails closed for an oversized request before contacting the provider", async () => {
    let called = false;
    assert.equal(await createTypeSafeProvider({ apiKey: "synthetic", fetch: async () => { called = true; return Response.json(rawResponse()); } })({ note: "x".repeat(24_001) }, questions), null);
    assert.equal(called, false);
  });
  it("requires exact deployment flag and key; fixtures report evaluation results only when a provider actually replies", async () => {
    const prior = { enabled: process.env.JEV_ENABLED, key: process.env.TYPESAFE_API_KEY };
    try {
      process.env.TYPESAFE_API_KEY = "synthetic-test-key";
      for (const flag of ["false", "TRUE", "1", ""]) { process.env.JEV_ENABLED = flag; assert.equal(inferenceAvailable(), false); }
      process.env.JEV_ENABLED = "true"; assert.equal(inferenceAvailable(), true);
      delete process.env.TYPESAFE_API_KEY; assert.equal(inferenceAvailable(), false);
    } finally {
      if (prior.enabled === undefined) delete process.env.JEV_ENABLED; else process.env.JEV_ENABLED = prior.enabled;
      if (prior.key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = prior.key;
    }
    const report = await evaluateExerciseFixtures(async () => null);
    assert.ok(report.cases.length >= 8);
    assert.equal(report.cases.every((entry) => entry.correctFields === null && !entry.providerAvailable), true);
    const notes = await evaluateWorkoutFixtures(async () => null);
    assert.equal(notes.cases.length, 9);
    assert.equal(notes.cases.every((entry) => entry.actual === null && !entry.correct), true);
  });
});
