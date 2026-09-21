import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedText } from "./bounded-body.server.ts";

test("webhook body limits count streamed bytes and cancel oversize input", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("ééé"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://samepace.test/webhook", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  assert.equal(await boundedText(request, 5), null);
  assert.equal(cancelled, true);
});

test("webhook accepts exact limits and rejects declared excess before reading", async () => {
  assert.equal(
    await boundedText(new Request("https://samepace.test", { method: "POST", body: "abcde" }), 5),
    "abcde",
  );
  assert.equal(
    await boundedText(
      new Request("https://samepace.test", {
        method: "POST",
        body: "abcde",
        headers: { "content-length": "6" },
      }),
      5,
    ),
    null,
  );
  assert.equal(await boundedText(new Request("https://samepace.test")), "");
});
