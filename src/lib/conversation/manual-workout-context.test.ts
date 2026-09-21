import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import type { ChatEvent, ChatSettings } from "../../../shared/conversation.ts";
import {
  CHAT_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
} from "../../../shared/conversation.ts";
import { makeDb } from "../pace/test-db.ts";
import { fixtureMember, fixturePlan } from "../workout-plans/fixtures.ts";
import * as plans from "../workout-plans/service.server.ts";
import * as fitness from "../fitness/service.server.ts";
import { deleteAccount } from "../pace/safety.server.ts";
import {
  getHistory,
  setSettings,
  chatResponse,
  ChatError,
  clearHistory,
} from "./service.server.ts";
import {
  MAX_MANUAL_CONTEXT_BYTES,
  readManualWorkoutContext,
} from "./manual-workout-context.server.ts";
import type { ChatProvider } from "./provider.server.ts";

let sql: Sql;
const now = Date.now();
const settingsBody = (manual = true, health = false) => ({
  cloudEnabled: true,
  fitnessContextEnabled: health,
  noticeVersion: CHAT_NOTICE_VERSION,
  manualWorkoutContextEnabled: manual,
  manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
});
before(async () => {
  sql = await makeDb();
});
async function member(enabled = true) {
  const id = await fixtureMember(sql);
  const { settings } = await setSettings(sql, id, settingsBody(enabled), now);
  return { id, settings };
}
export const turn = (settings: ChatSettings) => ({
  requestId: randomUUID(),
  text: "Review my entered results against my routine.",
  consentGeneration: settings.consentGeneration,
  historyGeneration: settings.historyGeneration,
});
async function events(response: Response): Promise<ChatEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
async function reply(id: string, settings: ChatSettings, provider: ChatProvider) {
  return events(
    await chatResponse(sql, id, turn(settings), new AbortController().signal, {
      available: true,
      provider,
      now: () => now + 100,
    }),
  );
}
const enteredLog = () => ({
  startedAt: new Date(now - 2000).toISOString(),
  exerciseId: "squat",
  note: "Private entered note",
  sets: [{ reps: 5, weight: null, unit: "kg" }],
});
async function records(id: string) {
  const input = fixturePlan();
  input.title = "Private saved intervals";
  const plan = await plans.createPlan(sql, id, input, now - 1000);
  const run = await plans.startRun(
    sql,
    id,
    { id: randomUUID(), planId: plan.id, expectedPlanRevision: plan.revision },
    now - 1000,
  );
  const actual = (index: number) => ({
    exerciseId: input.exercises[0].id,
    setId: input.exercises[0].sets[index].id,
    status: "completed" as const,
    reps: null,
    durationSeconds: 40,
    distanceMeters: null,
    weight: null,
    unit: "bodyweight" as const,
  });
  const result = await plans.updateRun(
    sql,
    id,
    run.id,
    {
      expectedRevision: 1,
      results: [actual(0), { ...actual(1), status: "skipped", durationSeconds: null }],
      note: "Member chose a shorter interval",
      shareAccountability: false,
      finish: true,
    },
    now,
  );
  const log = await fitness.createStrengthLog(sql, id, enteredLog(), now);
  return { plan, input, run: result, log, actual };
}
const usedAnswer: ChatProvider = async ({ tools, onText }) => {
  const context = (await tools.manualWorkouts!()) as { available: boolean };
  assert.equal(context.available, true);
  await onText("Your member-entered results are separate from your plan.");
};

describe("separately consented manual workout coaching", () => {
  it("requires the new notice and cloud permission; older settings never grant manual access", async () => {
    const { id } = await member(false);
    const old = {
      cloudEnabled: true,
      fitnessContextEnabled: true,
      noticeVersion: CHAT_NOTICE_VERSION,
    };
    let settings = (await setSettings(sql, id, old)).settings;
    assert.equal(settings.manualWorkoutContextEnabled, false);
    for (const body of [
      { ...old, manualWorkoutContextEnabled: true },
      { ...settingsBody(), cloudEnabled: false },
      { ...settingsBody(), manualWorkoutContextNoticeVersion: "unknown" },
    ])
      await assert.rejects(setSettings(sql, id, body), z.ZodError);
    await records(id);
    const rejected = await reply(id, settings, async ({ tools, onText }) => {
      assert.equal(((await tools.manualWorkouts!()) as { available: boolean }).available, false);
      await onText("Manual history permission is off.");
    });
    assert.equal(rejected.at(-1)?.type, "done");
    settings = (await setSettings(sql, id, settingsBody())).settings;
    assert.equal(settings.fitnessContextEnabled, false);
    assert.equal(settings.manualWorkoutContextEnabled, true);
    const separate = await reply(id, settings, async ({ tools, onText }) => {
      assert.equal(((await tools.workouts()) as { available: boolean }).available, false);
      await tools.manualWorkouts!();
      await onText("Manual history only.");
    });
    assert.equal(separate.at(-1)?.type, "done");
    const revoked = (await setSettings(sql, id, old)).settings;
    assert.equal(revoked.manualWorkoutContextEnabled, false);
    assert.equal((await getHistory(sql, id)).messages.length, 0);
    assert.notEqual(revoked.consentGeneration, settings.consentGeneration);
  });

  it("provides only owner records, preserving prescription, actual, skipped, unrecorded and unknown values", async () => {
    const a = await member(),
      b = await member();
    const own = await records(a.id),
      other = await records(b.id);
    const outcome = await reply(a.id, a.settings, async ({ tools, onText }) => {
      const value = (await tools.manualWorkouts!()) as Awaited<
        ReturnType<typeof readManualWorkoutContext>
      >["context"];
      assert.equal(value.savedPlans.length, 1);
      assert.equal(value.savedPlans[0].source, "saved_prescription_not_performed");
      const run = value.workoutRecords[0];
      assert.equal(run.recordStatus, "completed");
      assert.equal(run.plannedSets, 3);
      assert.equal(run.completedSets, 1);
      assert.equal(run.skippedSets, 1);
      assert.equal(run.unrecordedSets, 1);
      assert.equal(run.exercises[0].sets[0].target.durationSeconds, 60);
      assert.equal(run.exercises[0].sets[0].actual.durationSeconds, 40);
      assert.equal(run.exercises[0].sets[1].actual.status, "skipped");
      assert.deepEqual(run.exercises[0].sets[2].actual, { status: "unrecorded" });
      assert.equal(value.exerciseLogs[0].actualSets[0].externalLoad.weight, null);
      for (const hidden of [
        a.id,
        b.id,
        own.plan.id,
        own.run.id,
        own.log.id,
        other.plan.id,
        other.run.id,
      ])
        assert.ok(!JSON.stringify(value).includes(hidden));
      await onText(
        "One entered interval is shorter than its target; one was skipped and one has no result.",
      );
    });
    assert.equal(outcome.at(-1)?.type, "done");
    assert.equal((await getHistory(sql, b.id)).messages.length, 0);
  });

  it("caps counts and UTF-8 bytes, marking omitted exercises, sets, instructions and records", async () => {
    const { id } = await member();
    for (let index = 0; index < 5; index++) {
      const input = fixturePlan();
      input.instructions = "界".repeat(1000);
      input.exercises = Array.from({ length: 12 }, () => ({
        id: randomUUID(),
        name: "界".repeat(80),
        instructions: "界".repeat(800),
        sets: Array.from({ length: 10 }, () => ({
          ...input.exercises[0].sets[0],
          id: randomUUID(),
        })),
      }));
      await plans.createPlan(sql, id, input, now - index);
    }
    for (let index = 0; index < 8; index++)
      await fitness.createStrengthLog(
        sql,
        id,
        {
          ...enteredLog(),
          note: "界".repeat(500),
          sets: Array.from({ length: 20 }, () => ({ reps: 8, weight: null, unit: "kg" })),
        },
        now,
      );
    const snapshot = await sql.transaction((tx) => readManualWorkoutContext(tx, id, now + 100));
    assert.equal(snapshot.revisionSnapshot.plans.length, 3);
    assert.equal(snapshot.revisionSnapshot.logs.length, 5);
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot.context)) <= MAX_MANUAL_CONTEXT_BYTES);
    assert.ok(snapshot.context.omittedForSize.savedPlans > 0);
    for (const plan of snapshot.context.savedPlans) {
      assert.equal(plan.omittedExercises, 6);
      assert.equal(plan.instructionsShortened, true);
      assert.equal(plan.exercises[0].omittedSets, 4);
      assert.equal(plan.exercises[0].instructionsShortened, true);
    }
    for (const log of snapshot.context.exerciseLogs) {
      assert.equal(log.omittedSets, 14);
      assert.equal(log.noteShortened, true);
    }
  });

  for (const mutation of [
    "plan-create",
    "plan-update",
    "plan-delete",
    "run-start",
    "run-update",
    "run-delete",
    "log-create",
    "log-update",
    "log-delete",
  ] as const) {
    it(`clears used conversation and fences in-flight replies after ${mutation}`, async () => {
      const { id, settings } = await member();
      const r = await records(id);
      assert.equal((await reply(id, settings, usedAnswer)).at(-1)?.type, "done");
      const answer = await reply(id, settings, async ({ tools, onText }) => {
        await tools.manualWorkouts!();
        await onText("Preliminary reply");
        if (mutation === "plan-create") await plans.createPlan(sql, id, fixturePlan(), now);
        if (mutation === "plan-update") {
          const { id: _id, ...data } = r.input;
          await plans.updatePlan(
            sql,
            id,
            r.plan.id,
            { ...data, title: "Corrected title", expectedRevision: 1 },
            now,
          );
        }
        if (mutation === "plan-delete") await plans.deletePlan(sql, id, r.plan.id);
        if (mutation === "run-start")
          await plans.startRun(
            sql,
            id,
            { id: randomUUID(), planId: r.plan.id, expectedPlanRevision: 1 },
            now,
          );
        if (mutation === "run-update")
          await plans.updateRun(
            sql,
            id,
            r.run.id,
            {
              expectedRevision: r.run.revision,
              results: [r.actual(0)],
              note: "Corrected",
              shareAccountability: false,
              finish: true,
            },
            now,
          );
        if (mutation === "run-delete") await plans.deleteRun(sql, id, r.run.id);
        if (mutation === "log-create") await fitness.createStrengthLog(sql, id, enteredLog(), now);
        if (mutation === "log-update")
          await fitness.updateStrengthLog(
            sql,
            id,
            r.log.id,
            { ...enteredLog(), expectedRevision: 1, note: "Corrected" },
            now,
          );
        if (mutation === "log-delete") await fitness.deleteStrengthLog(sql, id, r.log.id);
      });
      assert.equal(answer.at(-1)?.type, "error");
      const history = await getHistory(sql, id);
      assert.equal(history.messages.length, 0);
      assert.notEqual(history.settings.historyGeneration, settings.historyGeneration);
      const [row] =
        await sql`select manual_workout_context_used, fitness_context_used, active_attempt_id from assistant_chat_settings where user_id=${id}`;
      assert.equal(row.manual_workout_context_used, false);
      assert.equal(row.fitness_context_used, false);
      assert.equal(row.active_attempt_id, null);
    });
  }

  it("preserves chat that never read manual records and does not invalidate another owner's chat", async () => {
    const a = await member(),
      b = await member();
    const aRecords = await records(a.id),
      bRecords = await records(b.id);
    await reply(a.id, a.settings, async ({ onText }) => {
      await onText("General planning only.");
    });
    await reply(b.id, b.settings, usedAnswer);
    await fitness.deleteStrengthLog(sql, a.id, aRecords.log.id);
    assert.equal((await getHistory(sql, a.id)).messages.length, 2);
    assert.equal((await getHistory(sql, b.id)).messages.length, 2);
    await plans.deleteRun(sql, b.id, bRecords.run.id);
    assert.equal((await getHistory(sql, b.id)).messages.length, 0);
    assert.equal((await getHistory(sql, a.id)).messages.length, 2);
  });

  it("clears derived history for a changed record outside the recent shortlist, but not an identical retry", async () => {
    const { id, settings } = await member();
    const saved = await records(id);
    for (let index = 0; index < 6; index++)
      await fitness.createStrengthLog(
        sql,
        id,
        { ...enteredLog(), startedAt: new Date(now - 1000 + index).toISOString() },
        now,
      );
    const initial = await reply(id, settings, usedAnswer);
    assert.equal(initial.at(-1)?.type, "done");
    await plans.createPlan(sql, id, saved.input, now);
    assert.equal(
      (await getHistory(sql, id)).messages.length,
      2,
      "Identical plan-create replay changes no record.",
    );
    const selected = await readManualWorkoutContext(sql, id, now + 100);
    assert.equal(
      selected.revisionSnapshot.logs.some((log) => log.id === saved.log.id),
      false,
    );
    await fitness.deleteStrengthLog(sql, id, saved.log.id);
    assert.equal((await getHistory(sql, id)).messages.length, 0);
  });

  it("fences revocation, clearing history and account deletion", async () => {
    for (const action of ["revoke", "clear", "delete-account"] as const) {
      const { id, settings } = await member();
      await records(id);
      const outcome = await reply(id, settings, async ({ tools, onText }) => {
        await tools.manualWorkouts!();
        if (action === "revoke") await setSettings(sql, id, settingsBody(false));
        if (action === "clear") await clearHistory(sql, id);
        if (action === "delete-account") await deleteAccount(sql, id);
        await onText("This obsolete answer must not be emitted.");
      });
      assert.equal(outcome.at(-1)?.type, "error");
      assert.equal(
        outcome.some((event) => event.type === "delta"),
        false,
      );
      if (action !== "delete-account") assert.equal((await getHistory(sql, id)).messages.length, 0);
      else
        await assert.rejects(
          getHistory(sql, id),
          (error: unknown) => error instanceof ChatError && error.status === 401,
        );
    }
  });

  it("preserves used history when a lost-response run save is replayed without changing results", async () => {
    const { id, settings } = await member();
    const saved = await records(id);
    const update = {
      mutationId: randomUUID(),
      expectedRevision: saved.run.revision,
      results: [saved.actual(0)],
      note: "Explicit corrected interval",
      shareAccountability: false,
      finish: true,
    };
    const committed = await plans.updateRun(sql, id, saved.run.id, update, now);
    assert.equal((await reply(id, settings, usedAnswer)).at(-1)?.type, "done");
    const beforeReplay = await getHistory(sql, id);
    const replay = await plans.updateRun(sql, id, saved.run.id, update, now + 1);
    const afterReplay = await getHistory(sql, id);
    assert.deepEqual(replay, committed);
    assert.equal(afterReplay.settings.historyGeneration, beforeReplay.settings.historyGeneration);
    assert.deepEqual(afterReplay.messages, beforeReplay.messages);
    assert.equal(afterReplay.messages.length, 2);
    const [state] =
      await sql`select manual_workout_context_used from assistant_chat_settings where user_id=${id}`;
    assert.equal(state.manual_workout_context_used, true);
  });
});
