import assert from "node:assert/strict";
import test from "node:test";
import { beginVerification } from "./verification-flow.ts";
import { createSessionTransport } from "./session-transport.ts";

function fixture() {
  let version = 1;
  const calls = [];
  const session = createSessionTransport({
    token: "original-member",
    version,
    currentVersion: () => version,
    stale: () => new Error("stale"),
    send: async (token, path) => {
      calls.push({ token, path });
      return { id: "check-id", url: "https://withpersona.com/check" };
    },
  });
  return {
    session,
    calls,
    switchAccount: () => {
      version += 1;
    },
  };
}

test("returning from verification refreshes only the initiating account", async () => {
  const f = fixture();
  let opened;
  await beginVerification({
    session: f.session,
    tier: "member",
    signal: new AbortController().signal,
    onStarted: (value) => {
      opened = value;
    },
    openBrowser: async () => {},
  });
  assert.equal(opened.id, "check-id");
  assert.deepEqual(f.calls, [
    { token: "original-member", path: "/verification" },
    { token: "original-member", path: "/verification/check-id/refresh" },
  ]);
});

test("switching accounts or unmounting while the browser is open never refreshes later", async () => {
  for (const cancel of ["account", "unmount"]) {
    const f = fixture();
    const controller = new AbortController();
    await beginVerification({
      session: f.session,
      tier: "member",
      signal: controller.signal,
      onStarted: () => {},
      openBrowser: async () => {
        if (cancel === "account") f.switchAccount();
        else controller.abort();
      },
    });
    assert.deepEqual(f.calls, [{ token: "original-member", path: "/verification" }]);
  }
});
