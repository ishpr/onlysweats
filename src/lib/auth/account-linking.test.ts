import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { accountLinkingPolicy } from "./account-linking.ts";

describe("social account ownership", () => {
  it("rejects auto-linking to an unverified signup and accepts it after local verification", async () => {
    const database = { user: [], account: [], session: [], verification: [] };
    const auth = betterAuth({
      database: memoryAdapter(database),
      secret: "a-test-secret-at-least-thirty-two-characters-long",
      baseURL: "http://localhost:8080",
      emailAndPassword: { enabled: true },
      account: { accountLinking: { ...accountLinkingPolicy, trustedProviders: ["google"] } },
      logger: { disabled: true },
      socialProviders: {
        google: {
          clientId: "test-google",
          // Stub only the identity-provider boundary; use Better Auth's actual
          // sign-in, local account lookup, linking policy and session creation.
          verifyIdToken: async () => true,
          getUserInfo: async () => ({
            user: {
              id: "google-subject",
              name: "Verified person",
              email: "owner@example.com",
              emailVerified: true,
            },
            data: {},
          }),
        },
      },
    });
    const signup = await auth.api.signUpEmail({
      body: {
        name: "Local signup",
        email: "owner@example.com",
        password: "password-before-social",
      },
    });
    const signIn = () =>
      auth.api.signInSocial({
        body: { provider: "google", idToken: { token: "provider-verified-fixture" } },
        asResponse: true,
      });
    const rejected = await signIn();
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).code, "OAUTH_LINK_ERROR");
    assert.equal(
      database.account.length,
      1,
      "social account was not attached to the unverified signup",
    );

    await (await auth.$context).internalAdapter.updateUser(signup.user.id, { emailVerified: true });
    const accepted = await signIn();
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).user.id, signup.user.id);
    assert.equal(database.account.length, 2);
    assert.equal((await signIn()).status, 200, "the now-linked identity can sign in again");
    assert.equal(database.account.length, 2, "repeat sign-in does not duplicate a link");
  });
});
