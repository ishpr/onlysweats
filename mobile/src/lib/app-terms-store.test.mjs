import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmTermsAcceptance,
  createAppTermsStore,
  permitsAppAccess,
  readAppTermsStatus,
} from "./app-terms-store.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";

const accepted = {
  ownerId: "owner-a",
  version: APP_TERMS_VERSION,
  accepted: true,
  acceptedVersion: APP_TERMS_VERSION,
  acceptedAt: "2026-09-21T10:00:00.000Z",
};
const fresh = { ...accepted, accepted: false, acceptedVersion: null, acceptedAt: null };
const hashA = "a".repeat(64),
  hashB = "b".repeat(64);
const memory = () => {
  let value = null;
  return {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    clear: async () => {
      value = null;
    },
  };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("a current-version acceptance survives offline restart only for the exact session", async () => {
  const storage = memory();
  const first = createAppTermsStore(storage);
  first.bind(Promise.resolve(hashA));
  await first.remember(accepted, () => true);
  const restarted = createAppTermsStore(storage);
  restarted.bind(Promise.resolve(hashA));
  assert.deepEqual(await restarted.load(), accepted);
  restarted.bind(Promise.resolve(hashB));
  assert.equal(await restarted.load(), null);
  restarted.bind(null);
  assert.equal(await restarted.load(), null);
  assert.equal((await storage.read()).includes("raw-token"), false);
});

test("missing, corrupted, stale-version and unaccepted receipts cannot bypass onboarding", async () => {
  const storage = memory(),
    store = createAppTermsStore(storage);
  store.bind(Promise.resolve(hashA));
  for (const value of [
    null,
    "invalid-json",
    JSON.stringify({ tokenHash: hashA, status: fresh }),
    JSON.stringify({ tokenHash: hashA, status: { ...accepted, version: "old-terms" } }),
    JSON.stringify({ tokenHash: hashA, status: { ...accepted, acceptedAt: null } }),
    JSON.stringify({ tokenHash: hashA, status: { ...accepted, ownerId: [] } }),
  ]) {
    await storage.write(value);
    assert.equal(await store.load(), null);
  }
  await assert.rejects(store.remember(fresh, () => true));
});

test("logout immediately fences a delayed receipt write and cannot clear a newer login", async () => {
  const disk = memory(),
    started = deferred(),
    release = deferred();
  let block = true;
  const store = createAppTermsStore({
    ...disk,
    write: async (value) => {
      if (block) {
        block = false;
        started.resolve();
        await release.promise;
      }
      await disk.write(value);
    },
  });
  store.bind(Promise.resolve(hashA));
  const oldWrite = store.remember(accepted, () => true);
  await started.promise;
  const oldRejected = assert.rejects(oldWrite);
  const clearing = store.clear();
  assert.equal(await store.load(), null);
  store.bind(Promise.resolve(hashB));
  const next = { ...accepted, ownerId: "owner-b" };
  const newWrite = store.remember(next, () => true);
  release.resolve();
  await Promise.all([oldRejected, clearing, newWrite]);
  assert.deepEqual(await store.load(), next);
  assert.equal((await disk.read()).includes(hashA), false);
});

test("an old deferred token hash cannot enqueue a write after logout or a newer login", async () => {
  const disk = memory(),
    hash = deferred(),
    store = createAppTermsStore(disk);
  store.bind(hash.promise);
  const oldWrite = store.remember(accepted, () => true);
  const oldRejected = assert.rejects(oldWrite);
  await store.clear();
  store.bind(Promise.resolve(hashB));
  await store.remember({ ...accepted, ownerId: "owner-b" }, () => true);
  hash.resolve(hashA);
  await oldRejected;
  assert.equal((await store.load()).ownerId, "owner-b");
});

test("account change and failed protected storage never report a durable acceptance", async () => {
  const store = createAppTermsStore({
    read: async () => null,
    clear: async () => {},
    write: async () => {
      throw new Error("locked");
    },
  });
  store.bind(Promise.resolve(hashA));
  await assert.rejects(store.remember(accepted, () => false));
  await assert.rejects(
    store.remember(accepted, () => true),
    /locked/,
  );
  assert.equal(await store.load(), null);
});

test("only network failure may use a receipt; a fresh refusal or stale session closes access", () => {
  const input = { currentSession: true, live: null, receipt: accepted, failure: "none" };
  assert.equal(permitsAppAccess(input), true);
  assert.equal(permitsAppAccess({ ...input, failure: "connection" }), true);
  assert.equal(permitsAppAccess({ ...input, receipt: null, failure: "connection" }), false);
  assert.equal(permitsAppAccess({ ...input, failure: "denied" }), false);
  assert.equal(permitsAppAccess({ ...input, live: fresh }), false);
  assert.equal(permitsAppAccess({ ...input, currentSession: false }), false);
});

test("acceptance with a lost reply re-reads server state and never guesses success", async () => {
  const methods = [];
  const result = await confirmTermsAcceptance(
    async (method) => {
      methods.push(method);
      if (method === "PUT") throw new Error("response lost");
      return accepted;
    },
    () => true,
  );
  assert.deepEqual(result, accepted);
  assert.deepEqual(methods, ["PUT", "GET"]);
  await assert.rejects(
    confirmTermsAcceptance(
      async (method) => {
        if (method === "PUT") throw new Error("not committed");
        return fresh;
      },
      () => true,
    ),
    /not committed/,
  );
});

test("new-account and malformed acceptance responses cannot open the gate", async () => {
  let current = true;
  await assert.rejects(
    confirmTermsAcceptance(
      async () => {
        current = false;
        return accepted;
      },
      () => current,
    ),
  );
  for (const invalid of [
    null,
    { ...accepted, accepted: "true" },
    { ...accepted, version: "future-terms" },
    { ...accepted, acceptedAt: "not-a-time" },
    { ...accepted, acceptedVersion: "old-terms" },
  ])
    assert.throws(() => readAppTermsStatus(invalid));
});

test("a fresh refusal fences an earlier receipt awaiting its token hash", async () => {
  const disk = memory(),
    hash = deferred(),
    store = createAppTermsStore(disk);
  store.bind(hash.promise);
  const oldWrite = store.remember(accepted, () => true);
  const oldRejected = assert.rejects(oldWrite);
  await store.forget();
  hash.resolve(hashA);
  await oldRejected;
  assert.equal(await store.load(), null);
  await store.remember(accepted, () => true);
  assert.deepEqual(await store.load(), accepted);
});
