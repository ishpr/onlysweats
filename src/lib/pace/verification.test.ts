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
import { preparePersonaCreationIntent } from "./persona-creation-intents.server.ts";

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
const templates = new Map<string, string>();
const inquiryOf = (url: string | null) => new URL(url!).searchParams.get("inquiry-id")!;
type FakeInquiryResponse = {
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      "reference-id"?: string | null;
      "updated-at": string;
      "redacted-at"?: string | null;
    };
    relationships: {
      account?: { data: { id: string; type: string } | null };
      "inquiry-template"?: { data: { id?: string; type: string } };
    };
  };
  meta: { "session-token"?: string };
};

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
  const created = new Map<string, string>();
  const control: { edit?: (response: FakeInquiryResponse) => void } = {};
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
    const reply = (id: string, token?: string) => {
      const body: FakeInquiryResponse = {
        data: {
          id,
          type: "inquiry",
          attributes: {
            status: statuses.get(id) ?? "created",
            "reference-id": references.get(id),
            "updated-at": new Date(Date.now() + calls.length).toISOString(),
          },
          relationships: {
            account: { data: null },
            "inquiry-template": { data: { type: "inquiry-template", id: templates.get(id) } },
          },
        },
        meta: token ? { "session-token": token } : {},
      };
      control.edit?.(body);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    if (method === "POST" && path === "/inquiries") {
      const key = headers.get("idempotency-key")!;
      const existing = created.get(key);
      if (existing) return reply(existing, `sess_replayed_${existing}`);
      made += 1;
      const id = `inq_${made}`;
      created.set(key, id);
      statuses.set(id, "created");
      references.set(id, JSON.parse(String(init?.body)).data.attributes["reference-id"]);
      templates.set(id, JSON.parse(String(init?.body)).data.attributes["inquiry-template-id"]);
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
  return { calls, statuses, references, control, deps: { env: PERSONA, fetch: doFetch } };
}

const sign = (body: string, at: number, secret = SECRET) =>
  `t=${Math.floor(at / 1000)},v1=${createHmac("sha256", secret)
    .update(`${Math.floor(at / 1000)}.${body}`)
    .digest("hex")}`;

let eventN = 0;
function event(
  inquiryId: string,
  referenceId: string | null,
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
            relationships: {
              account: { data: null },
              "inquiry-template": {
                data: { type: "inquiry-template", id: templates.get(inquiryId) ?? "itmpl_member" },
              },
            },
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
  it("keeps fully configured production flows closed until explicitly launched", async () => {
    const env = {
      ...PERSONA,
      PERSONA_API_KEY: "persona_production_test",
      PERSONA_CASE_CLEANUP_API_KEY: "persona_production_cases",
      PERSONA_CASE_TEMPLATE_IDS: "ctmpl_samepace",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    };
    const id = await member("ProductionNotLaunched");
    const p = fakePersona();
    for (const flag of [undefined, "", "0", "true", "false", "01"]) {
      const deps = { ...p.deps, env: { ...env, PERSONA_VERIFICATION_ENABLED: flag } };
      assert.equal((await v.getVerification(sql, id, deps)).available, false);
      await rejects(v.startVerification(sql, id, "member", Date.now(), deps), 409, /isn’t open/);
    }
    assert.equal(p.calls.length, 0, "staging production keys must not contact Persona");
    assert.equal(
      (await sql`select id from persona_creation_intents where profile_id = ${id}`).length, 0,
    );
    assert.equal(v.providerFor({ ...env, PERSONA_VERIFICATION_ENABLED: "1" }), "persona");
    assert.equal(v.providerFor({ ...env, VERCEL_ENV: undefined }), null,
      "a non-Vercel production server also requires launch approval");
    assert.equal(v.providerFor({ ...PERSONA, VERCEL_ENV: "preview", NODE_ENV: "production" }), "persona");
    assert.equal(v.providerFor({ ...PERSONA, VERCEL_ENV: "preview", NODE_ENV: "production", PERSONA_VERIFICATION_ENABLED: "0" }), null);
    assert.equal(v.providerFor({ PERSONA_VERIFICATION_ENABLED: "0" }), null,
      "the off switch does not expose the dev stand-in");
  });

  it("pauses new and resumed flows while existing refreshes and signed decisions still reconcile", async () => {
    for (const env of [
      { ...PERSONA, VERCEL_ENV: "preview", NODE_ENV: "production" },
      {
        ...PERSONA,
        PERSONA_API_KEY: "persona_production_test",
        PERSONA_CASE_CLEANUP_API_KEY: "persona_production_cases",
        PERSONA_CASE_TEMPLATE_IDS: "ctmpl_samepace",
        PERSONA_VERIFICATION_ENABLED: "1",
        VERCEL_ENV: "production",
        NODE_ENV: "production",
      },
    ]) {
      const id = await member("PausedVerification");
      const p = fakePersona();
      const started = await v.startVerification(sql, id, "member", Date.now(), { ...p.deps, env });
      const inquiry = inquiryOf(started.url);
      const paused = { ...p.deps, env: { ...env, PERSONA_VERIFICATION_ENABLED: "0" } };
      const before = p.calls.length;
      await rejects(v.startVerification(sql, id, "member", Date.now(), paused), 409, /isn’t open/);
      await rejects(v.startVerification(sql, id, "government_id", Date.now(), paused), 409, /isn’t open/);
      assert.equal(p.calls.length, before, "no new inquiry or hosted session while paused");
      assert.equal((await v.getVerification(sql, id, paused)).provider, null);
      p.statuses.set(inquiry, "approved");
      const refreshed = await v.refreshVerification(sql, id, started.id, Date.now(), paused);
      assert.equal(refreshed.member, "approved");
      assert.equal(refreshed.available, false);
      const now = Date.now() + 1000;
      const body = event(inquiry, null, "declined", undefined, now);
      assert.equal((await v.handlePersonaWebhook(sql, body, sign(body, now), now, paused)).outcome, "declined");
      assert.equal((await v.getVerification(sql, id, paused)).member, "declined");
      assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
    }
  });

  it("allows sandbox keys only locally or in an explicit Vercel preview", () => {
    const cases: [Record<string, string>, "persona" | null][] = [
      [{}, "persona"],
      [{ NODE_ENV: "development" }, "persona"],
      [{ NODE_ENV: "test" }, "persona"],
      [{ NODE_ENV: "production" }, null],
      [{ VERCEL_ENV: "production" }, null],
      [{ VERCEL_ENV: "production", NODE_ENV: "development" }, null],
      [{ VERCEL_ENV: "production", NODE_ENV: "production" }, null],
      [{ VERCEL_ENV: "preview", NODE_ENV: "production" }, "persona"],
      [{ VERCEL_ENV: "development", NODE_ENV: "production" }, null],
    ];
    for (const [env, expected] of cases) {
      assert.equal(v.providerFor({ ...PERSONA, ...env }), expected, JSON.stringify(env));
    }
    assert.equal(
      v.providerFor({
        ...PERSONA,
        PERSONA_API_KEY: " persona_sandbox_test ",
        NODE_ENV: "production",
      }),
      null,
      "whitespace cannot bypass the environment guard",
    );
    assert.equal(
      v.providerFor({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
      null,
      "an explicit preview does not enable the dev approval endpoint in production builds",
    );
  });

  it("blocks sandbox starts, refresh approvals and signed webhooks in production", async () => {
    const id = await member("SandboxIsolation");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    p.statuses.set(inquiry, "approved");
    const callsBefore = p.calls.length;
    const now = Date.now();
    const body = event(inquiry, id, "approved", "evt_sandbox_production", now);
    for (const configuration of [
      { ...PERSONA, NODE_ENV: "production" },
      { ...PERSONA, VERCEL_ENV: "production" },
      { ...PERSONA, NODE_ENV: "production", PERSONA_API_KEY: "placeholder" },
      { ...PERSONA, VERCEL_ENV: "production", PERSONA_API_KEY: "persona_sandox_typo" },
      { ...PERSONA, NODE_ENV: "production", PERSONA_API_KEY: "" },
    ]) {
      const deps = { ...p.deps, env: configuration };
      await rejects(v.startVerification(sql, id, "government_id", now, deps), 409, /isn’t open/);
      await rejects(v.startVerification(sql, id, "member", now, deps), 409, /isn’t open/);
      const refreshed = await v.refreshVerification(sql, id, started.id, now, deps);
      assert.equal(refreshed.available, false);
      assert.equal(refreshed.member, "pending");
      assert.deepEqual(await v.handlePersonaWebhook(sql, body, sign(body, now), now, deps), {
        status: 401,
        outcome: "provider_unavailable",
      });
      await rejects(v.devComplete(sql, id, started.id, "approved", now, deps), 404);
    }
    assert.equal(p.calls.length, callsBefore, "no sandbox API request escaped the guard");
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
    assert.equal(
      (await sql`select id from verification_events where id = 'evt_sandbox_production'`).length,
      0,
    );
    await safety.deleteAccount(sql, id);
    assert.deepEqual(
      await v.retryPersonaRedactions(
        sql,
        Date.now(),
        {
          ...p.deps,
          env: { ...PERSONA, VERCEL_ENV: "production" },
        },
        [inquiry],
      ),
      { redacted: 0, failed: 0 },
    );
    assert.equal(
      p.calls.length,
      callsBefore,
      "misconfigured production does not call sandbox for deletion",
    );
    assert.equal(
      (await sql`select provider_ref from persona_redaction_jobs where provider_ref = ${inquiry}`)
        .length,
      1,
      "the deletion obligation survives invalid credentials",
    );
  });

  it("accepts sandbox preview decisions and real-key production decisions", async () => {
    for (const env of [
      { ...PERSONA, VERCEL_ENV: "preview", NODE_ENV: "production" },
      {
        ...PERSONA,
        PERSONA_API_KEY: "persona_production_test",
        PERSONA_CASE_CLEANUP_API_KEY: "persona_production_cases",
        PERSONA_CASE_TEMPLATE_IDS: "ctmpl_samepace",
        PERSONA_VERIFICATION_ENABLED: "1",
        VERCEL_ENV: "production",
        NODE_ENV: "production",
      },
    ]) {
      const id = await member("AllowedEnvironment");
      const p = fakePersona();
      const deps = { ...p.deps, env };
      const started = await v.startVerification(sql, id, "member", Date.now(), deps);
      const now = Date.now();
      const body = event(inquiryOf(started.url), id, "approved", undefined, now);
      assert.equal(
        (await v.handlePersonaWebhook(sql, body, sign(body, now), now, deps)).outcome,
        "approved",
      );
      assert.equal((await v.getVerification(sql, id, deps)).member, "approved");
      assert.equal((await svc.people(sql, [id]))[0].identityVerified, true);
    }
  });

  it("creates an accountless inquiry without sending a member identifier, and resumes it", async () => {
    const bob = await member("Bob");
    const p = fakePersona();
    const started = await v.startVerification(sql, bob, "member", Date.now(), p.deps);
    assert.equal(started.provider, "persona");
    const [create] = p.calls;
    assert.equal(create.auth, "Bearer persona_sandbox_test");
    assert.deepEqual(create.body, {
      data: { attributes: { "inquiry-template-id": "itmpl_member" } },
      meta: { "auto-create-inquiry-session": true, "auto-create-account": false },
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
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => v.startVerification(sql, id, "member", Date.now(), p.deps)),
    );
    const started = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    assert.ok(started.length > 0);
    for (const result of results)
      if (result.status === "rejected") {
        assert.ok(result.reason instanceof svc.PaceError);
        assert.equal(result.reason.status, 409);
      }
    assert.equal(new Set(started.map((x) => x.id)).size, 1);
    const creates = p.calls.filter((x) => x.path === "/inquiries");
    assert.equal(creates.length, 1);
    assert.ok(creates[0].idempotency);
    assert.equal(creates[0].idempotency.includes(id), false);
    assert.equal(
      (await v.startVerification(sql, id, "member", Date.now(), p.deps)).id,
      started[0].id,
    );
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

  it("redaction revokes retained approved status and is terminal, even when delivered late", async () => {
    const id = await member("RedactedWebhook");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    const now = Date.now() + 1000;
    await deliver(event(inquiry, null, "approved", undefined, now), now);
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "approved");
    const redacted = JSON.parse(event(inquiry, null, "approved", undefined, now - 1));
    redacted.data.attributes.name = "inquiry.redacted";
    assert.equal((await deliver(JSON.stringify(redacted), now)).outcome, "redacted");
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "none");
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
    // A newer unrelated event can still carry Persona's retained approved word.
    await deliver(event(inquiry, null, "approved", undefined, now + 1), now + 1);
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "none");
    assert.equal(
      (await sql`select status from verifications where id = ${started.id}`)[0].status,
      "redacted",
    );
    const replacement = await v.startVerification(sql, id, "member", now + 2, p.deps);
    assert.notEqual(replacement.id, started.id);
    assert.notEqual(inquiryOf(replacement.url), inquiry);
    assert.equal(p.calls.filter((call) => call.path.endsWith("/resume")).length, 0);
    assert.equal(p.calls.filter((call) => call.path === "/inquiries").length, 2);
  });

  it("refresh treats redacted-at as revoked evidence while preserving the other tier", async () => {
    const id = await member("RedactedRefresh");
    const p = fakePersona();
    const memberCheck = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const idCheck = await v.startVerification(sql, id, "government_id", Date.now(), p.deps);
    const now = Date.now() + 1000;
    await deliver(event(inquiryOf(memberCheck.url), null, "approved", undefined, now), now);
    await deliver(event(inquiryOf(idCheck.url), null, "approved", undefined, now), now);
    p.statuses.set(inquiryOf(memberCheck.url), "approved");
    p.control.edit = (body) => {
      body.data.attributes["redacted-at"] = new Date(now + 1).toISOString();
      body.data.attributes["updated-at"] = new Date(now + 1).toISOString();
    };
    const view = await v.refreshVerification(sql, id, memberCheck.id, now + 2, p.deps);
    assert.equal(view.member, "none");
    assert.equal(view.governmentId, "approved");
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, true);
    assert.equal(
      (await sql`select status from verifications where id = ${memberCheck.id}`)[0].status,
      "redacted",
    );
  });

  it("replaces a pending inquiry when resume discovers redaction without a session token", async () => {
    const id = await member("RedactedResume");
    const p = fakePersona();
    const first = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const firstInquiry = inquiryOf(first.url);
    const now = Date.now() + 1000;
    p.control.edit = (body) => {
      if (body.data.id !== firstInquiry) return;
      body.data.attributes["redacted-at"] = new Date(now).toISOString();
      body.data.attributes["updated-at"] = new Date(now).toISOString();
      delete body.meta["session-token"];
    };
    const next = await v.startVerification(sql, id, "member", now, p.deps);
    assert.notEqual(next.id, first.id);
    assert.notEqual(inquiryOf(next.url), firstInquiry);
    assert.equal(
      (await sql`select status from verifications where id = ${first.id}`)[0].status,
      "redacted",
    );
    assert.equal(p.calls.filter((call) => call.path === "/inquiries").length, 2);
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "pending");
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

describe("accountless inquiry binding", () => {
  it("pins owner, tier, template and environment before a null-reference approval can apply", async () => {
    const id = await member("LocalBinding");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    const [row] = await sql`select * from verifications where id = ${started.id}`;
    assert.equal(row.binding_version, 1);
    assert.equal(row.profile_id, id);
    assert.equal(row.provider_template_id, "itmpl_member");
    assert.equal(row.provider_environment, "sandbox");
    assert.equal(
      (await sql`select id from persona_creation_intents where profile_id = ${id}`).length,
      0,
    );
    const approved = event(inquiry, null, "approved", `evt_binding_${id}`);
    for (const edit of [
      (body: ReturnType<typeof JSON.parse>) => {
        body.data.attributes.payload.data.relationships["inquiry-template"].data.id = "itmpl_govid";
      },
      (body: ReturnType<typeof JSON.parse>) => {
        delete body.data.attributes.payload.data.relationships["inquiry-template"];
      },
      (body: ReturnType<typeof JSON.parse>) => {
        delete body.data.attributes.payload.data.relationships.account;
      },
      (body: ReturnType<typeof JSON.parse>) => {
        body.data.attributes.payload.data.attributes["reference-id"] = "someone_else";
      },
    ]) {
      const body = JSON.parse(approved);
      edit(body);
      assert.equal((await deliver(JSON.stringify(body))).outcome, "unknown_inquiry");
      assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
    }
    assert.equal(
      (await deliver(approved)).outcome,
      "approved",
      "invalid deliveries cannot consume the valid event ID",
    );
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, true);
  });

  it("does not reinterpret an injected legacy row as an accountless binding", async () => {
    const id = await member("LegacyBinding");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    await sql`update verifications set binding_version = 0, provider_template_id = null where id = ${started.id}`;
    p.statuses.set(inquiry, "approved");
    await rejects(v.refreshVerification(sql, id, started.id, Date.now(), p.deps), 409);
    assert.equal((await deliver(event(inquiry, null, "approved"))).outcome, "unknown_inquiry");
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
    assert.equal(
      (await deliver(event(inquiry, id, "approved"))).outcome,
      "approved",
      "legacy still needs an exact provider reference",
    );
  });

  it("rejects old inquiries on refresh and webhook after a newer attempt exists", async () => {
    const id = await member("SupersededNull");
    const p = fakePersona();
    const first = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const oldInquiry = inquiryOf(first.url);
    await deliver(event(oldInquiry, null, "declined"));
    const second = await v.startVerification(sql, id, "member", Date.now() + 1, p.deps);
    p.statuses.set(oldInquiry, "approved");
    await rejects(
      v.refreshVerification(sql, id, first.id, Date.now(), p.deps),
      409,
      /no longer active/,
    );
    assert.equal(
      (await deliver(event(oldInquiry, null, "approved"))).outcome,
      "superseded_inquiry",
    );
    assert.equal((await v.getVerification(sql, id, p.deps)).member, "pending");
    assert.notEqual(first.id, second.id);
  });

  it("never promotes a sandbox binding or discards its cleanup using a production key", async () => {
    const id = await member("EnvironmentBinding");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    const production = {
      ...p.deps,
      env: { ...PERSONA, PERSONA_API_KEY: "persona_production_test", VERCEL_ENV: "production" },
    };
    const before = p.calls.length;
    await rejects(
      v.refreshVerification(sql, id, started.id, Date.now(), production),
      409,
      /different verification environment/,
    );
    const now = Date.now();
    const body = event(inquiry, null, "approved", undefined, now);
    assert.equal(
      (await v.handlePersonaWebhook(sql, body, sign(body, now), now, production)).outcome,
      "unknown_inquiry",
    );
    assert.equal(p.calls.length, before);
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
    await safety.deleteAccount(sql, id);
    assert.deepEqual(await v.retryPersonaRedactions(sql, Date.now(), production, [inquiry]), {
      redacted: 0,
      failed: 0,
    });
    assert.equal(
      (await sql`select provider_ref from persona_redaction_jobs where provider_ref = ${inquiry}`)
        .length,
      1,
    );
    assert.equal(p.calls.length, before);
    assert.equal((await v.retryPersonaRedactions(sql, Date.now(), p.deps, [inquiry])).redacted, 1);
  });

  it("durably cleans a rejected create and retains unexpected Account evidence for review", async () => {
    const id = await member("RejectedCreate");
    const p = fakePersona();
    p.control.edit = (body) => {
      body.data.relationships["inquiry-template"]!.data.id = "itmpl_govid";
    };
    await rejects(v.startVerification(sql, id, "member", Date.now(), p.deps), 409);
    assert.equal((await sql`select id from verifications where profile_id = ${id}`).length, 0);
    assert.equal(
      (await sql`select id from persona_creation_intents where profile_id = ${id}`).length,
      0,
    );
    const providerRef = `inq_${made}`;
    assert.equal(
      (
        await sql`select provider_ref from persona_redaction_jobs where provider_ref = ${providerRef}`
      ).length,
      1,
    );
    p.control.edit = (body) => {
      body.data.relationships.account = { data: { type: "account", id: "act_unexpected_create" } };
    };
    await rejects(v.startVerification(sql, id, "member", Date.now() + 1, p.deps), 409);
    const [review] = await sql`select * from persona_creation_intents where profile_id = ${id}`;
    assert.equal(review.state, "review_required");
    assert.equal(review.provider_account_ref, "act_unexpected_create");
    await safety.deleteAccount(sql, id);
    const [retained] = await sql`select * from persona_creation_intents where id = ${review.id}`;
    assert.equal(retained.profile_id, null);
    assert.equal(retained.tier, null);
    assert.equal(retained.review_reason, "account_detected");
  });

  it("preserves unknown legacy environments for review instead of trusting the current key", async () => {
    const id = await member("UnknownEnvironment");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    await sql`update verifications set binding_version = 0, provider_environment = null where id = ${started.id}`;
    const calls = p.calls.length;
    await rejects(v.refreshVerification(sql, id, started.id, Date.now(), p.deps), 409);
    assert.equal((await deliver(event(inquiry, id, "approved"))).outcome, "unknown_inquiry");
    assert.equal(p.calls.length, calls);
    await safety.deleteAccount(sql, id);
    for (const env of [
      PERSONA,
      { ...PERSONA, PERSONA_API_KEY: "persona_production_test", VERCEL_ENV: "production" },
    ]) {
      assert.deepEqual(
        await v.retryPersonaRedactions(sql, Date.now(), { ...p.deps, env }, [inquiry]),
        { redacted: 0, failed: 0 },
      );
    }
    assert.equal(
      (
        await sql`select provider_ref from persona_redaction_jobs where provider_ref = ${inquiry} and provider_environment is null`
      ).length,
      1,
    );
    assert.equal(
      p.calls.length,
      calls,
      "no current-environment 404 can discharge an unattributed obligation",
    );
  });

  it("rejects Account links discovered after binding and preserves opaque review work", async () => {
    const id = await member("LaterAccount");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    p.statuses.set(inquiry, "approved");
    p.control.edit = (body) => {
      body.data.relationships.account = { data: { type: "account", id: "act_later" } };
    };
    await rejects(v.refreshVerification(sql, id, started.id, Date.now(), p.deps), 409);
    const [review] =
      await sql`select * from persona_creation_intents where provider_ref = ${inquiry}`;
    assert.equal(review.profile_id, null);
    assert.equal(review.state, "review_required");
    assert.equal(review.provider_account_ref, "act_later");
    const body = JSON.parse(event(inquiry, null, "approved"));
    body.data.attributes.payload.data.relationships.account.data = {
      type: "account",
      id: "act_later",
    };
    assert.equal((await deliver(JSON.stringify(body))).outcome, "account_review_required");
    assert.equal((await svc.people(sql, [id]))[0].identityVerified, false);
  });

  it("deletion during a create queues the late inquiry without returning a hosted URL", async () => {
    const id = await member("DeleteDuringCreate");
    const p = fakePersona();
    let entered!: () => void;
    let release!: () => void;
    const seen = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = {
      ...p.deps,
      fetch: (async (input, init) => {
        const response = await p.deps.fetch(input, init);
        if (String(input).endsWith("/inquiries") && init?.method === "POST") {
          entered();
          await paused;
        }
        return response;
      }) as typeof fetch,
    };
    const finished = rejects(v.startVerification(sql, id, "member", Date.now(), deps), 409);
    await seen;
    const [intent] = await sql`select * from persona_creation_intents where profile_id = ${id}`;
    assert.ok(intent.first_dispatched_at);
    await safety.deleteAccount(sql, id);
    release();
    await finished;
    const inquiry = `inq_${made}`;
    assert.equal((await sql`select id from verifications where profile_id = ${id}`).length, 0);
    assert.equal(
      (await sql`select id from persona_creation_intents where id = ${intent.id}`).length,
      0,
    );
    assert.equal(
      (await sql`select provider_ref from persona_redaction_jobs where provider_ref = ${inquiry}`)
        .length,
      1,
    );
    assert.equal((await deliver(event(inquiry, null, "approved"))).outcome, "unknown_inquiry");
  });

  it("recovers a lost create after deletion with the same opaque request, then redacts", async () => {
    const id = await member("LostCreateDeleted");
    const p = fakePersona();
    let lost = false;
    const deps = {
      ...p.deps,
      fetch: (async (input, init) => {
        const response = await p.deps.fetch(input, init);
        if (!lost && String(input).endsWith("/inquiries") && init?.method === "POST") {
          lost = true;
          throw new Error("synthetic lost response");
        }
        return response;
      }) as typeof fetch,
    };
    const now = Date.now();
    await rejects(v.startVerification(sql, id, "member", now, deps), 409);
    await safety.deleteAccount(sql, id);
    const [intent] =
      await sql`select * from persona_creation_intents where idempotency_key = ${p.calls[0].idempotency}`;
    assert.equal(intent.profile_id, null);
    assert.equal(intent.cancel_requested, true);
    assert.equal(JSON.stringify(intent).includes(id), false);
    const before = made;
    const paused = { ...deps, env: { ...PERSONA, PERSONA_VERIFICATION_ENABLED: "0" } };
    assert.equal((await v.recoverPersonaCreations(sql, now + 10_000, paused)).reconciled, 1);
    assert.equal(made, before, "idempotent replay did not create a second inquiry");
    const creates = p.calls.filter((call) => call.path === "/inquiries");
    assert.equal(creates.length, 2);
    assert.deepEqual(creates[0].body, creates[1].body);
    assert.equal(creates[0].idempotency, creates[1].idempotency);
    const inquiry = `inq_${before}`;
    assert.equal((await v.retryPersonaRedactions(sql, now + 10_000, paused, [inquiry])).redacted, 1);
    assert.equal(
      (await sql`select id from persona_creation_intents where id = ${intent.id}`).length,
      0,
    );
  });

  it("leaves never-dispatched intents paused until verification reopens", async () => {
    const id = await member("PausedBeforeDispatch");
    const p = fakePersona();
    const now = Date.now();
    const intent = await preparePersonaCreationIntent(sql, {
      profileId: id, tier: "member", templateId: "itmpl_member", environment: "sandbox", bindingVersion: 1,
    }, now);
    const paused = { ...p.deps, env: { ...PERSONA, PERSONA_VERIFICATION_ENABLED: "0" } };
    assert.deepEqual(await v.recoverPersonaCreations(sql, now, paused), { bound: 0, reconciled: 0, failed: 0 });
    assert.equal(p.calls.length, 0);
    const [row] = await sql`select first_dispatched_at from persona_creation_intents where id = ${intent.id}`;
    assert.equal(row.first_dispatched_at, null);
    assert.equal((await v.recoverPersonaCreations(sql, now + 1, p.deps)).bound, 1);
    assert.equal(p.calls.filter((call) => call.path === "/inquiries").length, 1);
    assert.equal((await sql`select id from persona_creation_intents where id = ${intent.id}`).length, 0);
  });
});

describe("verification lifecycle races", () => {
  it("rechecks the decline budget between preflight and durable intent creation", async () => {
    const id = await member("DeclineBudgetRace");
    const p = fakePersona();
    const now = Date.now();
    const addDecline = async (suffix: string) => {
      await sql`insert into verifications (id, profile_id, tier, provider, status, created_at, updated_at)
        values (${`ver_budget_${id}_${suffix}`}, ${id}, 'member', 'dev', 'declined', ${new Date(now - 1000)}, ${new Date(now)})`;
    };
    await addDecline("one");
    await addDecline("two");
    let transactions = 0;
    const racing = ((strings: TemplateStringsArray, ...values: unknown[]) =>
      sql(strings, ...values)) as Sql;
    racing.query = sql.query;
    racing.transaction = async (callback) => {
      if (++transactions === 2) await addDecline("three");
      return sql.transaction(callback);
    };
    await rejects(v.startVerification(racing, id, "member", now, p.deps), 409, /three tries/);
    assert.equal(p.calls.length, 0);
    assert.equal(
      (await sql`select id from persona_creation_intents where profile_id = ${id}`).length,
      0,
    );
  });

  it("a refresh response arriving after deletion cannot restore a badge", async () => {
    const id = await member("DeleteDuringRefresh");
    const p = fakePersona();
    const started = await v.startVerification(sql, id, "member", Date.now(), p.deps);
    const inquiry = inquiryOf(started.url);
    p.statuses.set(inquiry, "approved");
    let entered!: () => void;
    let release!: () => void;
    const seen = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = {
      ...p.deps,
      fetch: (async (input, init) => {
        const response = await p.deps.fetch(input, init);
        if (init?.method === "GET") {
          entered();
          await paused;
        }
        return response;
      }) as typeof fetch,
    };
    const finished = rejects(
      v.refreshVerification(sql, id, started.id, Date.now(), deps),
      409,
      /no longer active/,
    );
    await seen;
    await safety.deleteAccount(sql, id);
    release();
    await finished;
    const [owner] =
      await sql`select deleted_at, identity_verified, verified_member_at from profiles where id = ${id}`;
    assert.ok(owner.deleted_at);
    assert.equal(owner.identity_verified, false);
    assert.equal(owner.verified_member_at, null);
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
