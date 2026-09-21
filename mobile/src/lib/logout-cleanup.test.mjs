import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundedLogoutCleanup,
  cleanupSocialSession,
  createExclusiveSocialOperation,
  createLogoutCleanup,
  localFirstLogout,
  revokeAfterDeviceCleanup,
} from "./logout-cleanup.ts";

test("offline logout immediately fences token/private access and never waits for hanging remote cleanup", async () => {
  let token = "old-session",
    privateReadable = true,
    remoteStarted = false;
  const logout = localFirstLogout(
    async () => {
      token = null;
      privateReadable = false;
    },
    async () => {
      remoteStarted = true;
      assert.equal(token, null);
      assert.equal(privateReadable, false);
      await new Promise(() => {});
    },
    5,
  );
  assert.equal(token, null);
  assert.equal(privateReadable, false);
  await logout;
  assert.equal(remoteStarted, true);
});

test("only fixed cleanup routes retain the captured old bearer after another account signs in", async () => {
  const calls = [];
  let currentToken = "old-session";
  const cleanup = createLogoutCleanup(currentToken, async (token, path, method) => {
    calls.push({ token, path, method });
  });
  currentToken = "new-session";
  await cleanup.unregisterDevice("ExponentPushToken[test-token]");
  await cleanup.revokeSession();
  assert.equal(currentToken, "new-session");
  assert.deepEqual(calls, [
    {
      token: "old-session",
      path: "/api/v1/devices/ExponentPushToken%5Btest-token%5D",
      method: "DELETE",
    },
    { token: "old-session", path: "/api/auth/sign-out", method: "POST" },
  ]);
  assert.deepEqual(Object.keys(cleanup).sort(), ["revokeSession", "unregisterDevice"]);
});

test("captured cleanup aborts and releases even when network ignores cancellation", async () => {
  let signal;
  const cleanup = createLogoutCleanup(
    "old-session",
    async (_token, _path, _method, received) => {
      signal = received;
      await new Promise(() => {});
    },
    5,
  );
  await cleanup.revokeSession();
  assert.equal(signal.aborted, true);
});

test("session revocation follows the entire pending device cleanup, not its first network wait", async () => {
  const calls = [];
  let release;
  const deviceCleanup = new Promise((resolve) => { release = resolve; });
  const cleanup = revokeAfterDeviceCleanup(
    deviceCleanup,
    () => calls.push("close-devices"),
    async () => { calls.push("revoke-session"); },
    100,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, []);
  calls.push("devices-finished");
  release();
  await cleanup;
  assert.deepEqual(calls, ["devices-finished", "close-devices", "revoke-session"]);
});

test("a hung device lookup is fenced before bounded fallback revokes the session", async () => {
  let deviceCleanupOpen = true;
  let release;
  const calls = [];
  const deviceCleanup = (async () => {
    await new Promise((resolve) => { release = resolve; });
    if (deviceCleanupOpen) calls.push("late-delete");
  })();
  await revokeAfterDeviceCleanup(
    deviceCleanup,
    () => { deviceCleanupOpen = false; },
    async () => { calls.push("revoke-session"); },
    5,
  );
  release();
  await deviceCleanup;
  assert.deepEqual(calls, ["revoke-session"]);
});

test("a timed-out native cleanup keeps the Google session gate until the actual call finishes", async () => {
  const google = createExclusiveSocialOperation();
  let release;
  const native = google(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await boundedLogoutCleanup(() => native, 5);
  await assert.rejects(
    google(async () => "new-login"),
    /earlier request/,
  );
  release();
  await native;
  assert.equal(await google(async () => "new-login"), "new-login");
});

test("a newer account during Google revocation suppresses the later native sign-out", async () => {
  let current = true,
    release,
    signsOut = 0;
  const cleanup = cleanupSocialSession(
    {
      revokeAccess: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      signOut: async () => {
        signsOut++;
      },
    },
    true,
    () => current,
  );
  current = false;
  release();
  await cleanup;
  assert.equal(signsOut, 0);
});
