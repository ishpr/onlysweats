/** Identity verification — the Persona adapter, its webhook, and the gate — against real SQL. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Sql } from "../db.ts";
import { listNotifications } from "./notify.server.ts";
import * as safety from "./safety.server.ts";
import * as svc from "./service.server.ts";
import { makeDb } from "./test-db.ts";
import * as blocks from "./training-blocks.server.ts";
import * as v from "./verification.server.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const RUN = { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 } as const;
const SECRET = "wbhsec_test";
const PERSONA = {
  PERSONA_API_KEY: "persona_sandbox_test",
  PERSONA_TEMPLATE_MEMBER: "itmpl_member",
  PERSONA_TEMPLATE_GOVERNMENT_ID: "itmpl_govid",
  PERSONA_WEBHOOK_SECRET: SECRET,
};

let sql: Sql;
let n = 0;

async function member(name: string) {
  n += 1;
  const id = `u${n}_${name.toLowerCase()}`;
  const email = `${id}@example.com`;
  await sql`
    insert into "user" (id, name, email, "emailVerified") values (${id}, ${name}, ${email}, true)`;
  await svc.ensureProfile(sql, { id, name, email });
  return id;
}

const rejects = (p: Promise<unknown>, status: number, re?: RegExp, code?: string) =>
  assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof svc.PaceError, String(err));
    assert.equal(err.status, status, err.message);
    if (re) assert.match(err.message, re);
    if (code) assert.equal(err.code, code);
    return true;
  });

// Inquiry ids are unique at Persona, so they are across these fakes too.
let made = 0;
const inquiryOf = (url: string | null) => new URL(url!).searchParams.get("inquiry-id")!;

/** A Persona that remembers what it was asked. */
function fakePersona() {
  const calls: {
    method: string;
    path: string;
    body: unknown;
    auth: string | null;
    idempotency: string | null;
  }[] = [];
  const statuses = new Map<string, string>();
  const references = new Map<string, string>();
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization"),
      idempotency: headers.get("idempotency-key"),
    });
    const reply = (id: string, token?: string) =>
      new Response(
        JSON.stringify({
          data: {
            id,
            attributes: {
              status: statuses.get(id) ?? "created",
              "reference-id": references.get(id),
              "updated-at": new Date(Date.now() + calls.length).toISOString(),
            },
          },
          meta: token ? { "session-token": token } : {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (method === "POST" && path === "/inquiries") {
      made += 1;
      const id = `inq_${made}`;
      statuses.set(id, "created");
      references.set(id, JSON.parse(String(init?.body)).data.attributes["reference-id"]);
      return reply(id, `sess_${made}`);
    }
    const [, , id, action] = path.split("/");
    if (method === "POST" && action === "resume") return reply(id, `sess_resumed_${id}`);
    if (method === "GET") return reply(id);
    if (method === "DELETE") {
      return id === "inq_fails"
        ? new Response("no", { status: 500 })
        : new Response(null, { status: 204 });
    }
    return new Response("?", { status: 404 });
  }) as typeof fetch;
  return { calls, statuses, deps: { env: PERSONA, fetch: doFetch } };
}

const sign = (body: string, at: number, secret = SECRET) =>
  `t=${Math.floor(at / 1000)},v1=${createHmac("sha256", secret)
    .update(`${Math.floor(at / 1000)}.${body}`)
    .digest("hex")}`;

let eventN = 0;
function event(
  inquiryId: string,
  referenceId: string,
  status: string,
  id?: string,
  createdAt?: number,
) {
  eventN += 1;
  return JSON.stringify({
    data: {
      type: "event",
      id: id ?? `evt_${eventN}`,
      attributes: {
        name: `inquiry.${status}`,
        "created-at": new Date(createdAt ?? Date.now() + eventN * 10).toISOString(),
        payload: {
          data: {
            type: "inquiry",
            id: inquiryId,
            attributes: { status, "reference-id": referenceId },
          },
        },
      },
    },
  });
}

const deliver = (body: string, now = Date.now()) =>
  v.handlePersonaWebhook(sql, body, sign(body, now), now, { env: PERSONA });

before(async () => {
  sql = await makeDb();
});

describe("the webhook signature", () => {
  const body = '{"data":{"id":"evt_x"}}';
  const now = Date.UTC(2026, 8, 22, 12);

  it("takes a fresh signature made with our secret, and nothing else", async () => {
    assert.equal(await v.verifyPersonaSignature(body, sign(body, now), [SECRET], now), true);
    assert.equal(
      await v.verifyPersonaSignature(`${body} `, sign(body, now), [SECRET], now),
      false,
      "body changed",
    );
    assert.equal(
      await v.verifyPersonaSignature(body, sign(body, now, "other"), [SECRET], now),
      false,
    );
    assert.equal(await v.verifyPersonaSignature(body, null, [SECRET], now), false);
    assert.equal(await v.verifyPersonaSignature(body, "garbage", [SECRET], now), false);
    assert.equal(
      await v.verifyPersonaSignature(body, sign(body, now), [], now),
      false,
      "no secret, no entry",
    );
  });

  it("refuses a captured one replayed later, and survives a secret rotation", async () => {
    assert.equal(
      await v.verifyPersonaSignature(body, sign(body, now - 6 * 60_000), [SECRET], now),
      false,
    );
    const rotating = `${sign(body, now, "old-secret")} ${sign(body, now)}`;
    assert.equal(await v.verifyPersonaSignature(body, rotating, [SECRET], now), true);
    assert.equal(
      await v.verifyPersonaSignature(body, sign(body, now, "old"), ["new", "old"], now),
      true,
    );
  });
});

describe("the stand-in, outside production", () => {
  it("runs the whole flow without Persona — and doesn’t exist in production", async () => {
    const ana = await member("Ana");
    const env = {};
    assert.deepEqual(await v.getVerification(sql, ana, { env }), {
      available: true,
      enforced: false,
      provider: "dev",
      member: "none",
      governmentId: "none",
      idRequired: false,
    });
    const started = await v.startVerification(sql, ana, "member", Date.now(), { env });
    assert.equal(started.url, null);
    assert.equal(
      (await v.startVerification(sql, ana, "member", Date.now(), { env })).id,
      started.id,
      "one open check",
    );
    assert.equal((await v.getVerification(sql, ana, { env })).member, "pending");

    const done = await v.devComplete(sql, ana, started.id, "approved", Date.now(), { env });
    assert.equal(done.member, "approved");
    assert.equal((await svc.people(sql, [ana]))[0].identityVerified, true);
    assert.ok((await listNotifications(sql, ana)).notifications.some((x) => x.kind === "verified"));
    await rejects(
      v.startVerification(sql, ana, "member", Date.now(), { env }),
      409,
      /already verified/,
    );

    const prod = { VERCEL_ENV: "production" };
    assert.equal((await v.getVerification(sql, ana, { env: prod })).available, false);
    await rejects(
      v.startVerification(sql, ana, "government_id", Date.now(), { env: prod }),
      409,
      /isn’t open/,
    );
    await rejects(v.devComplete(sql, ana, started.id, "approved", Date.now(), { env: prod }), 404);
    await rejects(
      v.devComplete(sql, ana, started.id, "approved", Date.now(), { env: PERSONA }),
      404,
    );
  });
});

describe("Persona", () => {
  it("creates an inquiry with nothing but the member’s id, and resumes it rather than paying twice", async () => {
    const bob = await member("Bob");
    const p = fakePersona();
    const started = await v.startVerification(sql, bob, "member", Date.now(), p.deps);
    assert.equal(started.provider, "persona");
    const [create] = p.calls;
    assert.equal(create.auth, "Bearer persona_sandbox_test");
    assert.deepEqual(create.body, {
      data: { attributes: { "inquiry-template-id": "itmpl_member", "reference-id": bob } },
      meta: { "auto-create-inquiry-session": true },
    });
    const url = new URL(started.url!);
    assert.equal(url.origin, "https://inquiry.withpersona.com");
    const inquiry = inquiryOf(started.url);
    assert.match(inquiry, /^inq_\d+$/);
    assert.match(url.searchParams.get("session-token")!, /^sess_\d+$/);
    assert.equal(url.searchParams.get("redirect-uri"), "https://samepace.app/verified");

    const again = await v.startVerification(sql, bob, "member", Date.now(), p.deps);
    assert.equal(again.id, started.id);
    assert.equal(p.calls.at(-1)?.path, `/inquiries/${inquiry}/resume`);
    assert.match(again.url!, new RegExp(`session-token=sess_resumed_${inquiry}`));
    assert.equal(p.calls.filter((c) => c.path === "/inquiries").length, 1);
  });

  it("moves only our own check, for the member it was made for, once per event", async () => {
    const [cat, dan] = [await member("Cat"), await member("Dan")];
    const p = fakePersona();
    const inquiry = inquiryOf(
      (await v.startVerification(sql, cat, "member", Date.now(), p.deps)).url,
    );
    const state = async (who: string) =>
      (await v.getVerification(sql, who, { env: PERSONA })).member;

    const bad = event(inquiry, cat, "approved");
    assert.equal(
      (
        await v.handlePersonaWebhook(sql, bad, sign(bad, Date.now(), "nope"), Date.now(), {
          env: PERSONA,
        })
      ).status,
      401,
    );
    assert.equal(
      (await deliver(event("inq_someone_elses", cat, "approved"))).outcome,
      "unknown_inquiry",
    );
    assert.equal(
      (await deliver(event(inquiry, dan, "approved"))).outcome,
      "unknown_inquiry",
      "wrong member",
    );
    assert.equal(await state(cat), "pending");

    assert.equal(
      (await deliver(event(inquiry, cat, "completed"))).outcome,
      "pending",
      "done, not yet decided",
    );
    const approved = event(inquiry, cat, "approved", "evt_once");
    assert.equal((await deliver(approved)).outcome, "approved");
    assert.equal((await deliver(approved)).outcome, "duplicate");
    assert.equal(await state(cat), "approved");
    assert.equal(await state(dan), "none");

    // Late and out of order: a stray "pending" doesn't undo a decision…
    await deliver(event(inquiry, cat, "pending", undefined, Date.now() - 1000));
    assert.equal(await state(cat), "approved");
    // …but a reviewer reversing it does.
    await deliver(event(inquiry, cat, "declined"));
    assert.equal(await state(cat), "declined");
    assert.equal((await svc.people(sql, [cat]))[0].identityVerified, false);
  });

  it("re-reads the inquiry when the app comes back before the webhook does", async () => {
    const eve = await member("Eve");
    const p = fakePersona();
    const started = await v.startVerification(sql, eve, "government_id", Date.now(), p.deps);
    assert.equal(
      p.calls[0].body &&
        (p.calls[0].body as { data: { attributes: Record<string, string> } }).data.attributes[
          "inquiry-template-id"
        ],
      "itmpl_govid",
    );
    const inquiry = inquiryOf(started.url);
    p.statuses.set(inquiry, "needs_review");
    assert.equal(
      (await v.refreshVerification(sql, eve, started.id, Date.now(), p.deps)).governmentId,
      "needs_review",
    );
    await rejects(
      v.startVerification(sql, eve, "government_id", Date.now(), p.deps),
      409,
      /looking at/,
    );
    await rejects(
      v.refreshVerification(sql, await member("Fay"), started.id, Date.now(), p.deps),
      404,
    );
    p.statuses.set(inquiry, "approved");
    assert.equal(
      (await v.refreshVerification(sql, eve, started.id, Date.now(), p.deps)).governmentId,
      "approved",
    );
  });

  it("stops at three declines in a month, and asks Persona to delete on the way out", async () => {
    const gus = await member("Gus");
    const p = fakePersona();
    const tries: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      tries.push(
        inquiryOf((await v.startVerification(sql, gus, "member", Date.now(), p.deps)).url),
      );
      await deliver(event(tries.at(-1)!, gus, "declined"));
    }
    await rejects(
      v.startVerification(sql, gus, "member", Date.now(), p.deps),
      409,
      /support@samepace\.app/,
    );
    await v.startVerification(sql, gus, "member", Date.now() + 31 * DAY, p.deps);

    await sql`update verifications set provider_ref = 'inq_fails' where provider_ref = ${tries[1]}`;
    assert.equal(
      await v.redactVerifications(sql, gus, p.deps),
      3,
      "one failure doesn’t stop the rest",
    );
    assert.equal(p.calls.filter((c) => c.method === "DELETE").length, 4);
    assert.equal(
      await v.redactVerifications(sql, gus, { env: {} }),
      0,
      "nothing to ask without a key",
    );
  });
});

describe("verification delivery reliability", () => {
  it("serializes concurrent starts and sends an idempotent provider create", async () => {
    const id = await member("Concurrent");
    const p = fakePersona();
    const started = await Promise.all(
      Array.from({ length: 4 }, () => v.startVerification(sql, id, "member", Date.now(), p.deps)),
    );
    assert.equal(new Set(started.map((x) => x.id)).size, 1);
    const creates = p.calls.filter((x) => x.path === "/inquiries");
    assert.equal(creates.length, 1);
    assert.equal(creates[0].idempotency, `samepace:${id}:member:1`);
  });

  it("an older approval cannot undo a newer decline or alter a newer inquiry", async () => {
    const id = await member("Ordering");
    const p = fakePersona();
    const first = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(first.url);
    const now = Date.now();
    await deliver(event(inquiry, id, "declined", undefined, now));
    await deliver(event(inquiry, id, "approved", undefined, now - 1000));
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "declined");
    const next = await v.startVerification(sql, id, "member", now + 1, p.deps);
    await deliver(event(inquiry, id, "approved", undefined, now + 2));
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "pending");
    assert.notEqual(first.id, next.id);
  });

  it("atomically retains redaction obligations through account deletion and retries failures", async () => {
    const id = await member("DeleteRetry");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    await safety.deleteAccount(sql, id);
    assert.equal((await sql`select id from verifications where profile_id = ${id}`).length, 0);
    const [job] = await sql`select * from persona_redaction_jobs where provider_ref = ${inquiry}`;
    assert.ok(job);
    assert.ok(!Object.values(job).includes(id), "the queue contains no member identity");
    const bad = {
      ...p.deps,
      fetch: (async () => new Response(null, { status: 503 })) as typeof fetch,
    };
    const now = Date.now();
    assert.equal((await v.retryPersonaRedactions(sql, now, bad, [inquiry])).failed, 1);
    assert.equal(
      (await v.retryPersonaRedactions(sql, now + 300_000, p.deps, [inquiry])).redacted,
      1,
    );
    assert.equal(
      (await sql`select * from persona_redaction_jobs where provider_ref = ${inquiry}`).length,
      0,
    );
    await rejects(v.startVerification(sql, id, "member", Date.now(), p.deps), 403);
    assert.equal((await deliver(event(inquiry, id, "approved"))).outcome, "unknown_inquiry");
  });
});

describe("the gate", () => {
  const listing = (patch: Partial<svc.PostSessionInput> = {}): svc.PostSessionInput => ({
    venueId: "katy",
    activity: "run",
    title: "Easy miles",
    detail: "",
    ability: RUN,
    abilityFlex: "strict",
    startAt: new Date(Date.now() + DAY).toISOString(),
    durationMin: 40,
    capacity: 3,
    visibility: "public",
    joinMode: "instant",
    womenOnly: false,
    ...patch,
  });
  const verify = async (who: string, tier: "member" | "government_id") => {
    const started = await v.startVerification(sql, who, tier, Date.now(), { env: {} });
    await v.devComplete(sql, who, started.id, "approved", Date.now(), { env: {} });
  };

  before(() => {
    process.env.VERIFICATION_ENFORCED = "1";
  });
  after(() => {
    delete process.env.VERIFICATION_ENFORCED;
  });

  it("is off until it’s switched on", async () => {
    delete process.env.VERIFICATION_ENFORCED;
    const hal = await member("Hal");
    await svc.postSession(sql, hal, listing());
    process.env.VERIFICATION_ENFORCED = "1";
    await rejects(svc.postSession(sql, hal, listing()), 403, /phone and face/, "verify_member");
  });

  it("asks for a phone and a face before anything public — never for an invite", async () => {
    const [ivy, jon] = [await member("Ivy"), await member("Jon")];
    await rejects(svc.postSession(sql, ivy, listing()), 403, undefined, "verify_member");
    const invite = await svc.postSession(sql, ivy, listing({ visibility: "unlisted" }));
    await svc.bookSeat(sql, jon, invite.id, { inviteCode: invite.inviteCode });

    await verify(ivy, "member");
    const open = await svc.postSession(sql, ivy, listing());
    await rejects(svc.bookSeat(sql, jon, open.id), 403, undefined, "verify_member");
    await verify(jon, "member");
    assert.equal((await svc.bookSeat(sql, jon, open.id)).status, "confirmed");
  });

  it("asks for a government ID for women-only, and after a report is acted on", async () => {
    const [kay, lea, max] = [await member("Kay"), await member("Lea"), await member("Max")];
    for (const who of [kay, lea]) {
      await svc.updateProfile(sql, who, { gender: "woman" });
      await verify(who, "member");
    }
    await rejects(
      svc.postSession(sql, kay, listing({ womenOnly: true })),
      403,
      /government ID/,
      "verify_government_id",
    );
    await verify(kay, "government_id");
    const womenOnly = await svc.postSession(sql, kay, listing({ womenOnly: true }));
    await rejects(svc.bookSeat(sql, lea, womenOnly.id), 403, undefined, "verify_government_id");

    await verify(max, "member");
    const posted = await svc.postSession(sql, max, listing());
    const report = await safety.reportMember(sql, kay, {
      reportedId: max,
      reason: "misrepresented",
      sessionId: posted.id,
    });
    await safety.adminResolveReport(sql, "ops@samepace.app", report.id, {
      action: "remove_session",
    });
    assert.equal((await v.getVerification(sql, max)).idRequired, true);
    await rejects(svc.postSession(sql, max, listing()), 403, undefined, "verify_government_id");
    await svc.postSession(sql, max, listing({ visibility: "unlisted" }));
  });

  it("covers training blocks the same way", async () => {
    const [ned, oli] = [await member("Ned"), await member("Oli")];
    const post = (who: string) =>
      blocks.postTrainingBlock(sql, who, {
        activity: "run",
        goalKind: "consistency",
        goalDate: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10),
        capacity: 3,
        visibility: "public",
        joinMode: "instant",
        womenOnly: false,
        slots: [
          {
            venueId: "katy",
            title: "Saturday long run",
            detail: "",
            ability: RUN,
            abilityFlex: "strict",
            startAt: new Date(Date.now() + 2 * DAY).toISOString(),
            durationMin: 60,
          },
        ],
      });
    await rejects(post(ned), 403, undefined, "verify_member");
    await verify(ned, "member");
    const block = await post(ned);
    await rejects(blocks.joinTrainingBlock(sql, oli, block.id), 403, undefined, "verify_member");
    await verify(oli, "member");
    assert.equal((await blocks.joinTrainingBlock(sql, oli, block.id)).viewer, "member");
  });
});
