import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fitnessCalendarDay,
  fitnessDayLabel,
  fitnessQuantity,
  fitnessRecordedTime,
} from "./fitness-summary.ts";

test("summary cache keys follow local midnight across spring-forward and fall-back", () => {
  assert.equal(
    fitnessCalendarDay(Date.parse("2026-03-08T05:59:00Z"), "America/Chicago"),
    "2026-03-07",
  );
  assert.equal(
    fitnessCalendarDay(Date.parse("2026-03-08T06:00:00Z"), "America/Chicago"),
    "2026-03-08",
  );
  assert.equal(
    fitnessCalendarDay(Date.parse("2026-03-09T05:00:00Z"), "America/Chicago"),
    "2026-03-09",
  );
  assert.equal(
    fitnessCalendarDay(Date.parse("2026-11-01T05:00:00Z"), "America/Chicago"),
    "2026-11-01",
  );
  assert.equal(
    fitnessCalendarDay(Date.parse("2026-11-02T05:59:00Z"), "America/Chicago"),
    "2026-11-01",
  );
  assert.equal(
    fitnessCalendarDay(Date.parse("2026-11-02T06:00:00Z"), "America/Chicago"),
    "2026-11-02",
  );
});

test("timezone switches produce a new calendar key while labels preserve server dates", () => {
  const now = Date.parse("2026-09-21T02:00:00Z");
  assert.equal(fitnessCalendarDay(now, "America/Chicago"), "2026-09-20");
  assert.equal(fitnessCalendarDay(now, "Asia/Tokyo"), "2026-09-21");
  assert.equal(fitnessDayLabel("2026-03-08"), "Sun");
  assert.equal(fitnessDayLabel("2026-11-02"), "Mon");
});

test("missing recorded quantities remain missing and known zero stays zero", () => {
  assert.equal(fitnessQuantity(null), "—");
  assert.equal(fitnessQuantity(0), "0");
  assert.equal(fitnessRecordedTime(null), "—");
  assert.equal(fitnessRecordedTime(1500), "25 min");
  assert.equal(fitnessRecordedTime(90), "1 min 30 sec");
  assert.equal(fitnessRecordedTime(0.001), "<0.01 sec");
});
