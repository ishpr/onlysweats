import assert from "node:assert/strict";
import test from "node:test";
import { openHostedBilling } from "./billing-flow.ts";
import { createSessionTransport } from "./session-transport.ts";

test("billing opens only the server-provided secure Stripe checkout and never infers entitlement from return", async () => {
  const calls = [];
  let opened;
  const session = createSessionTransport({
    token: "member",
    version: 1,
    currentVersion: () => 1,
    stale: () => new Error("stale"),
    send: async (token, path, input) => {
      calls.push({ token, path, input });
      return { url: "https://checkout.stripe.com/c/pay/example" };
    },
  });
  const result = await openHostedBilling({
    session,
    path: "/billing/membership/checkout",
    input: { requestId: "one", termsHash: "reviewed" },
    signal: new AbortController().signal,
    openBrowser: async (url) => {
      opened = url;
      return { type: "success", url: "samepace://billing-return?paid=true" };
    },
  });
  assert.equal(opened, "https://checkout.stripe.com/c/pay/example");
  assert.equal(result, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/billing/refresh");
  assert.deepEqual(calls[0].input.json, { requestId: "one", termsHash: "reviewed" });
});

test("a delayed checkout cannot open under a replacement account, and untrusted payment URLs are rejected", async () => {
  let version = 1;
  let finish;
  let opened = false;
  const session = createSessionTransport({
    token: "old-member",
    version: 1,
    currentVersion: () => version,
    stale: () => new Error("stale"),
    send: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = openHostedBilling({
    session,
    path: "/billing/portal",
    input: { requestId: "one" },
    signal: new AbortController().signal,
    openBrowser: async () => {
      opened = true;
    },
  });
  version = 2;
  finish({ url: "https://billing.stripe.com/p/session/example" });
  await assert.rejects(pending, /stale/);
  assert.equal(opened, false);
  for (const url of [
    "http://checkout.stripe.com/pay",
    "https://checkout.stripe.com.evil.test/pay",
    "https://member@checkout.stripe.com/pay",
    "javascript:alert(1)",
  ]) {
    await assert.rejects(
      openHostedBilling({
        session: { isCurrent: () => true, request: async () => ({ url }) },
        path: "/billing/portal",
        input: { requestId: "one" },
        signal: new AbortController().signal,
        openBrowser: async () => {
          throw new Error("must not open");
        },
      }),
      /payment page could not be opened/,
    );
  }
});

test("switching accounts inside checkout never refreshes billing under the new account", async () => {
  let current = true;
  const paths = [];
  await openHostedBilling({
    session: {
      isCurrent: () => current,
      request: async (path) => {
        paths.push(path);
        return { url: "https://billing.stripe.com/p/session/example" };
      },
    },
    path: "/billing/portal",
    input: { requestId: "one" },
    signal: new AbortController().signal,
    openBrowser: async () => {
      current = false;
    },
  });
  assert.deepEqual(paths, ["/billing/portal"]);
});
