import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins";
import { authRequestPolicy } from "../../../mobile/src/lib/auth-request-policy.ts";

const origin = "https://samepace-native-auth.example.test";
const staleCookie = "__Host-grok-auth.session_token=synthetic-stale-cookie";
const invalidIdentity = { provider: "apple", idToken: { token: "synthetic-invalid-token" } };

function fixture() {
  const database = { user: [], account: [], session: [], verification: [] };
  let verificationCalls = 0;
  const auth = betterAuth({
    baseURL: origin,
    secret: "synthetic-auth-origin-test-secret-at-least-32-characters",
    database: memoryAdapter(database),
    trustedOrigins: [origin],
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
      cookies: { session_token: { name: "__Host-grok-auth.session_token" } },
    },
    plugins: [bearer()],
    socialProviders: {
      apple: {
        clientId: "app.samepace",
        appBundleIdentifier: "app.samepace",
        // Only the provider boundary is stubbed. The actual Better Auth router,
        // origin middleware, token rejection and session plugin run unchanged.
        verifyIdToken: async () => {
          verificationCalls++;
          return false;
        },
        getUserInfo: async () => {
          throw new Error("An invalid identity must never reach user-info lookup.");
        },
      },
    },
  });
  const post = (path: string, headers: Record<string, string>, body: unknown) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  return { auth, database, post, verificationCalls: () => verificationCalls };
}

async function errorCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).code, code);
}

describe("native auth transport with real Better Auth middleware", () => {
  it("reproduces the cookie-jar failure, while the native policy reaches token verification without trusting an invalid Apple identity", async () => {
    const f = fixture();
    await errorCode(
      await f.post("/sign-in/social", { cookie: staleCookie }, invalidIdentity),
      403,
      "MISSING_OR_NULL_ORIGIN",
    );
    assert.equal(f.verificationCalls(), 0);

    const policy = authRequestPolicy(`${origin}/`, "ios");
    assert.equal(policy.credentials, "omit", "Native auth must not rely on the OS cookie jar.");
    assert.equal(policy.headers.origin, origin);
    await errorCode(
      await f.post("/sign-in/social", policy.headers, invalidIdentity),
      401,
      "INVALID_TOKEN",
    );
    assert.equal(f.verificationCalls(), 1);

    // The explicit trusted origin also handles native runtimes retaining a
    // cookie despite the request's credentials policy; server guards stay on.
    await errorCode(
      await f.post("/sign-in/social", { ...policy.headers, cookie: staleCookie }, invalidIdentity),
      401,
      "INVALID_TOKEN",
    );
    assert.equal(f.verificationCalls(), 2);
    assert.equal(f.database.user.length, 0);
    assert.equal(f.database.account.length, 0);
    assert.equal(f.database.session.length, 0);
  });

  it("leaves browser Origin/credential handling alone, and still rejects null, cross-site and sibling origins carrying cookies", async () => {
    const f = fixture();
    assert.deepEqual(authRequestPolicy(origin, "web"), { headers: {} });
    for (const test of [
      { origin: "null", site: "same-origin", code: "MISSING_OR_NULL_ORIGIN" },
      { origin: "https://attacker.example.invalid", site: "cross-site", code: "INVALID_ORIGIN" },
      { origin: "https://sibling.example.test", site: "same-site", code: "INVALID_ORIGIN" },
    ]) {
      const policy = authRequestPolicy(origin, "web");
      await errorCode(
        await f.post(
          "/sign-in/social",
          {
            cookie: staleCookie,
            origin: test.origin,
            "sec-fetch-site": test.site,
            "sec-fetch-mode": "cors",
            ...policy.headers,
          },
          invalidIdentity,
        ),
        403,
        test.code,
      );
    }
    assert.equal(f.verificationCalls(), 0);
    assert.equal(f.database.user.length, 0);
    assert.equal(f.database.session.length, 0);
  });

  it("continues to validate redirect destinations even when the native API origin is trusted", async () => {
    const f = fixture();
    const policy = authRequestPolicy(origin, "ios");
    await errorCode(
      await f.post("/sign-in/social", policy.headers, {
        ...invalidIdentity,
        callbackURL: "https://attacker.example.invalid/capture",
      }),
      403,
      "INVALID_CALLBACK_URL",
    );
    assert.equal(f.verificationCalls(), 0);
    assert.equal(f.database.session.length, 0);
  });

  it("keeps cookie-free native sign-in supported and rejects synthetic bearer-plus-invalid-identity requests", async () => {
    const f = fixture();
    await errorCode(await f.post("/sign-in/social", {}, invalidIdentity), 401, "INVALID_TOKEN");
    await errorCode(
      await f.post(
        "/sign-in/social",
        { authorization: "Bearer synthetic-stale-session" },
        invalidIdentity,
      ),
      401,
      "INVALID_TOKEN",
    );
    assert.equal(f.verificationCalls(), 2);
    assert.equal(f.database.user.length, 0);
    assert.equal(f.database.session.length, 0);
  });

  it("signs out only the explicit bearer session, even with an unrelated stale cookie, and invalidates that token", async () => {
    const f = fixture();
    const policy = authRequestPolicy(origin, "ios");
    async function signup(label: string) {
      const response = await f.post("/sign-up/email", policy.headers, {
        name: `Synthetic ${label}`,
        email: `${label}@example.test`,
        password: "Synthetic-native-origin-password-42",
      });
      assert.equal(response.status, 200);
      const token = response.headers.get("set-auth-token");
      assert.ok(token);
      return token;
    }
    const first = await signup("first"),
      second = await signup("second");
    const session = (token: string) =>
      f.auth.handler(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
    assert.equal(f.database.session.length, 2);
    assert.ok((await (await session(second)).json()).user);
    const signedOut = await f.post(
      "/sign-out",
      {
        ...policy.headers,
        authorization: `Bearer ${second}`,
        cookie: staleCookie,
      },
      {},
    );
    assert.equal(signedOut.status, 200);
    assert.equal(f.database.session.length, 1);
    assert.equal(await (await session(second)).json(), null);
    assert.ok((await (await session(first)).json()).user);

    const staleSignOut = await f.post(
      "/sign-out",
      {
        ...policy.headers,
        authorization: "Bearer synthetic-stale-session",
      },
      {},
    );
    assert.equal(staleSignOut.status, 200);
    assert.equal(
      f.database.session.length,
      1,
      "A stale token must not remove another member's session.",
    );
    assert.ok((await (await session(first)).json()).user);
  });
});
