import assert from "node:assert/strict";
import test from "node:test";
import { collectExportPages } from "./export.ts";

test("full export follows every page instead of only visible workout history", async () => {
  const calls = [];
  const records = await collectExportPages({
    isCurrent: () => true,
    read: async (cursor) => { calls.push(cursor); return cursor === null
      ? { records: ["first"], nextCursor: "next" }
      : { records: ["last"], nextCursor: null }; },
  });
  assert.deepEqual(calls, [null, "next"]);
  assert.deepEqual(records, ["first", "last"]);
});

test("export discards late pages when the member changes", async () => {
  let current = true;
  await assert.rejects(collectExportPages({
    isCurrent: () => current,
    read: async () => { current = false; return { records: ["private"], nextCursor: null }; },
  }), /cancelled/);
});

test("failed or looping pagination never becomes a partial export", async () => {
  await assert.rejects(collectExportPages({ isCurrent: () => true,
    read: async () => ({ records: ["one"], nextCursor: "same" }),
  }), /could not finish/);
  await assert.rejects(collectExportPages({ isCurrent: () => true,
    read: async () => { throw new Error("offline"); },
  }), /offline/);
});
