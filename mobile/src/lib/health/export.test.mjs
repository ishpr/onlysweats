import assert from "node:assert/strict";
import test from "node:test";
import { collectExportPages, prepareFitnessExport } from "./export.ts";

test("full export follows every page instead of only visible workout history", async () => {
  const calls = [];
  const records = await collectExportPages({
    isCurrent: () => true,
    read: async (cursor) => {
      calls.push(cursor);
      return cursor === null
        ? { records: ["first"], nextCursor: "next" }
        : { records: ["last"], nextCursor: null };
    },
  });
  assert.deepEqual(calls, [null, "next"]);
  assert.deepEqual(records, ["first", "last"]);
});

test("export discards late pages when the member changes", async () => {
  let current = true;
  await assert.rejects(
    collectExportPages({
      isCurrent: () => current,
      read: async () => {
        current = false;
        return { records: ["private"], nextCursor: null };
      },
    }),
    /cancelled/,
  );
});

test("failed or looping pagination never becomes a partial export", async () => {
  await assert.rejects(
    collectExportPages({
      isCurrent: () => true,
      read: async () => ({ records: ["one"], nextCursor: "same" }),
    }),
    /could not finish/,
  );
  await assert.rejects(
    collectExportPages({
      isCurrent: () => true,
      read: async () => {
        throw new Error("offline");
      },
    }),
    /offline/,
  );
});

test("fitness export includes optional pilot consent and outcomes alongside all exercise pages", async () => {
  let page = 0;
  const consent = { enabled: true, generation: "ai-generation" };
  const pilotConsent = { enabled: true, generation: "pilot-generation" };
  const contents = await prepareFitnessExport(
    {
      isCurrent: () => true,
      request: async () => ({
        consent,
        pilotConsent,
        records:
          page++ === 0
            ? [{ kind: "strength_log", value: { id: "log" } }]
            : [{ kind: "pilot_outcome", value: { sessionId: "measurement" } }],
        nextCursor: page === 1 ? "next" : null,
      }),
    },
    new AbortController().signal,
  );
  const exported = JSON.parse(contents);
  assert.deepEqual(exported.consent, consent);
  assert.deepEqual(exported.pilotConsent, pilotConsent);
  assert.equal(exported.records.length, 2);
  assert.equal(exported.records[1].kind, "pilot_outcome");
});
