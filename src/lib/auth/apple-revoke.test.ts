import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as svc from "../pace/service.server.ts";
import * as apple from "./apple-revoke.server.ts";
import { deleteAccount } from "../pace/safety.server.ts";

let sql: Sql;
const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const configure = () => {
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APPLE_TEAM_ID = "TEAM123456";
  process.env.APPLE_KEY_ID = "KEY1234567";
  process.env.APPLE_BUNDLE_ID = "app.samepace";
  // The way a PEM usually lands in a hosting dashboard: one line, literal \n.
  process.env.APPLE_PRIVATE_KEY = pem.replace(/\n/g, "\\n");
};

before(async () => {
  sql = await makeDb();
  await svc.ensureProfile(sql, { id: "ann", name: "Ann", email: null });
});

describe("Sign in with Apple revocation", () => {
  it("does nothing until the key is configured", async () => {
    delete process.env.APPLE_PRIVATE_KEY;
    assert.equal(apple.appleRevocationConfigured(), false);
    const fetch = async () => assert.fail("must not call Apple");
    assert.equal(await apple.storeAppleAuthorization(sql, "ann", "code", { fetch }), false);
    assert.equal(await apple.revokeAppleAccess(sql, "ann", { fetch }), false);
  });

  it("trades the code for a refresh token, seals it, and revokes it on delete", async () => {
    configure();
    const calls: { url: string; body: URLSearchParams }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) });
      return Response.json(url.endsWith("/token") ? { refresh_token: "r.secret" } : {});
    };

    assert.equal(await apple.storeAppleAuthorization(sql, "ann", "one-time-code", { fetch }), true);
    const [row] = await sql<{ refresh_token_enc: string }>`select * from apple_tokens`;
    assert.ok(!row.refresh_token_enc.includes("r.secret"), "never stored in the clear");
    assert.equal(await apple.unseal(row.refresh_token_enc), "r.secret");

    // The client secret is an ES256 JWT Apple can check against our public key.
    const [head, body, sig] = calls[0].body.get("client_secret")!.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), {
      alg: "ES256",
      kid: "KEY1234567",
    });
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    assert.equal(claims.iss, "TEAM123456");
    assert.equal(claims.sub, "app.samepace");
    assert.equal(claims.aud, "https://appleid.apple.com");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(`${head}.${body}`),
        { key: createPublicKey(pair.privateKey), dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      ),
    );

    assert.equal(await apple.revokeAppleAccess(sql, "ann", { fetch }), true);
    assert.equal(calls[1].url, "https://appleid.apple.com/auth/revoke");
    assert.equal(calls[1].body.get("token"), "r.secret");
    assert.deepEqual(await sql`select 1 from apple_tokens`, []);
  });

  it("keeps a sealed retry job when Apple is unreachable, then revokes after account deletion", async () => {
    configure();
    const ok = async () => Response.json({ refresh_token: "r2" });
    await apple.storeAppleAuthorization(sql, "ann", "code", { fetch: ok });
    const down = async () => {
      throw new Error("network");
    };
    const now = Date.now();
    assert.equal(await apple.revokeAppleAccess(sql, "ann", { fetch: down, now }), false);
    assert.deepEqual(await sql`select 1 from apple_tokens`, []);
    const [job] = await sql<{ id: string; refresh_token_enc: string; attempts: number }>`
      select id, refresh_token_enc, attempts from apple_revocation_jobs where state = 'pending'`;
    assert.equal(job.attempts, 1);
    assert.ok(!job.refresh_token_enc.includes("r2"));
    assert.equal(await apple.unseal(job.refresh_token_enc), "r2");
    await deleteAccount(sql, "ann", now);
    const [profile] = await sql<{
      deleted_at: Date | null;
    }>`select deleted_at from profiles where id = 'ann'`;
    assert.ok(profile.deleted_at, "provider outage did not block deletion");
    const early = await apple.retryAppleRevocations(sql, {
      fetch: async () => assert.fail("backoff"),
      now: now + 1,
    });
    assert.equal(early.revoked, 0);
    const retried = await apple.retryAppleRevocations(sql, {
      now: now + 5 * 60_000,
      fetch: async (_url, init) => {
        assert.equal(new URLSearchParams(String(init.body)).get("token"), "r2");
        return new Response(null, { status: 200 });
      },
    });
    assert.equal(retried.revoked, 1);
    const [finished] = await sql<{ refresh_token_enc: string | null; state: string }>`
      select refresh_token_enc, state from apple_revocation_jobs where id = ${job.id}`;
    assert.deepEqual(finished, { refresh_token_enc: null, state: "succeeded" });
    await apple.retryAppleRevocations(sql, {
      fetch: async () => assert.fail("already revoked"),
      now: now + 10 * 60_000,
    });
  });

  it("bounds revocation attempts and scrubs the retained credential", async () => {
    configure();
    const now = Date.now();
    await svc.ensureProfile(sql, { id: "bounded", name: "Bounded", email: null });
    await apple.storeAppleAuthorization(sql, "bounded", "code", {
      fetch: async () => Response.json({ refresh_token: "r.bounded" }),
    });
    let calls = 0;
    const down = async () => {
      calls += 1;
      return new Response(null, { status: 503 });
    };
    await apple.revokeAppleAccess(sql, "bounded", { fetch: down, now });
    for (let attempt = 1; attempt < 8; attempt += 1) {
      const [job] = await sql<{
        next_attempt_at: Date;
      }>`select next_attempt_at from apple_revocation_jobs where state = 'pending'`;
      assert.ok(job);
      await apple.retryAppleRevocations(sql, {
        fetch: down,
        now: new Date(job.next_attempt_at).getTime(),
      });
    }
    assert.equal(calls, 8);
    assert.deepEqual(
      await sql`select 1 from apple_revocation_jobs where refresh_token_enc is not null`,
      [],
    );
    await apple.retryAppleRevocations(sql, {
      fetch: async () => assert.fail("exhausted"),
      now: now + 7 * 24 * 60 * 60_000,
    });
  });

  it("expires sealed jobs even when signing credentials remain unavailable", async () => {
    configure();
    const now = Date.now();
    await svc.ensureProfile(sql, { id: "expiry", name: "Expiry", email: null });
    await apple.storeAppleAuthorization(sql, "expiry", "code", {
      fetch: async () => Response.json({ refresh_token: "r.expired" }),
    });
    delete process.env.APPLE_PRIVATE_KEY;
    await apple.revokeAppleAccess(sql, "expiry", {
      fetch: async () => assert.fail("unconfigured"),
      now,
    });
    assert.equal(
      (await sql`select 1 from apple_revocation_jobs where refresh_token_enc is not null`).length,
      1,
    );
    const result = await apple.retryAppleRevocations(sql, { now: now + 7 * 24 * 60 * 60_000 });
    assert.equal(result.exhausted, 1);
    assert.deepEqual(
      await sql`select 1 from apple_revocation_jobs where refresh_token_enc is not null`,
      [],
    );
    configure();
  });
});
