import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { makeDb } from "./test-db.ts";
import {
  personaCaseCleanupConfigured,
  queuePersonaCaseCleanup,
  retryPersonaCaseCleanup,
} from "./persona-case-cleanup.server.ts";
import * as verification from "./verification.server.ts";
import * as svc from "./service.server.ts";
import * as safety from "./safety.server.ts";

const ENV = {
  PERSONA_API_KEY: "persona_sandbox_runtime",
  PERSONA_CASE_CLEANUP_API_KEY: "persona_sandbox_cleanup",
  PERSONA_CASE_TEMPLATE_IDS: "ctmpl_samepace",
  VERCEL_ENV: "preview",
};
let sql: Sql;
before(async () => {
  sql = await makeDb();
});
type Case = ReturnType<typeof item>;
function item(id: string, ref: string) {
  return {
    type: "case",
    id,
    attributes: { "redacted-at": null as string | null },
    relationships: {
      inquiries: { data: [{ id: ref, type: "inquiry" }] },
      accounts: { data: [] as { id: string; type: string }[] },
      "case-template": { data: { id: "ctmpl_samepace", type: "case-template" } },
    },
  };
}
function provider(cases: Case[]) {
  const calls: { method: string; path: string; auth: string | null }[] = [];
  const state = {
    fail: false,
    unconfirmed: false,
    unexpectedPage: false,
    mutateOnGet: false,
    missingLinks: false,
    wrongContext: false,
  };
  const doFetch = (async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname + url.search,
      auth: new Headers(init?.headers).get("authorization"),
    });
    if (state.fail) return new Response("", { status: 503 });
    const headers = {
      "persona-organization-id": "org_samepace",
      "persona-environment-id": "env_sandbox",
    };
    if (url.pathname.startsWith("/api/v1/inquiries/"))
      return Response.json(
        { data: { type: "inquiry", id: url.pathname.split("/").at(-1) } },
        { headers },
      );
    if (state.wrongContext) headers["persona-environment-id"] = "env_other_sandbox";
    if (url.pathname === "/api/v1/cases") {
      assert.equal(method, "GET");
      const ref = url.searchParams.get("filter[inquiry-id]");
      assert.ok(ref);
      assert.equal(url.searchParams.has("filter[account-id]"), false);
      const after = url.searchParams.get("page[after]");
      const size = Number(url.searchParams.get("page[size]"));
      const eligible = state.unexpectedPage
        ? cases
        : cases.filter((x) => x.relationships.inquiries.data.some((q) => q.id === ref));
      const start = after ? eligible.findIndex((x) => x.id === after) + 1 : 0;
      const data = eligible.slice(start, start + size);
      return Response.json(
        {
          data,
          ...(state.missingLinks
            ? {}
            : {
                links: {
                  next:
                    start + size < eligible.length
                      ? "/api/v1/cases?page[after]=" + data.at(-1)!.id
                      : null,
                },
              }),
        },
        { headers },
      );
    }
    const c = cases.find((x) => url.pathname === "/api/v1/cases/" + x.id);
    if (!c) return new Response("", { status: 404 });
    if (state.mutateOnGet && method === "GET")
      c.relationships.accounts.data.push({ id: "act_unexpected", type: "account" });
    if (method === "DELETE" && !state.unconfirmed)
      c.attributes["redacted-at"] = new Date().toISOString();
    return Response.json({ data: c }, { headers });
  }) as typeof fetch;
  return { calls, state, deps: { env: ENV, fetch: doFetch } };
}
async function job(ref: string) {
  return (await sql`select * from persona_case_cleanup_jobs where provider_ref=${ref}`)[0];
}

describe("Persona Case cleanup", () => {
  it("requires a dedicated environment-matching key and exact template allowlist", async () => {
    assert.equal(personaCaseCleanupConfigured(ENV), true);
    for (const env of [
      { ...ENV, PERSONA_CASE_CLEANUP_API_KEY: undefined },
      { ...ENV, PERSONA_CASE_CLEANUP_API_KEY: ENV.PERSONA_API_KEY },
      { ...ENV, PERSONA_CASE_CLEANUP_API_KEY: "persona_production_cleanup" },
      { ...ENV, PERSONA_CASE_TEMPLATE_IDS: "*" },
      { ...ENV, PERSONA_CASE_TEMPLATE_IDS: "" },
      { ...ENV, VERCEL_ENV: "production" },
    ])
      assert.equal(personaCaseCleanupConfigured(env), false);
    const production = {
      ...ENV,
      VERCEL_ENV: "production",
      PERSONA_VERIFICATION_ENABLED: "1",
      PERSONA_API_KEY: "persona_production_runtime",
      PERSONA_CASE_CLEANUP_API_KEY: "persona_production_cleanup",
    };
    assert.equal(personaCaseCleanupConfigured(production), true);
    assert.equal(verification.providerFor(production), "persona");
    assert.equal(
      verification.providerFor({ ...production, PERSONA_CASE_CLEANUP_API_KEY: undefined }),
      null,
    );
  });

  it("does not create a production hosted inquiry without cleanup configuration", async () => {
    const id = "case_production_guard";
    await sql`insert into "user"(id,name,email,"emailVerified") values(${id},'Synthetic',${id + "@example.test"},true)`;
    await svc.ensureProfile(sql, { id, name: "Synthetic", email: id + "@example.test" });
    let called = false;
    await assert.rejects(
      verification.startVerification(sql, id, "member", Date.now(), {
        env: {
          VERCEL_ENV: "production",
          PERSONA_VERIFICATION_ENABLED: "1",
          PERSONA_API_KEY: "persona_production_runtime",
          PERSONA_TEMPLATE_MEMBER: "itmpl_member",
        },
        fetch: (async () => {
          called = true;
          throw Error("unexpected");
        }) as typeof fetch,
      }),
      (err: unknown) => err instanceof svc.PaceError && err.status === 409,
    );
    assert.equal(called, false);
    assert.equal(
      (await sql`select id from persona_creation_intents where profile_id=${id}`).length,
      0,
    );
  });

  it("retains obligations through missing keys, provider outages and inquiry deletion success", async () => {
    const ref = "inq_case_retry",
      p = provider([item("case_retry", ref)]),
      now = Date.now();
    await sql`insert into persona_redaction_jobs(provider_ref,provider_environment,next_attempt_at) values(${ref},'sandbox',${new Date(now).toISOString()})`;
    await verification.retryPersonaRedactions(
      sql,
      now,
      { env: ENV, fetch: (async () => new Response(null, { status: 204 })) as typeof fetch },
      [ref],
    );
    assert.equal(
      (await sql`select provider_ref from persona_redaction_jobs where provider_ref=${ref}`).length,
      0,
    );
    assert.equal((await job(ref)).state, "queued");
    await retryPersonaCaseCleanup(
      sql,
      now,
      { ...p.deps, env: { PERSONA_API_KEY: ENV.PERSONA_API_KEY } },
      [ref],
    );
    assert.equal(p.calls.length, 0);
    p.state.fail = true;
    assert.equal((await retryPersonaCaseCleanup(sql, now, p.deps, [ref])).failed, 1);
    assert.equal((await job(ref)).state, "failed");
    p.state.fail = false;
    assert.deepEqual(await retryPersonaCaseCleanup(sql, now + 300_000, p.deps, [ref]), {
      verified: 1,
      redacted: 1,
      failed: 0,
      reviewRequired: 0,
    });
    assert.equal((await job(ref)).state, "monitoring");
    assert.ok(
      p.calls
        .filter((c) => c.path.startsWith("/api/v1/cases"))
        .every((c) => c.auth === "Bearer " + ENV.PERSONA_CASE_CLEANUP_API_KEY),
    );
    assert.ok(
      p.calls
        .filter((c) => c.path.startsWith("/api/v1/inquiries/"))
        .every((c) => c.auth === "Bearer " + ENV.PERSONA_API_KEY),
    );
  });

  it("commits an independent Case obligation before account rows are removed", async () => {
    const id = "case_deleted_member",
      ref = "inq_case_deleted_member";
    await sql`insert into "user"(id,name,email,"emailVerified") values(${id},'Synthetic',${id + "@example.test"},true)`;
    await svc.ensureProfile(sql, { id, name: "Synthetic", email: id + "@example.test" });
    await sql`insert into verifications(id,profile_id,tier,provider,provider_ref,status,binding_version,provider_environment,provider_template_id)
      values('ver_case_deleted',${id},'member','persona',${ref},'needs_review',1,'sandbox','itmpl_member')`;
    await safety.deleteAccount(sql, id);
    const retained = await job(ref);
    assert.equal(retained.provider_environment, "sandbox");
    assert.equal(Object.values(retained).includes(id), false);
    assert.equal((await sql`select id from verifications where profile_id=${id}`).length, 0);
  });

  it("never redacts a Case with other owners, Accounts, wrong templates or changed bindings", async () => {
    for (const kind of ["wrong_inquiry", "multiple", "account", "template", "changed"]) {
      const ref = "inq_case_" + kind,
        c = item("case_" + kind, ref),
        p = provider([c]);
      if (kind === "wrong_inquiry") {
        c.relationships.inquiries.data[0].id = "inq_somebody_else";
        p.state.unexpectedPage = true;
      }
      if (kind === "multiple")
        c.relationships.inquiries.data.push({ id: "inq_other", type: "inquiry" });
      if (kind === "account")
        c.relationships.accounts.data.push({ id: "act_other", type: "account" });
      if (kind === "template") c.relationships["case-template"].data.id = "ctmpl_other";
      if (kind === "changed") p.state.mutateOnGet = true;
      await queuePersonaCaseCleanup(sql, ref, "sandbox");
      assert.equal(
        (await retryPersonaCaseCleanup(sql, Date.now(), p.deps, [ref])).reviewRequired,
        1,
      );
      assert.equal(
        p.calls.some((call) => call.method === "DELETE"),
        false,
      );
      assert.equal((await job(ref)).state, "review_required");
    }
  });

  it("requires redaction confirmation and safely retries an already redacted Case", async () => {
    const ref = "inq_case_confirm",
      c = item("case_confirm", ref),
      p = provider([c]),
      now = Date.now();
    await queuePersonaCaseCleanup(sql, ref, "sandbox", now);
    p.state.unconfirmed = true;
    assert.equal((await retryPersonaCaseCleanup(sql, now, p.deps, [ref])).failed, 1);
    assert.equal((await job(ref)).last_verified_at, null);
    c.attributes["redacted-at"] = new Date(now).toISOString();
    const before = p.calls.length;
    assert.equal((await retryPersonaCaseCleanup(sql, now + 300_000, p.deps, [ref])).verified, 1);
    assert.equal(
      p.calls.slice(before).some((call) => call.method === "DELETE"),
      false,
    );
  });

  it("paginates bounded pages without losing work and rescans receipts for late-created Cases", async () => {
    const ref = "inq_case_pages",
      cases = [1, 2, 3, 4, 5].map((n) => item("case_page_" + n, ref)),
      p = provider(cases),
      now = Date.now();
    await queuePersonaCaseCleanup(sql, ref, "sandbox", now);
    let result = await retryPersonaCaseCleanup(sql, now, p.deps, [ref]);
    assert.equal(result.redacted, 2);
    assert.equal((await job(ref)).state, "queued");
    assert.equal((await job(ref)).cursor_ref, "case_page_2");
    result = await retryPersonaCaseCleanup(sql, now + 61_000, p.deps, [ref]);
    assert.equal(result.redacted, 2);
    result = await retryPersonaCaseCleanup(sql, now + 122_000, p.deps, [ref]);
    assert.equal(result.redacted, 1);
    assert.equal(result.verified, 1);
    cases.unshift(item("case_late_created", ref));
    await retryPersonaCaseCleanup(sql, now + 86_600_000, p.deps, [ref]);
    assert.ok(cases[0].attributes["redacted-at"]);
    assert.equal((await job(ref)).state, "queued");
    assert.ok((await job(ref)).created_at);
  });

  it("does not use a current key to clear an unknown or different environment", async () => {
    const p = provider([]),
      now = Date.now();
    for (const environment of [null, "production"] as const) {
      const ref = "inq_case_env_" + environment;
      await queuePersonaCaseCleanup(sql, ref, environment, now);
      assert.deepEqual(await retryPersonaCaseCleanup(sql, now, p.deps, [ref]), {
        verified: 0,
        redacted: 0,
        failed: 0,
        reviewRequired: 0,
      });
      assert.equal((await job(ref)).state, environment ? "queued" : "review_required");
      if (!environment)
        assert.equal((await job(ref)).review_reason, "unknown_provider_environment");
    }
    assert.equal(p.calls.length, 0);
  });

  it("does not mistake an incomplete page response for completed discovery", async () => {
    const ref = "inq_case_incomplete_page",
      p = provider([]);
    p.state.missingLinks = true;
    await queuePersonaCaseCleanup(sql, ref, "sandbox");
    assert.equal((await retryPersonaCaseCleanup(sql, Date.now(), p.deps, [ref])).reviewRequired, 1);
    assert.equal((await job(ref)).last_verified_at, null);
  });

  it("refuses Case credentials from another provider environment before any redaction", async () => {
    const ref = "inq_case_wrong_context",
      p = provider([item("case_wrong_context", ref)]);
    p.state.wrongContext = true;
    await queuePersonaCaseCleanup(sql, ref, "sandbox");
    assert.equal((await retryPersonaCaseCleanup(sql, Date.now(), p.deps, [ref])).reviewRequired, 1);
    assert.equal((await job(ref)).review_reason, "provider_context_mismatch");
    assert.equal(
      p.calls.some((c) => c.method === "DELETE"),
      false,
    );
  });
});
