import assert from "node:assert/strict";
import test from "node:test";
import { localDateTime, parseLocalDateTime } from "./local-datetime.ts";

test("entered dates preserve device-local calendar values", () => {
  const iso = parseLocalDateTime("2026-09-21 18:30");
  assert.equal(localDateTime(iso), "2026-09-21 18:30");
});

test("invalid dates are rejected instead of rolling into another day", () => {
  for (const input of ["2026-02-30 10:00", "2026-09-21 24:00", "tomorrow", "2026-13-02 10:00"]) {
    assert.throws(() => parseLocalDateTime(input));
  }
});
