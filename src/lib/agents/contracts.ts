import { z } from "zod";

export const PROTOCOL_VERSION = "1.0";
export const PLAN_SCHEMA = "samepace.workout-proposal.v1";
export const activity = z.enum(["run", "ride", "walk", "hike", "strength", "mobility"]);
export const ability = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), paceMinSec: z.number(), paceMaxSec: z.number(), miles: z.number() }).strict(),
  z.object({ kind: z.literal("ride"), mphMin: z.number(), mphMax: z.number(), miles: z.number(), surface: z.enum(["road", "gravel"]) }).strict(),
  z.object({ kind: z.literal("gym"), experience: z.enum(["new", "regular", "advanced"]), focus: z.string().max(60) }).strict(),
  z.object({ kind: z.literal("hike"), miles: z.number(), gainFt: z.number(), difficulty: z.enum(["easy", "moderate", "hard"]) }).strict(),
  z.object({ kind: z.literal("walk"), effort: z.enum(["easy", "brisk"]), miles: z.number() }).strict(),
  z.object({ kind: z.literal("open") }).strict(),
]);

/** No home addresses, calendar events, fees, booking actions, or identity claims. */
export const workoutPlan = z.object({
  title: z.string().trim().min(1).max(120),
  venueId: z.string().min(1).max(100),
  activity,
  ability,
  startAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(10).max(360),
}).strict();
export type WorkoutPlan = z.infer<typeof workoutPlan>;

/** A counteroffer is a complete new proposal against an exact revision. */
export const proposalCommand = z.object({
  schema: z.literal(PLAN_SCHEMA),
  action: z.literal("propose"),
  expectedRevision: z.number().int().min(0),
  plan: workoutPlan,
}).strict();
export type ProposalCommand = z.infer<typeof proposalCommand>;

export const delegationInput = z.object({
  label: z.string().trim().min(1).max(80),
  expiresInHours: z.number().int().min(1).max(24).default(24),
}).strict();
