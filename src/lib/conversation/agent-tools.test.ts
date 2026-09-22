import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as pace from "../pace/service.server.ts";
import * as contacts from "../agents/contact.server.ts";
import * as assistant from "../agents/assistant.server.ts";
import * as coordination from "../agents/coordination.server.ts";
import * as discovery from "../agents/discovery.server.ts";
import * as workouts from "../workout-plans/service.server.ts";
import { fixtureMember, fixturePlan } from "../workout-plans/fixtures.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { isAgentChatCard } from "../../../shared/agent-cards.ts";
import { getPrivateGoal } from "./private-goals.server.ts";
import { readManualWorkoutContext } from "./manual-workout-context.server.ts";
import {
  agentToolDefinitions,
  commandInput,
  prepareAgentTool,
  executeAgentCommand,
  lockAgentCommandProfiles,
  type AgentToolContext,
  type PreparedAgentCard,
} from "./agent-tools.server.ts";

let sql: Sql;
const priorEnabled = process.env.A2A_ENABLED;
const now = Date.now(),
  DAY = 86400000;
const iso = (at: number) => new Date(at).toISOString();
const context: AgentToolContext = {
  now,
  timeZone: "America/Chicago",
  readManualWorkouts: async () => ({ available: false }),
  readWorkoutSummaries: async () => ({ available: false }),
};
const ability = { kind: "run" as const, paceMinSec: 570, paceMaxSec: 600, miles: 1 };
const start = Math.ceil((now + DAY) / 900000) * 900000;
const preferences = {
  enabled: true,
  activity: "run" as const,
  ability,
  durationMin: 30,
  venueIds: ["katy"],
  approvedIntent: "Synthetic member-entered intention",
  availability: [{ startAt: iso(start), endAt: iso(start + 3600000) }],
};
const sessionInput = {
  title: "Synthetic agent session",
  activity: "run",
  ability,
  venueId: "katy",
  startAt: iso(start),
  durationMin: 30,
  capacity: 2,
  visibility: "public",
  joinMode: "instant",
  womenOnly: false,
  abilityFlex: "strict",
  detail: "",
} as const;
const planInput = {
  title: "Synthetic private plan",
  activity: "run",
  overview: "Planned work only",
  exercises: [
    {
      name: "Easy intervals",
      instructions: "Follow your own pace",
      sets: 3,
      targetUnit: "minutes",
      targetAmount: 1,
      restSeconds: 30,
    },
  ],
};
before(async () => {
  sql = await makeDb();
  process.env.A2A_ENABLED = "true";
});
after(() => {
  if (priorEnabled === undefined) delete process.env.A2A_ENABLED;
  else process.env.A2A_ENABLED = priorEnabled;
});
beforeEach(async () => {
  await sql`update agent_contact_authorities set enabled=false`;
});
async function member(matching = false) {
  const id = await fixtureMember(sql, "Synthetic agent member");
  await sql`insert into app_terms_acceptances(user_id,version,accepted_at,assistant_consent_generation,fitness_consent_generation)
    values(${id},${APP_TERMS_VERSION},${iso(now)},${randomUUID()},${randomUUID()})`;
  await contacts.initializeAgentContactsFromTerms(sql, id, now);
  if (matching) await assistant.setPreferences(sql, id, preferences, now);
  return id;
}
async function draft(userId: string, name: string, args: unknown, ctx = context) {
  const result = await prepareAgentTool(sql, userId, name, args, ctx);
  for (const d of result.drafts) {
    assert.ok(isAgentChatCard(d.card));
    if (d.command) assert.ok(commandInput.safeParse(d.command).success);
  }
  return result;
}
async function execute(userId: string, d: PreparedAgentCard, at = now + 1, interaction?: unknown) {
  assert.ok(d.command);
  return sql.transaction(async (tx) => {
    await lockAgentCommandProfiles(tx, userId, d.command);
    return executeAgentCommand(tx, userId, d.command, interaction, at);
  });
}
const rejected = (value: Promise<unknown>, status: number) =>
  assert.rejects(value, (e) => e instanceof pace.PaceError && e.status === status);
async function newSession(host: string, joinMode: "instant" | "approve" = "instant", at = start) {
  return pace.postSession(sql, host, { ...sessionInput, joinMode, startAt: iso(at) }, now);
}
async function pair() {
  const host = await member(true),
    guest = await member(true);
  const found = await draft(host, "findPeople", {});
  const person = found.drafts.find(
    (d) => d.command?.kind === "ask_person" && d.command.contact.memberId === guest,
  )!;
  assert.ok(person);
  const sent = await execute(host, person);
  const roomId = sent.related!.targetId;
  await coordination.sweepCoordination(sql, now + 2, 10);
  return { host, guest, roomId };
}

describe("review-only agent domain tools", () => {
  it("exposes every handoff tool, validates model arguments strictly and never treats a draft as a mutation", async () => {
    assert.deepEqual(
      Object.keys(agentToolDefinitions).sort(),
      [
        "setGoal",
        "setLookingFor",
        "findPeople",
        "askPerson",
        "draftSession",
        "reviewPlan",
        "findSessions",
        "joinSession",
        "answerRequest",
        "draftWorkoutPlan",
        "logSet",
        "myDay",
        "myProgress",
        "checkIn",
        "againNextWeek",
        "recapSession",
      ].sort(),
    );
    const owner = await member();
    for (const [tool, args] of [
      [
        "setGoal",
        { label: "Finish a race", activity: "run", date: iso(now + 30 * DAY).slice(0, 10) },
      ],
      ["draftSession", sessionInput],
      ["draftWorkoutPlan", planInput],
    ] as const) {
      const result = await draft(owner, tool, args);
      assert.equal(result.drafts.length, 1);
    }
    assert.equal(await getPrivateGoal(sql, owner), null);
    for (const table of ["sessions", "workout_plans", "workout_runs"]) {
      const rows = await sql.query(
        `select 1 from ${table} where ${table === "sessions" ? "host_id" : "user_id"}=$1`,
        [owner],
      );
      assert.equal(rows.length, 0);
    }
    await assert.rejects(
      draft(owner, "setGoal", { label: "bad", activity: "run", date: "2026-10-01", execute: true }),
      z.ZodError,
    );
    await assert.rejects(
      draft(owner, "setLookingFor", { ...preferences, role: "mentor" }),
      z.ZodError,
    );
    await rejected(draft(owner, "madeUpTool", {}), 400);
  });

  it("saves a standalone private goal with revisions and local date validation", async () => {
    const owner = await member(),
      other = await member();
    const one = (
      await draft(owner, "setGoal", {
        label: "5K intention",
        activity: "run",
        date: iso(now + DAY).slice(0, 10),
      })
    ).drafts[0];
    await execute(owner, one);
    assert.equal((await getPrivateGoal(sql, owner))?.revision, 1);
    assert.equal(await getPrivateGoal(sql, other), null);
    await rejected(execute(owner, one), 409);
    await rejected(
      draft(owner, "setGoal", {
        label: "Old intention",
        activity: "run",
        date: iso(now - 2 * DAY).slice(0, 10),
      }),
      400,
    );
    assert.equal((await sql`select 1 from training_blocks where created_by=${owner}`).length, 0);
  });

  it("combines preference/matching changes atomically, respects privacy revisions and does not contact during draft", async () => {
    const owner = await member();
    const { enabled: _, ...input } = preferences;
    const d = (await draft(owner, "setLookingFor", input)).drafts[0];
    assert.equal((await assistant.getPreferences(sql, owner)).revision, 0);
    await execute(owner, d);
    assert.equal((await assistant.getPreferences(sql, owner)).revision, 1);
    assert.equal((await contacts.getAgentMatching(sql, owner, now + 2)).ready, true);
    assert.equal(
      (
        await sql`select 1 from agent_negotiations where host_id=${owner} or participant_id=${owner}`
      ).length,
      0,
    );
    const stale = (await draft(owner, "setLookingFor", input, { ...context, now: now + 3 }))
      .drafts[0];
    await contacts.setAgentMatching(sql, owner, { enabled: false }, now + 4);
    await rejected(execute(owner, stale, now + 5), 409);
    assert.equal((await contacts.getAgentMatching(sql, owner, now + 6)).enabled, false);
    const legacy = (await draft(owner, "setLookingFor", input, { ...context, now: now + 7 }))
      .drafts[0];
    await discovery.setDiscovery(sql, owner, { enabled: false }, now + 8);
    await rejected(execute(owner, legacy, now + 9), 409);
  });

  it("finds only compatible authorized people, drafts contact without a room, then queues agent-authored coordination", async () => {
    const owner = await member(true),
      partner = await member(true);
    const found = await draft(owner, "findPeople", {});
    assert.equal(found.drafts.length, 1);
    assert.equal(
      (
        await sql`select 1 from agent_negotiations where host_id=${owner} or participant_id=${owner}`
      ).length,
      0,
    );
    assert.ok(!JSON.stringify(found.data).includes(preferences.approvedIntent));
    const ask = (await draft(owner, "askPerson", { memberId: partner })).drafts[0];
    const sent = await execute(owner, ask);
    const roomId = sent.related!.targetId;
    const [room] = await sql<{
      plan: unknown;
      result_booking_id: string | null;
    }>`select plan,result_booking_id from agent_negotiations where id=${roomId}`;
    assert.equal(room.result_booking_id, null);
    const messages = await sql<{
      author: string;
    }>`select data->>'actorKind' as author from agent_negotiation_events where negotiation_id=${roomId} and kind='agent_message'`;
    assert.ok(messages.length > 0);
    assert.ok(messages.every((m) => m.author === "agent"));
    const [run] = await sql<{
      status: string;
    }>`select status from agent_coordination_runs where negotiation_id=${roomId}`;
    assert.equal(run.status, "queued");
    await rejected(execute(owner, ask, now + 2), 409);
  });

  it("refuses stale contact revisions, revoked authority, blocked partners and disabled A2A", async () => {
    const owner = await member(true),
      partner = await member(true);
    const old = (await draft(owner, "askPerson", { memberId: partner })).drafts[0];
    await assistant.setPreferences(
      sql,
      partner,
      { ...preferences, approvedIntent: "Changed intention" },
      now + 1,
    );
    await rejected(execute(owner, old, now + 2), 409);
    const revoked = (
      await draft(owner, "askPerson", { memberId: partner }, { ...context, now: now + 3 })
    ).drafts[0];
    await contacts.setAgentMatching(sql, partner, { enabled: false }, now + 4);
    await rejected(execute(owner, revoked, now + 5), 409);
    await contacts.setAgentMatching(sql, partner, { enabled: true }, now + 6);
    await sql`insert into blocks(blocker_id,blocked_id) values(${partner},${owner})`;
    assert.equal(
      (await draft(owner, "findPeople", {}, { ...context, now: now + 7 })).drafts.length,
      0,
    );
    process.env.A2A_ENABLED = "false";
    try {
      await rejected(draft(owner, "findPeople", {}), 409);
      await rejected(execute(owner, old), 409);
    } finally {
      process.env.A2A_ENABLED = "true";
    }
  });

  it("stages plan confirmation separately from exact booking approvals and only books after both members", async () => {
    const { host, guest, roomId } = await pair();
    const first = (
      await draft(host, "reviewPlan", { negotiationId: roomId }, { ...context, now: now + 20 })
    ).drafts[0];
    assert.equal(first.command?.kind, "confirm_plan");
    const confirmed = await execute(host, first, now + 21);
    assert.equal(confirmed.followups?.[0].command, null);
    await execute(
      guest,
      (await draft(guest, "reviewPlan", { negotiationId: roomId }, { ...context, now: now + 22 }))
        .drafts[0],
      now + 23,
    );
    const booking = (
      await draft(host, "reviewPlan", { negotiationId: roomId }, { ...context, now: now + 24 })
    ).drafts[0];
    assert.equal(booking.command?.kind, "book_plan");
    await execute(host, booking, now + 25);
    const [pending] = await sql<{
      result_booking_id: string | null;
    }>`select result_booking_id from agent_negotiations where id=${roomId}`;
    assert.equal(pending.result_booking_id, null);
    await execute(
      guest,
      (await draft(guest, "reviewPlan", { negotiationId: roomId }, { ...context, now: now + 26 }))
        .drafts[0],
      now + 27,
    );
    const [complete] = await sql<{
      result_booking_id: string | null;
    }>`select result_booking_id from agent_negotiations where id=${roomId}`;
    assert.ok(complete.result_booking_id);
    const final = (
      await draft(host, "reviewPlan", { negotiationId: roomId }, { ...context, now: now + 28 })
    ).drafts[0];
    assert.equal(final.command, null);
  });

  it("rejects plan cards after exact terms change", async () => {
    const { host, roomId } = await pair();
    const old = (
      await draft(host, "reviewPlan", { negotiationId: roomId }, { ...context, now: now + 20 })
    ).drafts[0];
    await sql`update agent_negotiations set revision=revision+1 where id=${roomId}`;
    await rejected(execute(host, old, now + 21), 409);
  });

  it("posts only on tap and refuses joining changed, private or inaccessible sessions", async () => {
    const host = await member(),
      guest = await member();
    const posted = await execute(host, (await draft(host, "draftSession", sessionInput)).drafts[0]);
    const sessionId = posted.related!.targetId;
    const join = (await draft(guest, "joinSession", { id: sessionId })).drafts[0];
    assert.ok(join.card.facts.some((f) => f.includes("$10")));
    assert.equal((await sql`select 1 from bookings where session_id=${sessionId}`).length, 0);
    await sql`update sessions set duration_min=45 where id=${sessionId}`;
    await rejected(execute(guest, join), 409);
    const current = (await draft(guest, "joinSession", { id: sessionId })).drafts[0];
    await execute(guest, current);
    assert.equal(
      (await sql`select 1 from bookings where session_id=${sessionId} and participant_id=${guest}`)
        .length,
      1,
    );
    const privateSession = await pace.postSession(
      sql,
      host,
      { ...sessionInput, startAt: iso(start + 3 * 3600000), visibility: "unlisted" },
      now,
    );
    await rejected(draft(guest, "joinSession", { id: privateSession.id }), 404);
    const found = await draft(guest, "findSessions", {
      activity: "run",
      startAt: iso(start - 60000),
      endAt: iso(start + DAY),
    });
    assert.ok(found.drafts.length <= 5);
  });

  it("lets only the host approve or decline a pending request", async () => {
    const host = await member(),
      guest = await member(),
      outsider = await member();
    const session = await newSession(host, "approve"),
      b = await pace.bookSeat(sql, guest, session.id, {}, now);
    await rejected(draft(outsider, "answerRequest", { bookingId: b.id, yes: true }), 404);
    await rejected(draft(guest, "answerRequest", { bookingId: b.id, yes: true }), 409);
    await execute(
      host,
      (await draft(host, "answerRequest", { bookingId: b.id, yes: true })).drafts[0],
    );
    assert.equal((await pace.getBooking(sql, guest, b.id)).status, "confirmed");
    const second = await newSession(host, "approve", start + 3600000),
      b2 = await pace.bookSeat(sql, guest, second.id, {}, now);
    await execute(
      host,
      (await draft(host, "answerRequest", { bookingId: b2.id, yes: false })).drafts[0],
    );
    assert.equal((await pace.getBooking(sql, guest, b2.id)).status, "declined");
  });

  it("requires fresh check-in evidence, leaves drafting read-only and repeats only completed sessions", async () => {
    const host = await member(),
      guest = await member();
    const session = await newSession(host),
      b = await pace.bookSeat(sql, guest, session.id, {}, now);
    const d = (await draft(guest, "checkIn", { bookingId: b.id })).drafts[0];
    assert.equal(d.card.input, "checkin");
    assert.equal((await pace.getBooking(sql, guest, b.id)).participantCheckedInAt, null);
    await assert.rejects(execute(guest, d, start, undefined), z.ZodError);
    await rejected(execute(guest, d, now + 2, { code: "0000" }), 409);
    await rejected(draft(guest, "againNextWeek", { bookingId: b.id }), 409);
    const code = await pace.revealCode(sql, host, session.id, start);
    await execute(guest, d, start + 1, { code: code.code });
    await pace.settleDue(sql, start + 31 * 60000);
    const again = (
      await draft(
        guest,
        "againNextWeek",
        { bookingId: b.id },
        { ...context, now: start + 31 * 60000 },
      )
    ).drafts[0];
    assert.ok(again.card.facts.some((f) => f.includes("until you leave")));
    const result = await execute(guest, again, start + 31 * 60000 + 1);
    assert.equal(result.related?.kind, "series");
  });

  it("saves targets as an empty record, logs only supplied actual values and fences concurrent edits", async () => {
    const owner = await member();
    const d = (await draft(owner, "draftWorkoutPlan", planInput)).drafts[0];
    const result = await execute(owner, d),
      runId = result.related!.targetId;
    let run = await workouts.getRun(sql, owner, runId);
    assert.deepEqual(run.results, []);
    assert.equal(run.snapshot.exercises[0].sets[0].durationSeconds, 60);
    const ctx = {
      ...context,
      now: now + 100,
      readManualWorkouts: async () =>
        (await readManualWorkoutContext(sql, owner, now + 100)).context,
    };
    const input = {
      runId,
      exerciseIndex: 0,
      setIndex: 0,
      actual: {
        status: "completed",
        reps: null,
        durationSeconds: 42,
        distanceMeters: null,
        weight: null,
        unit: "bodyweight",
      },
    };
    await rejected(draft(owner, "logSet", input), 403);
    const set = (await draft(owner, "logSet", input, ctx)).drafts[0];
    const stale = (await draft(owner, "logSet", { ...input, setIndex: 1 }, ctx)).drafts[0];
    assert.deepEqual((await workouts.getRun(sql, owner, runId)).results, []);
    await execute(owner, set, now + 101);
    run = await workouts.getRun(sql, owner, runId);
    assert.equal(run.results[0].durationSeconds, 42);
    assert.equal(run.results.length, 1);
    await rejected(execute(owner, stale, now + 102), 409);
    await assert.rejects(
      draft(owner, "logSet", { ...input, actual: { ...input.actual, status: "skipped" } }, ctx),
      z.ZodError,
    );
    const outsider = await member();
    await rejected(draft(outsider, "logSet", input), 403);
  });

  it("keeps progress and recap to owner-only pure queries and the provided bounded history", async () => {
    const host = await member(),
      guest = await member(),
      outsider = await member();
    const session = await newSession(host),
      b = await pace.bookSeat(sql, guest, session.id, {}, now);
    const privateRun = await workouts.createPlan(sql, guest, fixturePlan(), now);
    assert.ok(privateRun.id);
    let manualReads = 0,
      healthReads = 0;
    const ctx = {
      ...context,
      readManualWorkouts: async () => {
        manualReads++;
        return { available: false };
      },
      readWorkoutSummaries: async () => {
        healthReads++;
        return {
          summaries: [
            { activity: "run", startAt: iso(start), durationSeconds: 1800 },
            { activity: "run", startAt: iso(start - 3 * DAY), durationSeconds: 1800 },
          ],
        };
      },
    };
    await draft(guest, "myDay", {}, ctx);
    await draft(guest, "myProgress", {}, ctx);
    await draft(guest, "recapSession", { bookingId: b.id }, ctx);
    assert.equal(manualReads, 0);
    assert.equal(healthReads, 0);
    const progress = await draft(
      guest,
      "myProgress",
      { includeManualWorkouts: true, includeImportedWorkouts: true },
      ctx,
    );
    const data = progress.data as {
      sessions: Array<{ bookingId: string }>;
      manual: { available: boolean };
    };
    assert.ok(data.sessions.some((s) => s.bookingId === b.id));
    assert.equal(data.manual.available, false);
    assert.ok(!JSON.stringify(progress).includes(privateRun.id));
    await draft(
      guest,
      "myDay",
      { includeManualWorkouts: true, includeImportedWorkouts: true },
      ctx,
    );
    const recap = await draft(
      guest,
      "recapSession",
      { bookingId: b.id, includeManualWorkouts: true, includeImportedWorkouts: true },
      ctx,
    );
    assert.equal((recap.data as { healthNearby: unknown[] }).healthNearby.length, 1);
    assert.match(JSON.stringify(recap), /does not prove/);
    await rejected(draft(outsider, "recapSession", { bookingId: b.id }, ctx), 404);
    assert.equal(manualReads, 3);
    assert.equal(healthReads, 3);
    assert.equal((await pace.getBooking(sql, guest, b.id)).status, "confirmed");
  });
});
