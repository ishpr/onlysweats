import { test } from "node:test";
import assert from "node:assert/strict";
import { postgresTestDatabase } from "../workout-plans/postgres-test-db.ts";
import { queuePersonaCaseCleanup, retryPersonaCaseCleanup } from "./persona-case-cleanup.server.ts";

test(
  "real Postgres Case cleanup leases prevent concurrent redaction",
  {
    skip: !process.env.SAMEPACE_TEST_DATABASE_URL,
    timeout: 30000,
  },
  async () => {
    const db = await postgresTestDatabase(process.env.SAMEPACE_TEST_DATABASE_URL!);
    const ref = "inq_concurrent_case_cleanup",
      now = Date.now();
    const env = {
      VERCEL_ENV: "preview",
      PERSONA_API_KEY: "persona_sandbox_runtime",
      PERSONA_CASE_CLEANUP_API_KEY: "persona_sandbox_cleanup",
      PERSONA_CASE_TEMPLATE_IDS: "ctmpl_concurrent",
    };
    let entered!: () => void, resume!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let requests = 0,
      deletes = 0;
    const value = {
      id: "case_concurrent_cleanup",
      type: "case",
      attributes: { "redacted-at": null as string | null },
      relationships: {
        inquiries: { data: [{ id: ref, type: "inquiry" }] },
        accounts: { data: [] },
        "case-template": { data: { id: "ctmpl_concurrent", type: "case-template" } },
      },
    };
    const fetch = (async (input, init) => {
      const url = new URL(String(input));
      requests++;
      const headers = {
        "persona-organization-id": "org_test",
        "persona-environment-id": "env_test",
      };
      if (url.pathname === "/api/v1/inquiries/" + ref) {
        entered();
        await held;
        return Response.json({ data: { id: ref, type: "inquiry" } }, { headers });
      }
      if (url.pathname === "/api/v1/cases") {
        assert.equal(url.searchParams.get("filter[inquiry-id]"), ref);
        return Response.json({ data: [value], links: { next: null } }, { headers });
      }
      assert.equal(url.pathname, "/api/v1/cases/" + value.id);
      if (init?.method === "DELETE") {
        deletes++;
        value.attributes["redacted-at"] = new Date(now).toISOString();
      }
      return Response.json({ data: value }, { headers });
    }) as typeof globalThis.fetch;
    let first: ReturnType<typeof retryPersonaCaseCleanup> | undefined;
    try {
      await queuePersonaCaseCleanup(db.sql, ref, "sandbox", now);
      first = retryPersonaCaseCleanup(db.sql, now, { env, fetch }, [ref]);
      await Promise.race([
        started,
        first.then(() => assert.fail("First worker did not reach the provider.")),
      ]);
      const second = await retryPersonaCaseCleanup(db.sql, now, { env, fetch }, [ref]);
      assert.deepEqual(second, { verified: 0, redacted: 0, failed: 0, reviewRequired: 0 });
      assert.equal(
        requests,
        1,
        "The second worker must not call the provider under an active lease.",
      );
      resume();
      assert.deepEqual(await first, { verified: 1, redacted: 1, failed: 0, reviewRequired: 0 });
      assert.equal(deletes, 1);
      const [receipt] =
        await db.sql`select state,lease_token,last_verified_at from persona_case_cleanup_jobs where provider_ref=${ref}`;
      assert.equal(receipt.state, "monitoring");
      assert.equal(receipt.lease_token, null);
      assert.ok(receipt.last_verified_at);
    } finally {
      resume();
      await first?.catch(() => {});
      await db.close();
    }
  },
);
