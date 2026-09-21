import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySetFields, fieldsFromImportedDraft, parseSetFields, planContent } from "./forms.ts";

test("recorded quantities require an actual entry and preserve missing load", () => {
  assert.throws(() => parseSetFields(emptySetFields(), true), /actually completed/);
  const set = parseSetFields({ ...emptySetFields(), reps: "8", weight: "" }, true);
  assert.equal(set.weight, null);
  assert.equal(set.durationSeconds, null);
  assert.equal(set.reps, 8);
  assert.equal(parseSetFields({ ...emptySetFields(), reps: "8", weight: "0" }).weight, 0);
  assert.throws(() => parseSetFields({ ...emptySetFields(), reps: "-1" }), /whole number/);
  assert.throws(() => parseSetFields({ ...emptySetFields(), reps: "1.5" }), /whole number/);
});
test("bodyweight never turns a displayed load into a recorded external weight", () => {
  assert.equal(
    parseSetFields({ ...emptySetFields(), reps: "5", unit: "bodyweight", weight: "100" }).weight,
    null,
  );
});
test("extracted plans do not silently truncate exercises or sets", () => {
  const exercise = { name: "Squat", sets: 3, reps: 8, weight: null, unit: null };
  let id = 0;
  const make = () => String(++id);
  const source = { title: "My plan", note: "Instructions", exercises: [exercise] };
  const result = fieldsFromImportedDraft(source, make);
  assert.equal(result.exercises[0].sets.length, 3);
  assert.equal(result.exercises[0].sets[0].weight, "");
  assert.equal(result.exercises[0].sets[0].restSeconds, "");
  assert.equal(
    new Set(result.exercises.flatMap((entry) => [entry.id, ...entry.sets.map((set) => set.id)]))
      .size,
    4,
  );
  assert.throws(
    () => fieldsFromImportedDraft({ ...source, exercises: [{ ...exercise, sets: 21 }] }, make),
    /too large/,
  );
  assert.throws(
    () =>
      fieldsFromImportedDraft(
        { ...source, exercises: Array.from({ length: 13 }, () => exercise) },
        make,
      ),
    /too large/,
  );
  assert.throws(
    () =>
      fieldsFromImportedDraft(
        { ...source, exercises: Array.from({ length: 7 }, () => ({ ...exercise, sets: 20 })) },
        make,
      ),
    /too large/,
  );
});
test("unknown extracted amounts remain blank and cannot save as a complete prescription", () => {
  const value = fieldsFromImportedDraft(
    {
      title: "Plan",
      note: "",
      exercises: [{ name: "Squat", sets: null, reps: null, weight: null, unit: null }],
    },
    () => "id",
  );
  assert.equal(value.exercises[0].sets[0].reps, "");
  assert.equal(value.exercises[0].sets[0].weight, "");
  assert.throws(() => planContent(value), /target/);
});
