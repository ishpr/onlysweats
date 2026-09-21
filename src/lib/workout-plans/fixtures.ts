import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { ensureProfile, postSession } from "../pace/service.server.ts";
import type {
  CreateWorkoutPlanInput,
  WorkoutRun,
  WorkoutSetResult,
} from "../../../shared/workout-plans.ts";

export const testNow = Date.parse("2026-09-21T12:00:00.000Z");
export const runTime = testNow + 50 * 60_000;
export async function fixtureMember(sql: Sql, name = "Synthetic workout member") {
  const id = randomUUID();
  await sql`insert into "user" (id,name,email,"emailVerified") values (${id},${name},${`${id}@example.test`},true)`;
  await ensureProfile(sql, { id, name, email: `${id}@example.test` });
  return id;
}
export function fixturePlan(): CreateWorkoutPlanInput {
  return {
    id: randomUUID(),
    title: "Synthetic intervals",
    activity: "run",
    instructions: "Member-entered synthetic plan.",
    exercises: [
      {
        id: randomUUID(),
        name: "Easy interval",
        instructions: "Move at your chosen pace.",
        sets: Array.from({ length: 3 }, () => ({
          id: randomUUID(),
          reps: null,
          durationSeconds: 60,
          distanceMeters: null,
          weight: null,
          unit: "bodyweight" as const,
          restSeconds: 30,
        })),
      },
    ],
  };
}
export async function fixtureSession(sql: Sql, host: string, now = testNow) {
  return postSession(
    sql,
    host,
    {
      venueId: "katy",
      activity: "run",
      title: "Synthetic buddy intervals",
      detail: "",
      ability: { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 },
      abilityFlex: "strict",
      startAt: new Date(now + 60 * 60_000).toISOString(),
      durationMin: 40,
      capacity: 4,
      visibility: "public",
      joinMode: "instant",
      womenOnly: false,
    },
    now,
  );
}
export function completedSet(run: WorkoutRun, index = 0): WorkoutSetResult {
  return {
    exerciseId: run.snapshot.exercises[0].id,
    setId: run.snapshot.exercises[0].sets[index].id,
    status: "completed",
    reps: null,
    durationSeconds: 52,
    distanceMeters: null,
    weight: null,
    unit: "bodyweight",
  };
}
