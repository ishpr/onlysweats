import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { postgresTestDatabase, wrap } from "../workout-plans/postgres-test-db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { getPreferences, setPreferences } from "./assistant.server.ts";
import * as contacts from "./contact.server.ts";
import * as coordination from "./coordination.server.ts";

function latch<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("The competing operation must wait on the real profile lock.");
}
async function member(sql: Sql, now: number) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified")
    values (${id}, 'Synthetic contact member', ${`${id}@example.test`}, true)`;
  await ensureProfile(sql, { id, name: "Synthetic contact member", email: `${id}@example.test` });
  const start = Math.ceil((now + 86_400_000) / 900_000) * 900_000;
  await setPreferences(
    sql,
    id,
    {
      enabled: true,
      activity: "run",
      ability: { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 1 },
      durationMin: 30,
      venueIds: ["katy"],
      approvedIntent: "Synthetic entered preference",
      availability: [
        { startAt: new Date(start).toISOString(), endAt: new Date(start + 3600_000).toISOString() },
      ],
    },
    now,
  );
  await sql.transaction(async (tx) => {
    await tx`insert into app_terms_acceptances
      (user_id, version, accepted_at, assistant_consent_generation, fitness_consent_generation)
      values (${id}, ${APP_TERMS_VERSION}, ${new Date(now)}, ${randomUUID()}, ${randomUUID()})`;
    await contacts.initializeAgentContactsFromTerms(tx, id, now);
  });
  return id;
}

test(
  "real Postgres agent contact: concurrent scans and withdrawal fence durable messages",
  {
    skip: !process.env.SAMEPACE_TEST_DATABASE_URL,
    timeout: 60000,
  },
  async (t) => {
    const db = await postgresTestDatabase(process.env.SAMEPACE_TEST_DATABASE_URL!);
    const sql = db.sql;
    async function pair() {
      await sql`update agent_contact_authorities set enabled = false`;
      const now = Date.now(),
        a = await member(sql, now),
        b = await member(sql, now);
      return { now, a, b };
    }
    try {
      await t.test(
        "concurrent preference-save retries replan the same room exactly once",
        async () => {
          const { now, a, b } = await pair();
          await contacts.checkAgentMatching(sql, a, now);
          const [original] = await sql<{
            id: string;
            revision: number;
            plan: { startAt: string };
          }>`select * from agent_negotiations
          where host_id = ${a} or participant_id = ${a}`;
          const preferences = await getPreferences(sql, a);
          const changed = {
            enabled: preferences.enabled,
            activity: preferences.activity,
            ability: preferences.ability,
            durationMin: preferences.durationMin,
            venueIds: preferences.venueIds,
            approvedIntent: preferences.approvedIntent,
            availability: preferences.availability.map((w) => ({
              startAt: new Date(+new Date(w.startAt) + 900_000).toISOString(),
              endAt: new Date(+new Date(w.endAt) + 900_000).toISOString(),
            })),
          };
          const saved = await Promise.all([
            setPreferences(sql, a, changed, now + 1),
            setPreferences(sql, a, changed, now + 1),
            setPreferences(sql, b, changed, now + 1),
          ]);
          assert.deepEqual(
            saved.map((p) => p.revision),
            [2, 2, 2],
          );
          const held = holdAfter(
            sql,
            /select id from profiles where id = any\(\$1\).*for no key update/,
          );
          const first = contacts.checkAgentMatching(held.sql, a, now + 2);
          const pid = await held.entered;
          const second = contacts.checkAgentMatching(sql, b, now + 2);
          try {
            await blocked(sql, pid);
          } finally {
            held.resume();
          }
          await Promise.all([first, second]);
          const rooms = await sql<{
            id: string;
            revision: number;
            plan: { startAt: string };
          }>`select * from agent_negotiations
          where host_id = ${a} or participant_id = ${a}`;
          assert.equal(rooms.length, 1);
          assert.equal(rooms[0].id, original.id);
          assert.equal(rooms[0].revision, original.revision + 2);
          assert.equal(
            +new Date(rooms[0].plan.startAt),
            +new Date(original.plan.startAt) + 900_000,
          );
          const runs =
            await sql`select id from agent_coordination_runs where negotiation_id = ${original.id}`;
          assert.equal(runs.length, 2);
          const changes = await sql`select sequence from agent_negotiation_events
          where negotiation_id = ${original.id} and data->>'action' = 'preferences_changed'`;
          assert.equal(changes.length, 1);
          await contacts.sweepAgentContacts(sql, now + 3);
          assert.equal(
            (
              await sql`select id from agent_coordination_runs where negotiation_id = ${original.id}`
            ).length,
            2,
          );
        },
      );

      await t.test(
        "opposite-side scans actually contend and commit one contact and one bounded run",
        async () => {
          const { now, a, b } = await pair();
          const held = holdAfter(
            sql,
            /select id from profiles where id = any\(\$1\).*for no key update/,
          );
          const first = contacts.checkAgentMatching(held.sql, a, now);
          const pid = await held.entered;
          const second = contacts.checkAgentMatching(sql, b, now);
          try {
            await blocked(sql, pid);
          } finally {
            held.resume();
          }
          await Promise.all([first, second]);
          const rooms = await sql<{
            id: string;
            confirmations: unknown[];
            result_booking_id: string | null;
          }>`select * from agent_negotiations
        where host_id in (${a},${b}) or participant_id in (${a},${b})`;
          assert.equal(rooms.length, 1);
          assert.deepEqual(rooms[0].confirmations, []);
          assert.equal(rooms[0].result_booking_id, null);
          const runs = await sql<{
            status: string;
            steps_used: number;
          }>`select status, steps_used from agent_coordination_runs where negotiation_id = ${rooms[0].id}`;
          assert.deepEqual(runs, [{ status: "awaiting_review", steps_used: 3 }]);
          const [{ contacts: count }] = await sql<{
            contacts: string;
          }>`select count(*)::text contacts from agent_negotiation_events
        where negotiation_id = ${rooms[0].id} and data->>'action' = 'contact'`;
          assert.equal(Number(count), 1);
        },
      );

      await t.test(
        "a committed privacy withdrawal wins against an in-flight candidate scan",
        async () => {
          const { now, a, b } = await pair();
          const held = holdAfter(sql, /select id from profiles where id = .*for no key update/);
          const withdrawal = contacts.setAgentMatching(held.sql, b, { enabled: false }, now + 1);
          const pid = await held.entered;
          const scanning = contacts.checkAgentMatching(sql, a, now + 2);
          try {
            await blocked(sql, pid);
          } finally {
            held.resume();
          }
          await Promise.all([withdrawal, scanning]);
          const rows =
            await sql`select id from agent_negotiations where host_id = ${a} or participant_id = ${a}`;
          assert.equal(rows.length, 0);
          assert.equal((await contacts.getAgentMatching(sql, b, now + 2)).enabled, false);
        },
      );

      await t.test(
        "withdrawal waiting behind a committed contact cancels recovery and cannot resurrect messages",
        async () => {
          const { now, a, b } = await pair();
          const held = holdAfter(
            sql,
            /select id from profiles where id = any\(\$1\).*for no key update/,
          );
          const contact = contacts.checkAgentMatching(held.sql, a, now);
          const pid = await held.entered;
          const withdrawal = contacts.setAgentMatching(sql, b, { enabled: false }, now + 1);
          try {
            await blocked(sql, pid);
          } finally {
            held.resume();
          }
          await Promise.all([contact, withdrawal]);
          const [room] = await sql<{
            id: string;
            state: string;
            result_booking_id: string | null;
          }>`select * from agent_negotiations
        where host_id = ${a} or participant_id = ${a}`;
          assert.equal(room.state, "cancelled");
          assert.equal(room.result_booking_id, null);
          const [run] = await sql<{
            id: string;
            status: string;
          }>`select id, status from agent_coordination_runs where negotiation_id = ${room.id}`;
          assert.equal(run.status, "cancelled");
          const before =
            await sql`select * from agent_negotiation_events where negotiation_id = ${room.id} order by sequence`;
          await Promise.all(
            Array.from({ length: 4 }, () => coordination.advanceCoordination(sql, run.id, now + 2)),
          );
          assert.deepEqual(
            await sql`select * from agent_negotiation_events where negotiation_id = ${room.id} order by sequence`,
            before,
          );
        },
      );
    } finally {
      await db.close();
    }
  },
);
