import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { vercelPreviewAuth } from "./vercel-preview.ts";

const deployment = "samepace-abc123-team.vercel.app";
const branch = "samepace-git-release-team.vercel.app";

describe("exact Vercel preview authentication hosts", () => {
  it("trusts only the supplied deployment and branch, with canonical HTTPS fallback", () => {
    assert.deepEqual(vercelPreviewAuth({ VERCEL_ENV: "preview", VERCEL_URL: deployment, VERCEL_BRANCH_URL: branch }), {
      allowedHosts: [deployment, branch], trustedOrigins: [`https://${deployment}`, `https://${branch}`], fallback: `https://${deployment}`,
    });
  });

  it("does not add hosts outside the exact preview environment", () => {
    for (const VERCEL_ENV of [undefined, "production", "development", "Preview", "staging"]) {
      assert.deepEqual(vercelPreviewAuth({ VERCEL_ENV, VERCEL_URL: deployment, VERCEL_BRANCH_URL: branch }), {
        allowedHosts: [], trustedOrigins: [], fallback: undefined,
      });
    }
  });

  it("normalizes duplicates and permits an exact custom deployment suffix", () => {
    assert.deepEqual(vercelPreviewAuth({ VERCEL_ENV: "preview", VERCEL_URL: ` ${deployment.toUpperCase()} `, VERCEL_BRANCH_URL: deployment }).allowedHosts, [deployment]);
    assert.deepEqual(vercelPreviewAuth({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "release.preview.example.com" }), {
      allowedHosts: ["release.preview.example.com"], trustedOrigins: ["https://release.preview.example.com"], fallback: "https://release.preview.example.com",
    });
  });

  it("rejects URL syntax, userinfo, ports, wildcards, local addresses and malformed DNS labels", () => {
    for (const invalid of [
      "", "localhost", "api.localhost", "app.local", "127.0.0.1", "127.1", "2130706433", "[::1]", "0x7f.1",
      `https://${deployment}`, `${deployment}/auth`, `${deployment}?next=other`, `${deployment}#fragment`,
      `member@${deployment}`, `${deployment}:443`, "*.vercel.app", "app.*.vercel.app", "app..vercel.app",
      "-app.vercel.app", "app-.vercel.app", "app_name.vercel.app", `${"a".repeat(64)}.vercel.app`,
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.app`,
      "samepace.vercel.app/../localhost", "samepace.vercel.app\\localhost", "samepace.vercel.app%2fexample.com",
    ]) {
      assert.deepEqual(vercelPreviewAuth({ VERCEL_ENV: "preview", VERCEL_URL: invalid, VERCEL_BRANCH_URL: invalid }), {
        allowedHosts: [], trustedOrigins: [], fallback: undefined,
      }, `invalid hostname was accepted: ${invalid}`);
    }
  });

  it("keeps a valid exact branch when the deployment variable is absent or invalid", () => {
    assert.deepEqual(vercelPreviewAuth({ VERCEL_ENV: "preview", VERCEL_URL: "localhost", VERCEL_BRANCH_URL: branch }), {
      allowedHosts: [branch], trustedOrigins: [`https://${branch}`], fallback: `https://${branch}`,
    });
  });

  it("accepts real Better Auth signup on either exact preview host and rejects a sibling origin", async () => {
    const preview = vercelPreviewAuth({ VERCEL_ENV: "preview", VERCEL_URL: deployment, VERCEL_BRANCH_URL: branch });
    const auth = betterAuth({
      database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
      secret: "synthetic-preview-auth-secret-at-least-thirty-two-characters",
      baseURL: { allowedHosts: preview.allowedHosts, protocol: "auto", fallback: preview.fallback! },
      trustedOrigins: preview.trustedOrigins,
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
    });
    const signup = (host: string, origin: string, email: string) => auth.handler(new Request(`https://${host}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: "Synthetic preview fixture", email, password: "Synthetic-preview-password-42" }),
    }));
    assert.equal((await signup(deployment, `https://${deployment}`, "deployment@example.test")).status, 200);
    assert.equal((await signup(branch, `https://${branch}`, "branch@example.test")).status, 200);
    assert.equal((await signup(deployment, "https://another-project.vercel.app", "rejected@example.test")).status, 403);
  });
});
