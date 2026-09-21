import assert from "node:assert/strict";
import { test } from "node:test";
import { createPushDeviceLifecycle } from "./push-device-lifecycle.ts";
import { createPushRegistration } from "./push-registration.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture({ timeoutMs = 200, request = async () => {}, write, clear } = {}) {
  let account = "old",
    token = "old-device";
  const requests = [],
    events = [];
  const lifecycle = createPushDeviceLifecycle({
    capture: () => {
      const captured = account;
      return captured
        ? {
            isCurrent: () => captured === account,
            request: async (path, init) => {
              requests.push({ account: captured, path, init });
              await request(captured, init);
            },
          }
        : null;
    },
    readToken: async () => token,
    writeToken: async (next) => {
      await write?.(next);
      token = next;
      events.push(`write:${next}`);
    },
    clearToken: async () => {
      await clear?.();
      token = null;
      events.push("clear");
    },
    timeoutMs,
  });
  return {
    lifecycle,
    requests,
    events,
    token: () => token,
    switchAccount: (next) => {
      account = next;
    },
  };
}

test("logout fences a pending native token lookup before it can adopt a newer account", async () => {
  const lookup = deferred();
  const f = fixture();
  const old = f.lifecycle.register(() => lookup.promise, "ios");
  const unregistered = [];
  const cleanup = f.lifecycle.logout(async (token) => {
    unregistered.push(token);
  });
  f.switchAccount("new");
  const fresh = f.lifecycle.register(async () => "new-device", "ios");
  lookup.resolve("late-old-device");
  await Promise.all([old, cleanup, fresh]);
  assert.deepEqual(
    f.requests.map((item) => [item.account, item.init.json.token]),
    [["new", "new-device"]],
  );
  assert.deepEqual(unregistered, ["old-device"]);
  assert.equal(f.token(), "new-device");
});

test("cleanup includes an in-flight POST token even when it was never persisted", async () => {
  const pending = deferred(),
    started = deferred();
  const f = fixture({
    request: async () => {
      started.resolve();
      await pending.promise;
    },
  });
  const registration = f.lifecycle.register(async () => "just-created-device", "ios");
  await started.promise;
  const removed = [];
  const cleanup = f.lifecycle.logout(async (token) => {
    removed.push(token);
  });
  f.switchAccount(null);
  assert.deepEqual(removed, []);
  pending.resolve();
  await Promise.all([registration, cleanup]);
  assert.deepEqual(new Set(removed), new Set(["old-device", "just-created-device"]));
  assert.equal(f.token(), null);
  assert.equal(
    f.events.some((event) => event.startsWith("write:")),
    false,
  );
});

test("queued old keychain cleanup completes before a newer registration writes its token", async () => {
  const pendingClear = deferred(),
    started = deferred();
  const f = fixture({
    clear: async () => {
      started.resolve();
      await pendingClear.promise;
    },
  });
  let sameLogout = true;
  const deleted = [];
  const cleanup = f.lifecycle.logout(async (token) => {
    if (sameLogout) deleted.push(token);
  });
  await started.promise;
  sameLogout = false;
  f.switchAccount("new");
  const registration = f.lifecycle.register(async () => "new-device", "ios");
  await Promise.resolve();
  assert.equal(f.requests.length, 0);
  pendingClear.resolve();
  await Promise.all([cleanup, registration]);
  assert.deepEqual(deleted, []);
  assert.deepEqual(f.events, ["clear", "write:new-device"]);
  assert.equal(f.token(), "new-device");
});

test("same-owner re-registration follows an already-started old remote deletion", async () => {
  const remoteDelete = deferred(),
    deleteStarted = deferred();
  const f = fixture();
  const cleanup = f.lifecycle.logout(async () => {
    deleteStarted.resolve();
    await remoteDelete.promise;
  });
  await deleteStarted.promise;
  const registration = f.lifecycle.register(async () => "old-device", "ios");
  await Promise.resolve();
  assert.equal(f.requests.length, 0);
  remoteDelete.resolve();
  await Promise.all([cleanup, registration]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.token(), "old-device");
});

test("an old keychain write already underway is cleared before later account writes", async () => {
  const writing = deferred(),
    started = deferred();
  const f = fixture({
    write: async (token) => {
      if (token === "old-write") {
        started.resolve();
        await writing.promise;
      }
    },
  });
  const old = f.lifecycle.register(async () => "old-write", "ios");
  await started.promise;
  const cleanup = f.lifecycle.logout(async () => {});
  f.switchAccount("new");
  const fresh = f.lifecycle.register(async () => "new-device", "ios");
  writing.resolve();
  await Promise.all([old, cleanup, fresh]);
  assert.deepEqual(f.events, ["write:old-write", "clear", "write:new-device"]);
  assert.equal(f.token(), "new-device");
});

test("a changed API session blocks side effects even without a registration reset", async () => {
  const lookup = deferred();
  const f = fixture();
  const old = f.lifecycle.register(() => lookup.promise, "ios");
  f.switchAccount("new");
  lookup.resolve("device");
  await old;
  assert.equal(f.requests.length, 0);
  assert.equal(f.events.length, 0);
});

test("timeout releases registration and late transport completion cannot overwrite a newer token", async () => {
  const pending = deferred(),
    started = deferred();
  let count = 0;
  const f = fixture({
    timeoutMs: 10,
    request: async () => {
      if (++count === 1) {
        started.resolve();
        await pending.promise;
      }
    },
  });
  const old = f.lifecycle.register(async () => "old-timeout-device", "ios");
  const rejected = assert.rejects(old, /timed out/);
  await started.promise;
  await rejected;
  assert.equal(f.requests[0].init.signal.aborted, true);
  await f.lifecycle.register(async () => "new-device", "ios");
  pending.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.token(), "new-device");
});

test("registration failures stay visible as failures and reset fences late UI state", async () => {
  const gate = deferred(),
    started = deferred();
  let fail = true;
  const f = fixture({
    request: async () => {
      if (fail) throw new Error("Network unavailable");
      started.resolve();
      await gate.promise;
    },
  });
  const registration = createPushRegistration({
    permission: async () => "granted",
    register: () => f.lifecycle.register(async () => "device", "ios"),
  });
  await registration.sync();
  assert.equal(registration.getSnapshot().registration, "failed");
  fail = false;
  const old = registration.sync();
  await started.promise;
  f.lifecycle.fence();
  registration.reset();
  gate.resolve();
  await old;
  assert.equal(registration.getSnapshot().registration, "idle");
  assert.equal(f.token(), "old-device");
});
