/** Explicitly invoked synthetic-only evaluation. Never imports member records. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateExerciseFixtures, exerciseHeldOutFixtures } from "./evaluation.ts";
import { evaluateWorkoutFixtures } from "./workout-evaluation.ts";
import { productionProvider } from "./typesafe.server.ts";

if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error("Set TYPESAFE_API_KEY in the server environment before running the authorized synthetic evaluation.");
// This changes only the short-lived evaluator process, never deployment flags.
process.env.JEV_ENABLED = "true";
const heldOut = process.argv[3] === "--heldout";
const workoutNotes = process.argv[3] === "--workout-notes";
const report = workoutNotes ? await evaluateWorkoutFixtures(productionProvider) : heldOut
  ? await evaluateExerciseFixtures(productionProvider, exerciseHeldOutFixtures, "synthetic-exercise-heldout-v1")
  : await evaluateExerciseFixtures(productionProvider);
const output = resolve(process.argv[2] ?? "artifacts/jev-synthetic-evaluation.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.info(JSON.stringify({ reportPath: output, dataset: report.dataset, evaluatedAt: report.evaluatedAt, cases: report.cases.length,
  providerSuccesses: report.cases.filter((entry) => entry.providerAvailable).length,
  correctCases: report.cases.filter((entry) => "exactMatch" in entry ? entry.exactMatch : entry.correct).length }));
