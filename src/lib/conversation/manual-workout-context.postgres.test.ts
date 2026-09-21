import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { postgresTestDatabase, wrap } from "../workout-plans/postgres-test-db.ts";
import { fixtureMember, fixturePlan } from "../workout-plans/fixtures.ts";
import * as plans from "../workout-plans/service.server.ts";
import * as fitness from "../fitness/service.server.ts";
import { chatResponse, setSettings, getHistory, ChatError } from "./service.server.ts";
import {
  CHAT_NOTICE_VERSION,
  CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
  type ChatEvent,
  type ChatSettings,
} from "../../../shared/conversation.ts";

function latch<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function within<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Manual context race timed out.")), 12000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
function holdAfter(sql: Sql, pattern: RegExp) {
  const entered = latch<number>(),
    resume = latch();
  let armed = true;
  const observed = wrap(sql.query, (fn) =>
    sql.transaction(async (tx) => {
      const inner: Sql = wrap(
        async <T>(text: string, args?: unknown[]) => {
          const rows = await tx.query<T>(text, args);
          if (armed && pattern.test(text)) {
            armed = false;
            const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
            entered.release(pid);
            await resume.promise;
          }
          return rows;
        },
        (nested) => nested(inner),
      );
      return fn(inner);
    }),
  );
  return { sql: observed, entered: entered.promise, resume: () => resume.release() };
}
async function blocked(sql: Sql, pid: number) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const [{ count }] = await sql<{
      count: string;
    }>`select count(*)::text count from pg_stat_activity
      where application_name = current_setting('application_name') and ${pid} = any(pg_blocking_pids(pid))`;
    if (Number(count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("The competing operation must actually wait on the owner lock.");
}
const input = (settings: ChatSettings) => ({
  requestId: randomUUID(),
  text: "Review my entered workout.",
  consentGeneration: settings.consentGeneration,
  historyGeneration: settings.historyGeneration,
});
async function readEvents(response: Response): Promise<ChatEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test(
  "real Postgres: manual context reads and private mutations preserve lock order and generation fences",
  { skip: !process.env.SAMEPACE_TEST_DATABASE_URL, timeout: 90000 },
  async (t) => {
    const db = await postgresTestDatabase(process.env.SAMEPACE_TEST_DATABASE_URL!);
    const sql = db.sql,
      now = Date.now();
    const options = { available: true, now: () => now + 100 };
    async function setup() {
      const id = await fixtureMember(sql);
      const plan = await plans.createPlan(sql, id, fixturePlan(), now);
      const run = await plans.startRun(
        sql,
        id,
        { id: randomUUID(), planId: plan.id, expectedPlanRevision: 1 },
        now,
      );
      const log = await fitness.createStrengthLog(
        sql,
        id,
        {
          startedAt: new Date(now).toISOString(),
          exerciseId: "squat",
          note: "Synthetic",
          sets: [{ reps: 5, weight: null, unit: "kg" }],
        },
        now,
      );
      const { settings } = await setSettings(
        sql,
        id,
        {
          cloudEnabled: true,
          fitnessContextEnabled: false,
          manualWorkoutContextEnabled: true,
          manualWorkoutContextNoticeVersion: CHAT_MANUAL_WORKOUT_NOTICE_VERSION,
          noticeVersion: CHAT_NOTICE_VERSION,
        },
        now,
      );
      return { id, plan, run, log, settings };
    }
    try {
      for (const kind of ["run-update", "legacy-delete"] as const)
        await t.test(
          `a context read holds owner lock before ${kind}, then stale model output is refused`,
          async () => {
            const { id, run, log, settings } = await setup();
            const held = holdAfter(
              sql,
              /update assistant_chat_settings set manual_workout_context_used = true/,
            );
            const releaseAnswer = latch();
            const response = await chatResponse(
              held.sql,
              id,
              input(settings),
              new AbortController().signal,
              {
                ...options,
                provider: async ({ tools, onText }) => {
                  await tools.manualWorkouts!();
                  await releaseAnswer.promise;
                  await onText("An obsolete answer must never reach the member.");
                },
              },
            );
            const pending = readEvents(response);
            const pid = await within(held.entered);
            const mutate =
              kind === "legacy-delete"
                ? fitness.deleteStrengthLog(sql, id, log.id)
                : plans.updateRun(
                    sql,
                    id,
                    run.id,
                    {
                      expectedRevision: 1,
                      results: [
                        {
                          exerciseId: run.snapshot.exercises[0].id,
                          setId: run.snapshot.exercises[0].sets[0].id,
                          status: "completed",
                          reps: null,
                          durationSeconds: 30,
                          distanceMeters: null,
                          weight: null,
                          unit: "bodyweight",
                        },
                      ],
                      note: "Changed",
                      shareAccountability: false,
                      finish: false,
                    },
                    now + 1,
                  );
            try {
              await blocked(sql, pid);
            } finally {
              held.resume();
            }
            await within<unknown>(mutate);
            releaseAnswer.release();
            const outcome = await within(pending);
            assert.equal(outcome.at(-1)?.type, "error");
            assert.equal(
              outcome.some((event) => event.type === "delta"),
              false,
            );
            assert.equal((await getHistory(sql, id)).messages.length, 0);
          },
        );
      await t.test(
        "a mutation first cancels used history before an old-generation turn can reserve",
        async () => {
          const { id, plan, settings } = await setup();
          const first = await readEvents(
            await chatResponse(sql, id, input(settings), new AbortController().signal, {
              ...options,
              provider: async ({ tools, onText }) => {
                await tools.manualWorkouts!();
                await onText("Read saved prescription.");
              },
            }),
          );
          assert.equal(first.at(-1)?.type, "done");
          const held = holdAfter(sql, /delete from workout_plans/);
          const deletion = plans.deletePlan(held.sql, id, plan.id);
          const pid = await within(held.entered);
          let modelCalled = false;
          const next = chatResponse(sql, id, input(settings), new AbortController().signal, {
            ...options,
            provider: async () => {
              modelCalled = true;
            },
          });
          const rejected = assert.rejects(
            next,
            (error: unknown) => error instanceof ChatError && error.status === 409,
          );
          try {
            await blocked(sql, pid);
          } finally {
            held.resume();
          }
          await within(deletion);
          await within(rejected);
          assert.equal(modelCalled, false);
          assert.equal((await getHistory(sql, id)).messages.length, 0);
        },
      );
    } finally {
      await db.close();
    }
  },
);
