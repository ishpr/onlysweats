import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import pg from "pg";
import type { Sql } from "../db.ts";
import { pair, proposal, HOUR } from "../agents/test-helpers.ts";
import * as agents from "../agents/service.server.ts";
import * as assistant from "../agents/assistant.server.ts";
import * as health from "../health/service.server.ts";
import * as pace from "../pace/service.server.ts";

const url = process.env.SAMEPACE_TEST_DATABASE_URL;
type Query = <T>(query: string, values?: unknown[]) => Promise<T[]>;
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
function migrate(databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
      cwd: new URL("../../..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl, VERCEL: "" },
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Migration process exited ${code}`)),
    );
  });
}

test(
  "real Postgres: concurrent migrations, human approvals, and Health pages are atomic",
  { skip: !url, timeout: 60_000 },
  async () => {
    const parsed = new URL(url!);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
      "Use a disposable local Postgres, never a deployed database.",
    );
    const schema = `release_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    parsed.searchParams.set("options", `-c search_path=${schema}`);
    const databaseUrl = parsed.toString();
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    const sql: Sql = wrap(
      async <T>(q: string, p?: unknown[]) => (await pool.query(q, p)).rows as T[],
      async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          const tx: Sql = wrap(
            async <T>(q: string, p?: unknown[]) => (await client.query(q, p)).rows as T[],
            (nested) => nested(tx),
          );
          const result = await fn(tx);
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      },
    );
    try {
      await Promise.all([migrate(databaseUrl), migrate(databaseUrl), migrate(databaseUrl)]);
      const [{ count }] = await sql<{ count: string }>`select count(*) from _migrations`;
      assert.equal(
        Number(count),
        (await readdir(new URL("../../../migrations", import.meta.url))).filter((name) =>
          name.endsWith(".sql"),
        ).length,
      );
      const f = await pair(sql);
      const prefs = {
        enabled: true,
        activity: "run",
        ability: proposal(f.now).plan.ability,
        durationMin: 60,
        venueIds: ["katy"],
        approvedIntent: "An easy run",
        availability: [
          {
            startAt: new Date(f.now + 24 * HOUR).toISOString(),
            endAt: new Date(f.now + 26 * HOUR).toISOString(),
          },
        ],
      };
      await assistant.setPreferences(sql, f.host, prefs, f.now);
      await assistant.setPreferences(sql, f.member, prefs, f.now);
      await agents.proposeForMember(
        sql,
        f.host,
        f.room.id,
        { messageId: "postgres-proposal", expectedRevision: 0, plan: proposal(f.now).plan },
        f.now,
      );
      await agents.confirmProposal(sql, f.host, f.room.id, 1, f.now);
      await agents.confirmProposal(sql, f.member, f.room.id, 1, f.now);
      const { terms } = await assistant.getBookingTerms(sql, f.host, f.room.id, f.now);
      const approval = { revision: 1, termsHash: terms.termsHash };
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          assistant.approveBookingTerms(sql, i % 2 ? f.host : f.member, f.room.id, approval, f.now),
        ),
      );
      // Call order is not PostgreSQL lock-acquisition order: several retries
      // from the first member may finish before the other member approves.
      // Those responses must still say "waiting", rather than being counted as
      // failed bookings. Check each observed state and the committed result.
      const members = [f.host, f.member].sort();
      const booked = results.filter((result) => result.booked);
      assert.ok(booked.length > 0, "the second member's approval eventually creates a booking");
      for (const [index, result] of results.entries()) {
        const callerId = index % 2 ? f.host : f.member;
        assert.equal(result.terms.termsHash, terms.termsHash);
        if (result.booked) {
          assert.deepEqual([...result.approvedIds].sort(), members);
          assert.ok(result.sessionId && result.bookingId, "booked responses identify both records");
        } else {
          assert.deepEqual(
            result.approvedIds,
            [callerId],
            "waiting responses retain only the caller's approval",
          );
          assert.equal(result.sessionId, null);
          assert.equal(result.bookingId, null);
        }
      }
      assert.equal(new Set(booked.map((result) => result.bookingId)).size, 1);
      assert.equal(new Set(booked.map((result) => result.sessionId)).size, 1);
      const finalReviews = await Promise.all(
        members.map((memberId) => assistant.getBookingTerms(sql, memberId, f.room.id, f.now)),
      );
      for (const review of finalReviews) {
        assert.equal(
          review.booked,
          true,
          "both members see the committed booking after every request finishes",
        );
        assert.deepEqual([...review.approvedIds].sort(), members);
        assert.equal(review.bookingId, booked[0].bookingId);
        assert.equal(review.sessionId, booked[0].sessionId);
      }
      const [{ sessions, bookings }] = await sql<{ sessions: string; bookings: string }>`
        select count(distinct s.id) sessions, count(b.id) bookings
        from sessions s left join bookings b on b.session_id = s.id
        where s.host_id = ${f.host} and s.start_at = ${proposal(f.now).plan.startAt}::timestamptz`;
      assert.equal(Number(sessions), 1, "concurrent approvals create exactly one future session");
      assert.equal(Number(bookings), 1, "concurrent approvals create exactly one seat booking");
      const approvals = await sql<{ profile_id: string; n: string }>`
        select profile_id, count(*) n from agent_negotiation_events
        where negotiation_id = ${f.room.id} and kind = 'booking_approval'
        group by profile_id order by profile_id`;
      assert.deepEqual(
        approvals.map((row) => row.profile_id),
        members,
      );
      assert.ok(
        approvals.every((row) => Number(row.n) === 1),
        "each member's approval is recorded once",
      );
      const [{ n }] = await sql<{
        n: string;
      }>`select count(*) n from agent_negotiation_events where negotiation_id = ${f.room.id} and kind = 'booked'`;
      assert.equal(Number(n), 1);

      // Reciprocal normal joins used to take different profile UPDATE locks,
      // then deadlock when their host notifications needed each other's FK
      // KEY SHARE lock. Meet at the real profile-lock queries and hold the
      // first acquisition until PostgreSQL shows the second request waiting.
      const reciprocal = await pair(sql);
      const reciprocalInput = {
        ...proposal(reciprocal.now).plan,
        detail: "",
        abilityFlex: "strict" as const,
        visibility: "public" as const,
        capacity: 2,
        joinMode: "instant" as const,
        womenOnly: false,
      };
      const firstSession = await pace.postSession(
        sql,
        reciprocal.host,
        reciprocalInput,
        reciprocal.now,
      );
      const secondSession = await pace.postSession(
        sql,
        reciprocal.member,
        reciprocalInput,
        reciprocal.now,
      );
      let attempts = 0;
      let allAttempting!: () => void;
      const attempting = new Promise<void>((resolve) => {
        allAttempting = resolve;
      });
      let startLocks!: () => void;
      const start = new Promise<void>((resolve) => {
        startLocks = resolve;
      });
      let continueWrites!: () => void;
      const writes = new Promise<void>((resolve) => {
        continueWrites = resolve;
      });
      const acquiredPids: number[] = [];
      const synchronized = wrap(sql.query, (fn) =>
        sql.transaction(async (tx) => {
          let intercepted = false;
          const observed: Sql = wrap(
            async <T>(q: string, p?: unknown[]) => {
              if (!intercepted && /select id from profiles\b.*for (?:no key )?update/s.test(q)) {
                intercepted = true;
                const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
                if (++attempts === 2) allAttempting();
                await start;
                const rows = await tx.query<T>(q, p);
                acquiredPids.push(pid);
                await writes;
                return rows;
              }
              return tx.query<T>(q, p);
            },
            (nested) => nested(observed),
          );
          return fn(observed);
        }),
      );
      const reciprocalJoins = Promise.allSettled([
        pace.bookSeat(synchronized, reciprocal.host, secondSession.id, {}, reciprocal.now),
        pace.bookSeat(synchronized, reciprocal.member, firstSession.id, {}, reciprocal.now),
      ]);
      await attempting;
      startLocks();
      let serialized = false;
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && acquiredPids.length < 2) {
          const [{ blocked }] = await sql.query<{ blocked: boolean }>(
            "select exists(select 1 from pg_stat_activity where pg_blocking_pids(pid) && $1::int[]) blocked",
            [acquiredPids],
          );
          if (blocked) {
            serialized = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        continueWrites();
      }
      const reciprocalResults = await reciprocalJoins;
      assert.equal(
        serialized,
        true,
        "reciprocal joiners acquire the same profiles in one ordering",
      );
      assert.ok(
        reciprocalResults.every((result) => result.status === "fulfilled"),
        "both reciprocal normal joins complete without a foreign-key deadlock",
      );

      // A partner may check in before the start while another person joins.
      // Pause after the arrival owns the real session lock, then establish the
      // joiner's PostgreSQL wait before settlement updates profile counters.
      // Session-first arrival locks deadlock with profile-first reservations.
      const arriving = await pair(sql);
      const others = await pair(sql);
      const group = await pace.postSession(
        sql,
        arriving.host,
        { ...reciprocalInput, ...proposal(arriving.now).plan, capacity: 4 },
        arriving.now,
      );
      const arrivingSeat = await pace.bookSeat(sql, arriving.member, group.id, {}, arriving.now);
      await pace.bookSeat(sql, others.host, group.id, {}, arriving.now);
      const arrivalAt = Date.parse(group.startAt) - 10 * 60_000;
      const point = { lat: 32.8019, lng: -96.8074 };
      await pace.checkInGeo(sql, arriving.host, arrivingSeat.id, point, arrivalAt);
      const [beforeArrival] = await sql<{ completed_count: number }>`
        select completed_count from profiles where id = ${arriving.host}`;
      let sessionLocked!: (pid: number) => void;
      const locked = new Promise<number>((resolve) => {
        sessionLocked = resolve;
      });
      let finishArrival!: () => void;
      const finish = new Promise<void>((resolve) => {
        finishArrival = resolve;
      });
      const pausedArrival = wrap(sql.query, (fn) =>
        sql.transaction(async (tx) => {
          let intercepted = false;
          const observed: Sql = wrap(
            async <T>(q: string, p?: unknown[]) => {
              const rows = await tx.query<T>(q, p);
              if (!intercepted && /select \* from sessions\b.*for update/s.test(q)) {
                intercepted = true;
                const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
                sessionLocked(pid);
                await finish;
              }
              return rows;
            },
            (nested) => nested(observed),
          );
          return fn(observed);
        }),
      );
      const arrivalResult = pace.checkInGeo(
        pausedArrival,
        arriving.member,
        arrivingSeat.id,
        point,
        arrivalAt,
      );
      const arrivalPid = await locked;
      const concurrentArrival = Promise.allSettled([
        arrivalResult,
        pace.bookSeat(sql, others.member, group.id, {}, arrivalAt),
      ]);
      let joinWaiting = false;
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const [{ blocked }] = await sql.query<{ blocked: boolean }>(
            "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) blocked",
            [arrivalPid],
          );
          if (blocked) {
            joinWaiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        finishArrival();
      }
      const arrivalResults = await concurrentArrival;
      assert.equal(joinWaiting, true, "late join actually waited on the in-flight arrival");
      assert.ok(
        arrivalResults.every((result) => result.status === "fulfilled"),
        "early check-in and late join complete without a profile/session deadlock",
      );
      const [arrivalState] = await sql<{ status: string }>`
        select status from bookings where id = ${arrivingSeat.id}`;
      assert.equal(arrivalState.status, "completed");
      const [{ completed_count }] = await sql<{ completed_count: number }>`
        select completed_count from profiles where id = ${arriving.host}`;
      assert.equal(completed_count, beforeArrival.completed_count + 1);

      // Exercise both real lock orderings. A held profile lock establishes the
      // winner, and pg_blocking_pids proves the other request is actually waiting
      // in PostgreSQL before the winner commits. This is not an event-loop race.
      for (const first of ["manual", "assistant"] as const) {
        const race = await pair(sql);
        const plan = proposal(race.now).plan;
        const racePrefs = {
          ...prefs,
          ability: plan.ability,
          availability: [
            {
              startAt: plan.startAt,
              endAt: new Date(race.now + 26 * HOUR).toISOString(),
            },
          ],
        };
        for (const memberId of [race.host, race.member])
          await assistant.setPreferences(sql, memberId, racePrefs, race.now);
        await agents.proposeForMember(
          sql,
          race.host,
          race.room.id,
          {
            messageId: "race-proposal",
            expectedRevision: 0,
            plan,
          },
          race.now,
        );
        for (const memberId of [race.host, race.member])
          await agents.confirmProposal(sql, memberId, race.room.id, 1, race.now);
        const raceTerms = (await assistant.getBookingTerms(sql, race.host, race.room.id, race.now))
          .terms;
        const raceApproval = { revision: 1, termsHash: raceTerms.termsHash };
        await assistant.approveBookingTerms(sql, race.host, race.room.id, raceApproval, race.now);
        const execute = (db: Sql, operation: "manual" | "assistant") =>
          operation === "manual"
            ? pace.postSession(
                db,
                race.member,
                {
                  ...plan,
                  detail: "",
                  abilityFlex: "strict",
                  visibility: "public",
                  capacity: 2,
                  joinMode: "instant",
                  womenOnly: false,
                },
                race.now,
              )
            : assistant.approveBookingTerms(db, race.member, race.room.id, raceApproval, race.now);
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let locked!: (pid: number) => void;
        const winnerLocked = new Promise<number>((resolve) => {
          locked = resolve;
        });
        const winner = sql.transaction(async (tx) => {
          await tx.query("select id from profiles where id = any($1) order by id for update", [
            [race.host, race.member],
          ]);
          const [{ pid }] = await tx<{ pid: number }>`select pg_backend_pid() pid`;
          locked(pid);
          await released;
          return execute(tx, first);
        });
        const winnerPid = await winnerLocked;
        const loser = execute(sql, first === "manual" ? "assistant" : "manual");
        // Attach rejection handlers before releasing the lock to prevent a Node
        // unhandled-rejection report while querying the resulting database state.
        const outcomes = Promise.allSettled([winner, loser]);
        try {
          const deadline = Date.now() + 5000;
          let waiting = false;
          do {
            const [{ blocked }] = await sql.query<{ blocked: boolean }>(
              "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) blocked",
              [winnerPid],
            );
            waiting = blocked;
            if (waiting) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          } while (Date.now() < deadline);
          assert.equal(waiting, true, `${first} winner must block its competitor in PostgreSQL`);
        } finally {
          release();
        }
        const [won, lost] = await outcomes;
        assert.equal(won.status, "fulfilled", `${first} wins the held-lock ordering`);
        assert.equal(lost.status, "rejected", "the overlapping request cannot also succeed");
        if (lost.status === "rejected") {
          assert.ok(lost.reason instanceof pace.PaceError);
          assert.equal(lost.reason.status, 409);
        }
        const [reservation] = await sql<{ result_booking_id: string | null }>`
        select result_booking_id from agent_negotiations where id = ${race.room.id}`;
        assert.equal(Boolean(reservation.result_booking_id), first === "assistant");
        const [{ overlapping }] = await sql<{ overlapping: string }>`
        select count(*) overlapping from sessions s where s.status = 'open'
          and s.start_at = ${plan.startAt}::timestamptz
          and (s.host_id in (${race.host}, ${race.member}) or exists (
            select 1 from bookings b where b.session_id = s.id and b.participant_id = ${race.member}
              and b.status in ('pending', 'confirmed')))`;
        assert.equal(
          Number(overlapping),
          1,
          "there is exactly one overlapping reservation after the race",
        );
      }

      const connection = await health.connect(
        sql,
        f.host,
        { deviceId: randomUUID(), types: ["workout"] },
        f.now,
      );
      const page = {
        deviceId: connection.deviceId,
        generation: connection.generation,
        type: "workout",
        expectedSequence: 0,
        records: [],
        deletedIds: [],
        anchor: "same-page",
        hasMore: false,
      };
      const syncs = await Promise.allSettled([
        health.sync(sql, f.host, page, f.now),
        health.sync(sql, f.host, page, f.now),
      ]);
      assert.equal(syncs.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await health.getConnection(sql, f.host))?.cursors.workout?.sequence, 1);
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  },
);
