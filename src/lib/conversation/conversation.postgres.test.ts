import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import type { Sql } from "../db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import * as health from "../health/service.server.ts";
import type { WorkoutRecord } from "../../../shared/health.ts";
import {
  CHAT_NOTICE_VERSION,
  type ChatEvent,
  type ChatSettings,
} from "../../../shared/conversation.ts";
import type { ChatProvider } from "./provider.server.ts";
import {
  ChatError,
  chatResponse,
  getHistory,
  setSettings,
  acceptAppTerms,
  getAppTerms,
} from "./service.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";

// Opt-in only. Remote runs additionally acknowledge schema-only acceptance;
// credentials come from the caller's environment and never enter diagnostics.
const url = process.env.SAMEPACE_TEST_DATABASE_URL;
type Query = <T>(text: string, values?: unknown[]) => Promise<T[]>;
function wrap(query: Query, transaction: Sql["transaction"]): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
    return query(text, values);
  }) as Sql;
  sql.query = query;
  sql.transaction = transaction;
  return sql;
}
function safeDatabaseError(error: unknown): Error {
  const code = (error as { code?: unknown })?.code;
  return new Error(
    `Isolated PostgreSQL operation failed${typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? ` (${code})` : ""}.`,
  );
}
function latch<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 12_000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function events(response: Response): Promise<ChatEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const input = (settings: ChatSettings) => ({
  requestId: randomUUID(),
  text: "Review this synthetic workout history.",
  consentGeneration: settings.consentGeneration,
  historyGeneration: settings.historyGeneration,
});
async function member(sql: Sql, fitness = false) {
  const id = randomUUID();
  await sql`insert into "user" (id,name,email,"emailVerified")
    values (${id},'Postgres chat fixture',${`${id}@example.test`},true)`;
  await ensureProfile(sql, { id, name: "Postgres chat fixture", email: `${id}@example.test` });
  const { settings } = await setSettings(sql, id, {
    cloudEnabled: true,
    fitnessContextEnabled: fitness,
    noticeVersion: CHAT_NOTICE_VERSION,
  });
  return { id, settings };
}

/** Pause immediately after the actual identity row lock, then inspect its waiter. */
function holdNextOwnerLock(sql: Sql, initiallyArmed = true) {
  let armed = initiallyArmed;
  const locked = latch<number>(),
    resume = latch();
  const observed = wrap(sql.query, (fn) =>
    sql.transaction(async (tx) => {
      const wrapped: Sql = wrap(
        async <T>(text: string, values?: unknown[]) => {
          const rows = await tx.query<T>(text, values);
          if (armed && /select id from "user"\s+where.*for update/s.test(text)) {
            armed = false;
            const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
            locked.release(pid);
            await resume.promise;
          }
          return rows;
        },
        (nested) => nested(wrapped),
      );
      return fn(wrapped);
    }),
  );
  return {
    sql: observed,
    locked: locked.promise,
    resume: () => resume.release(),
    arm: () => {
      armed = true;
    },
  };
}
async function assertBlocked(sql: Sql, pid: number, expected = 1) {
  const deadline = Date.now() + 10_000;
  do {
    const [{ waiting }] = await sql<{ waiting: string }>`
      select count(*)::text waiting from pg_stat_activity
      where application_name = current_setting('application_name')
        and ${pid} = any(pg_blocking_pids(pid))`;
    if (Number(waiting) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail("The competing operation must actually wait on the identity lock in PostgreSQL.");
}

test(
  "real Postgres: conversation leases and fitness privacy serialize safely",
  {
    skip: !url,
    timeout: 180_000,
  },
  async (t) => {
    let parsed: URL;
    try {
      parsed = new URL(url!);
    } catch {
      throw new Error("Invalid test database configuration.");
    }
    assert.ok(
      ["postgres:", "postgresql:"].includes(parsed.protocol),
      "Expected a PostgreSQL test connection.",
    );
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
        process.env.SAMEPACE_TEST_ALLOW_REMOTE_SCHEMA === "1",
      "Remote schema-only acceptance must be explicitly enabled.",
    );
    const schema = `chat_race_${randomUUID().replaceAll("-", "")}`;
    assert.match(schema, /^chat_race_[a-f0-9]{32}$/);
    const pool = new pg.Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 12_000 });
    pool.on("error", () => {
      /* Query boundaries report sanitized errors. */
    });
    const direct: Query = async <T>(text: string, values?: unknown[]) => {
      try {
        return (await pool.query(text, values)).rows as T[];
      } catch (error) {
        throw safeDatabaseError(error);
      }
    };
    const transaction: Sql["transaction"] = async (fn) => {
      const client = await pool.connect().catch((error) => {
        throw safeDatabaseError(error);
      });
      const query: Query = async <T>(text: string, values?: unknown[]) => {
        try {
          return (await client.query(text, values)).rows as T[];
        } catch (error) {
          throw safeDatabaseError(error);
        }
      };
      try {
        await query("begin");
        // SET LOCAL is required on a transaction pooler. Deliberately omit public
        // so missing test tables cannot resolve to deployed application tables.
        await query(`set local search_path to ${schema}, pg_catalog`);
        await query("select set_config('application_name', $1, true)", [schema]);
        await query("set local statement_timeout = '15s'");
        await query("set local idle_in_transaction_session_timeout = '20s'");
        const [{ active }] = await query<{ active: string }>("select current_schema() active");
        assert.equal(active, schema, "Every application statement stays in the isolated schema.");
        const tx: Sql = wrap(query, (nested) => nested(tx));
        const result = await fn(tx);
        await query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    };
    const sql = wrap(
      <T>(text: string, values?: unknown[]) => transaction((tx) => tx.query<T>(text, values)),
      transaction,
    );
    const previousHealth = process.env.HEALTH_SYNC_ENABLED;
    let created = false;
    try {
      await direct(`create schema ${schema}`);
      created = true;
      const directory = new URL("../../../migrations/", import.meta.url);
      const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
      assert.ok(names.includes("0027_conversation.sql") && names.includes("0028_health_zones.sql"));
      await sql`create table _migrations (name text primary key)`;
      for (const name of names) {
        const source = await readFile(new URL(name, directory), "utf8");
        assert.doesNotMatch(
          source,
          /\bpublic\s*\.|\bsearch_path\b|\b(?:create|drop)\s+(?:schema|extension)\b|\balter\s+role\b/i,
          "Migrations must not escape the disposable schema.",
        );
        await sql.transaction(async (tx) => {
          await tx.query(source);
          await tx`insert into _migrations (name) values (${name})`;
        });
      }
      assert.equal((await sql`select name from _migrations`).length, names.length);
      process.env.HEALTH_SYNC_ENABLED = "true";

      await t.test(
        "simultaneous terms acceptance initializes grants once after a real lock wait",
        async () => {
          const id = randomUUID();
          await sql`insert into "user" (id,name,email,"emailVerified")
          values (${id},'Terms race fixture',${`${id}@example.test`},true)`;
          await ensureProfile(sql, { id, name: "Terms race fixture", email: `${id}@example.test` });
          const held = holdNextOwnerLock(sql);
          const first = acceptAppTerms(held.sql, id, { version: APP_TERMS_VERSION });
          const settled = Promise.allSettled([first]);
          try {
            const pid = await within(held.locked, "terms acceptance lock");
            const second = acceptAppTerms(sql, id, { version: APP_TERMS_VERSION });
            await assertBlocked(sql, pid);
            held.resume();
            const [one, two] = await within(
              Promise.all([first, second]),
              "terms acceptance receipts",
            );
            assert.deepEqual(one, two);
            const rows = await sql`select * from app_terms_acceptances where user_id=${id}`;
            assert.equal(rows.length, 1);
            const settings = (await getHistory(sql, id)).settings;
            assert.equal(settings.historyUse, "when_relevant");
            assert.equal(settings.consentReviewed, true);
            assert.equal(rows[0].assistant_consent_generation, settings.consentGeneration);
          } finally {
            held.resume();
            await settled;
          }
        },
      );

      await t.test(
        "terms acceptance waiting behind an opt-out cannot reactivate reviewed permissions",
        async () => {
          const id = randomUUID();
          await sql`insert into "user" (id,name,email,"emailVerified")
          values (${id},'Terms opt-out fixture',${`${id}@example.test`},true)`;
          await ensureProfile(sql, {
            id,
            name: "Terms opt-out fixture",
            email: `${id}@example.test`,
          });
          assert.equal((await getHistory(sql, id)).settings.consentReviewed, false);
          const held = holdNextOwnerLock(sql);
          const off = setSettings(held.sql, id, {
            cloudEnabled: false,
            fitnessContextEnabled: false,
            noticeVersion: CHAT_NOTICE_VERSION,
          });
          const settled = Promise.allSettled([off]);
          try {
            const pid = await within(held.locked, "explicit opt-out lock");
            const accepting = acceptAppTerms(sql, id, { version: APP_TERMS_VERSION });
            await assertBlocked(sql, pid);
            held.resume();
            const [optedOut, accepted] = await within(
              Promise.all([off, accepting]),
              "terms versus opt-out",
            );
            assert.equal(accepted.accepted, true);
            assert.deepEqual((await getHistory(sql, id)).settings, optedOut.settings);
            assert.equal((await getHistory(sql, id)).settings.cloudEnabled, false);
            assert.equal((await getAppTerms(sql, id)).accepted, true);
          } finally {
            held.resume();
            await settled;
          }
        },
      );

      await t.test(
        "simultaneous turns invoke one provider after a real database lock wait",
        async () => {
          const { id, settings } = await member(sql);
          const held = holdNextOwnerLock(sql);
          const started = latch(),
            finish = latch();
          const controllers = [new AbortController(), new AbortController()];
          let calls = 0;
          const provider: ChatProvider = async ({ onText }) => {
            calls++;
            started.release();
            await finish.promise;
            await onText("Synthetic reply.");
          };
          const first = chatResponse(held.sql, id, input(settings), controllers[0].signal, {
            available: true,
            provider,
          });
          const firstSettled = Promise.allSettled([first]);
          let both: Promise<PromiseSettledResult<Response>[]> | undefined;
          try {
            const pid = await within(held.locked, "first reservation lock");
            const second = chatResponse(sql, id, input(settings), controllers[1].signal, {
              available: true,
              provider,
            });
            both = Promise.allSettled([first, second]);
            await assertBlocked(sql, pid);
            held.resume();
            const results = await within(both, "competing reservations");
            const successful = results.filter((result) => result.status === "fulfilled");
            const rejected = results.filter((result) => result.status === "rejected");
            assert.equal(successful.length, 1);
            assert.equal(rejected.length, 1);
            assert.ok(rejected[0].reason instanceof ChatError && rejected[0].reason.status === 409);
            await within(started.promise, "provider entry");
            assert.equal(calls, 1);
            finish.release();
            assert.equal((await events(successful[0].value)).at(-1)?.type, "done");
            assert.equal((await getHistory(sql, id)).messages.length, 2);
          } finally {
            held.resume();
            finish.release();
            controllers.forEach((controller) => controller.abort());
            const outcomes = await (both ?? firstSettled);
            await Promise.all(
              outcomes
                .filter((outcome) => outcome.status === "fulfilled")
                .map((outcome) => (outcome.value.bodyUsed ? undefined : events(outcome.value))),
            );
          }
        },
      );

      await t.test(
        "expired same-request cleanup cannot clear or emit into its replacement lease",
        async () => {
          const { id, settings } = await member(sql);
          const turn = input(settings),
            at = Date.now();
          const oldStarted = latch(),
            oldFinish = latch(),
            newStarted = latch(),
            newFinish = latch();
          const controllers = [new AbortController(), new AbortController()];
          const responses: Response[] = [];
          try {
            responses.push(
              await chatResponse(sql, id, turn, controllers[0].signal, {
                available: true,
                now: () => at,
                provider: async ({ onText }) => {
                  oldStarted.release();
                  await oldFinish.promise;
                  await onText("STALE REPLY");
                },
              }),
            );
            await within(oldStarted.promise, "old provider");
            const [oldLease] =
              await sql`select active_attempt_id from assistant_chat_settings where user_id = ${id}`;
            responses.push(
              await chatResponse(sql, id, turn, controllers[1].signal, {
                available: true,
                now: () => at + 61_000,
                provider: async ({ onText }) => {
                  newStarted.release();
                  await newFinish.promise;
                  await onText("Replacement reply.");
                },
              }),
            );
            await within(newStarted.promise, "replacement provider");
            const [replacement] =
              await sql`select active_attempt_id from assistant_chat_settings where user_id = ${id}`;
            assert.ok(replacement.active_attempt_id);
            assert.notEqual(replacement.active_attempt_id, oldLease.active_attempt_id);
            oldFinish.release();
            const stale = await events(responses[0]);
            assert.equal(stale.at(-1)?.type, "error");
            assert.equal(JSON.stringify(stale).includes("STALE REPLY"), false);
            const [afterOldCleanup] =
              await sql`select active_attempt_id from assistant_chat_settings where user_id = ${id}`;
            assert.equal(afterOldCleanup.active_attempt_id, replacement.active_attempt_id);
            let unexpectedCalls = 0;
            await assert.rejects(
              chatResponse(sql, id, input(settings), new AbortController().signal, {
                available: true,
                now: () => at + 61_001,
                provider: async () => {
                  unexpectedCalls++;
                },
              }),
              (error) => error instanceof ChatError && error.status === 409,
            );
            assert.equal(unexpectedCalls, 0);
            newFinish.release();
            assert.equal((await events(responses[1])).at(-1)?.type, "done");
            const history = await getHistory(sql, id);
            assert.deepEqual(
              history.messages.map((message) => message.text),
              [turn.text, "Replacement reply."],
            );
            const [released] =
              await sql`select active_attempt_id from assistant_chat_settings where user_id = ${id}`;
            assert.equal(released.active_attempt_id, null);
          } finally {
            oldFinish.release();
            newFinish.release();
            controllers.forEach((controller) => controller.abort());
            await Promise.all(responses.filter((response) => !response.bodyUsed).map(events));
          }
        },
      );

      for (const removal of ["delete", "health-permission", "fitness-consent"] as const) {
        for (const first of ["removal", "completion"] as const) {
          await t.test(
            `${removal} and completion share the user lock (${first} first)`,
            async () => {
              const { id, settings } = await member(sql, true);
              const connection = await health.connect(sql, id, {
                deviceId: randomUUID(),
                types: ["workout", "heart_rate"],
              });
              const record: WorkoutRecord = {
                type: "workout",
                externalId: randomUUID(),
                source: { bundleId: "app.samepace.test", name: "Synthetic recorder" },
                startAt: new Date(Date.now() - 3600_000).toISOString(),
                endAt: new Date(Date.now() - 1800_000).toISOString(),
                activity: "run",
                durationSeconds: 1800,
                distanceMeters: null,
                activeEnergyKilocalories: null,
              };
              await health.sync(sql, id, {
                deviceId: connection.deviceId,
                generation: connection.generation,
                type: "workout",
                expectedSequence: connection.cursors.workout!.sequence,
                records: [record],
                deletedIds: [],
                anchor: "synthetic-anchor",
                hasMore: false,
              });
              const held = holdNextOwnerLock(sql, false);
              const read = latch(),
                finish = latch();
              const controller = new AbortController();
              let sawWorkout = false;
              const response = await chatResponse(
                first === "completion" ? held.sql : sql,
                id,
                input(settings),
                controller.signal,
                {
                  available: true,
                  provider: async ({ tools, onText }) => {
                    const context = (await tools.workouts()) as { summaries?: { id: string }[] };
                    sawWorkout =
                      context.summaries?.some((workout) => workout.id === record.externalId) ??
                      false;
                    await onText("Synthetic workout lasted 30 minutes.");
                    read.release();
                    await finish.promise;
                  },
                },
              );
              let mutation: Promise<PromiseSettledResult<unknown>[]> | undefined;
              const remove = (db: Sql) =>
                removal === "delete"
                  ? health.deleteWorkout(db, id, record.externalId)
                  : removal === "health-permission"
                    ? health.connect(db, id, { deviceId: connection.deviceId, types: ["workout"] })
                    : setSettings(db, id, {
                        cloudEnabled: true,
                        fitnessContextEnabled: false,
                        noticeVersion: CHAT_NOTICE_VERSION,
                      });
              try {
                await within(read.promise, "synthetic workout context");
                assert.equal(sawWorkout, true);
                held.arm();
                if (first === "removal") mutation = Promise.allSettled([remove(held.sql)]);
                else finish.release();
                const pid = await within(held.locked, `${first} identity lock`);
                if (first === "removal") finish.release();
                else mutation = Promise.allSettled([remove(sql)]);
                await assertBlocked(sql, pid);
                held.resume();
                const [removed] = await within(mutation!, "privacy mutation");
                assert.equal(removed.status, "fulfilled");
                const result = await events(response);
                assert.equal(result.at(-1)?.type, first === "removal" ? "error" : "done");
                const history = await getHistory(sql, id);
                assert.equal(
                  history.messages.length,
                  0,
                  "No completed stale fitness history survives removal.",
                );
                assert.notEqual(history.settings.historyGeneration, settings.historyGeneration);
                const [state] =
                  await sql`select fitness_context_used, active_attempt_id from assistant_chat_settings where user_id = ${id}`;
                assert.equal(state.fitness_context_used, false);
                assert.equal(state.active_attempt_id, null);
              } finally {
                held.resume();
                finish.release();
                controller.abort();
                if (mutation) await mutation;
                if (!response.bodyUsed) await events(response);
              }
            },
          );
        }
      }
    } finally {
      if (previousHealth === undefined) delete process.env.HEALTH_SYNC_ENABLED;
      else process.env.HEALTH_SYNC_ENABLED = previousHealth;
      try {
        if (created) {
          await direct(`drop schema ${schema} cascade`);
          const rows = await direct("select 1 from pg_namespace where nspname = $1", [schema]);
          assert.equal(rows.length, 0, "The disposable schema was removed.");
        }
      } finally {
        await pool.end();
      }
    }
  },
);
