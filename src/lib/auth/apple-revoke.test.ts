import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as svc from "../pace/service.server.ts";
import * as apple from "./apple-revoke.server.ts";

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

  it("never blocks a deletion when Apple is unreachable", async () => {
    configure();
    const ok = async () => Response.json({ refresh_token: "r2" });
    await apple.storeAppleAuthorization(sql, "ann", "code", { fetch: ok });
    const down = async () => {
      throw new Error("network");
    };
    assert.equal(await apple.revokeAppleAccess(sql, "ann", { fetch: down }), false);
    assert.deepEqual(await sql`select 1 from apple_tokens`, []);
  });
});
