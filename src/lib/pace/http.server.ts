/**
 * SamePace JSON API (`/api/v1/*`, PRD v0.3) — the contract the mobile client talks to.
 *
 * Auth: a Better Auth session, as a cookie (web) or `Authorization: Bearer`
 * (React Native). The caller's id only ever comes from that verified session.
 * Errors are `{ error }` with a meaningful status; 401 means "sign in again".
 */
import { z } from "zod";
import { getSql, type Sql } from "../db";
import { ensureDemoCluster } from "./demo-seed.server";
import * as notify from "./notify.server";
import * as safety from "./safety.server";
import * as svc from "./service.server";
import * as blocks from "./training-blocks.server";
import * as verification from "./verification.server";
import { GOAL_KINDS } from "./types";
import * as agents from "../agents/service.server";
import * as assistant from "../agents/assistant.server";
import * as coordination from "../agents/coordination.server";
import * as discovery from "../agents/discovery.server";
import * as contacts from "../agents/contact.server";
import { delegationInput } from "../agents/contracts";
import * as health from "../health/service.server";
import { today as healthToday } from "../health/today.server";
import { HealthError, pageInput } from "../health/contracts";
import { healthEnabled, isHealthPath, readHealthBody } from "../health/http.server";
import {
  operationalOverview,
  recordOperation,
  type OperationComponent,
} from "../operations/service.server";
import * as fitness from "../fitness/service.server";
import { getFitnessActivitySummary } from "../fitness/summary.server";
import * as outcomes from "../fitness/outcomes.server";
import * as billing from "../billing/service.server";
import * as conversation from "../conversation/service.server";
import { executeChatAction } from "../conversation/actions.server";
import { getPrivateGoal } from "../conversation/private-goals.server";
import { syncAgentPlanUpdates } from "../conversation/plan-updates.server";
import * as workoutPlans from "../workout-plans/service.server";
import { FitnessError, fitnessPageInput } from "../fitness/contracts";

type Ctx = {
  request: Request;
  sql: Sql;
  userId: string;
  /** The verified sign-in identity — what the admin gate checks. */
  user: { email: string | null; emailVerified: boolean };
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
};
type Handler = (ctx: Ctx) => Promise<unknown>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const ACTIVITY = z.enum(["run", "walk", "hike", "ride", "strength", "mobility"]);
const EXPERIENCE = z.enum(["new", "regular", "advanced"]);
const DIFFICULTY = z.enum(["easy", "moderate", "hard"]);
const EFFORT = z.enum(["easy", "brisk"]);

// Shape only — `rules.validAbility` owns the ranges and the activity match.
const ability = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("run"),
    paceMinSec: z.number(),
    paceMaxSec: z.number(),
    miles: z.number(),
  }),
  z.object({
    kind: z.literal("ride"),
    mphMin: z.number(),
    mphMax: z.number(),
    miles: z.number(),
    surface: z.enum(["road", "gravel"]),
  }),
  z.object({
    kind: z.literal("gym"),
    experience: EXPERIENCE,
    focus: z.string().max(60).default(""),
  }),
  z.object({
    kind: z.literal("hike"),
    miles: z.number(),
    gainFt: z.number(),
    difficulty: DIFFICULTY,
  }),
  z.object({ kind: z.literal("walk"), effort: EFFORT, miles: z.number() }),
  z.object({ kind: z.literal("open") }),
]);

const postSessionBody = z.object({
  venueId: z.string().min(1),
  activity: ACTIVITY,
  title: z.string().trim().min(1).max(120),
  detail: z.string().max(1000).default(""),
  // Optional here so a missing level gets the rule's own words, not a schema error.
  ability: ability.optional(),
  abilityFlex: z.enum(["strict", "flexible"]).default("strict"),
  routeUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullish(),
  startAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(10).max(360),
  capacity: z.number().int().min(2).max(4),
  visibility: z.enum(["public", "unlisted"]),
  joinMode: z.enum(["instant", "approve"]),
  womenOnly: z.boolean().default(false),
});

const blockGoalBody = z.object({
  goalKind: z.enum(GOAL_KINDS),
  eventName: z.string().trim().max(60).nullish(),
  goalDate: z.iso.date(),
});

// The block already fixes the activity, capacity, visibility and who can join.
const blockSlotBody = postSessionBody
  .pick({
    venueId: true,
    title: true,
    detail: true,
    abilityFlex: true,
    routeUrl: true,
    startAt: true,
    durationMin: true,
  })
  .extend({ ability });

const postBlockBody = blockGoalBody.extend({
  activity: ACTIVITY,
  capacity: z.number().int().min(2).max(4),
  visibility: z.enum(["public", "unlisted"]),
  joinMode: z.enum(["instant", "approve"]),
  womenOnly: z.boolean().default(false),
  slots: z.array(blockSlotBody).min(1).max(4),
});
const inviteBody = z.object({ inviteCode: z.string().optional() });
const nextBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep_slots") }),
  blockGoalBody.extend({ action: z.literal("next_block") }),
]);

const paceRange = z
  .object({ paceMinSec: z.number().min(240).max(1200), paceMaxSec: z.number().min(240).max(1200) })
  .refine((v) => v.paceMaxSec >= v.paceMinSec, "pace range is upside down");
const speedRange = z
  .object({ mphMin: z.number().min(5).max(40), mphMax: z.number().min(5).max(40) })
  .refine((v) => v.mphMax >= v.mphMin, "speed range is upside down");

// No bio, no "looking for": a profile is a name, a level and a track record.
const profileBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  neighborhood: z.string().trim().min(1).max(80).optional(),
  gender: z.enum(["woman", "man", "nonbinary"]).nullable().optional(),
  notify: z
    .object({
      sessions: z.boolean(),
      messages: z.boolean(),
      reminders: z.boolean(),
      substitutes: z.boolean(),
    })
    .partial()
    .optional(),
  abilities: z
    .object({
      run: paceRange,
      ride: speedRange,
      strength: z.object({ experience: EXPERIENCE }),
      hike: z.object({ difficulty: DIFFICULTY }),
      walk: z.object({ effort: EFFORT }),
    })
    .partial()
    .optional(),
});

const geoBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).optional(),
});

const ratingBody = z.object({
  showedUp: z.boolean(),
  onTime: z.boolean(),
  matchedListing: z.boolean(),
  respectful: z.boolean(),
  wouldJoinAgain: z.boolean(),
});

const reportBody = z.object({
  reportedId: z.string().min(1),
  reason: z.enum(safety.REPORT_REASONS),
  detail: z.string().max(2000).optional(),
  sessionId: z.string().min(1).optional(),
  bookingId: z.string().min(1).optional(),
  negotiationId: z.uuid().optional(),
  alsoBlock: z.boolean().optional(),
});

const resolveBody = z.object({
  action: z.enum(["dismiss", "suspend", "remove_session", "suspend_and_remove"]),
  note: z.string().max(1000).optional(),
});
const noteBody = z.object({ note: z.string().trim().min(1).max(1000) });
const agentId = z.uuid();
const negotiationBody = z.object({ bookingId: z.string().min(1).max(100) }).strict();
const consentBody = z.object({ allow: z.boolean() }).strict();
const confirmationBody = z.object({ revision: z.number().int().min(1) }).strict();
const emptyAgentBody = z.object({}).strict();

/** Admin routes answer 404 to everyone else — the queue isn't advertised. */
const admin =
  (fn: (ctx: Ctx & { adminEmail: string }) => Promise<unknown>): Handler =>
  (ctx) => {
    if (!safety.isAdmin(ctx.user)) throw new svc.PaceError(404, "Not found");
    return fn({ ...ctx, adminEmail: ctx.user.email! });
  };

/** What a suspended member can still reach: read why, and delete the account. */
const OPEN_WHEN_SUSPENDED = new Set([
  "GET /assistant/chat",
  "PUT /assistant/settings",
  "DELETE /assistant/chat",
  "GET /me",
  "GET /me/terms",
  "PUT /me/terms",
  "DELETE /me",
  "POST /devices",
  "DELETE /devices/:token",
  "GET /notifications",
  "GET /billing",
  "POST /billing/portal",
  "POST /billing/refresh",
  "POST /billing/fees/:id/dispute",
  "POST /notifications/read",
  // A paused account can still inspect, export, or remove its private records.
  "GET /health/connection",
  "DELETE /health/connection",
  "GET /health/workouts",
  "GET /health/workouts/:id",
  "DELETE /health/workouts/:id",
  "GET /health/export",
  "GET /fitness/consent",
  "PUT /fitness/consent",
  "GET /fitness/pilot-consent",
  "PUT /fitness/pilot-consent",
  "GET /fitness/logging-sessions/:id",
  "GET /fitness/logs",
  "GET /fitness/summary",
  "DELETE /fitness/logs/:id",
  "GET /fitness/export",
  "GET /fitness/plans",
  "GET /fitness/plans/:id",
  "DELETE /fitness/plans/:id",
  "GET /fitness/runs",
  "GET /fitness/runs/:id",
  "DELETE /fitness/runs/:id",
  "GET /agents/delegations",
  "GET /agents/preferences",
  "PUT /agents/preferences",
  "GET /agents/matching",
  "PUT /agents/matching",
  "GET /agents/discovery",
  "PUT /agents/discovery",
  "DELETE /agents/delegations/:id",
  "POST /agents/negotiations/:id/consent",
  "POST /agents/negotiations/:id/cancel",
  "GET /agents/negotiations/:id/coordination",
  "PUT /agents/negotiations/:id/coordination",
  "DELETE /agents/negotiations/:id/coordination",
]);

const routes: [method: string, pattern: string, handler: Handler][] = [
  ["GET", "/me/terms", ({ sql, userId }) => conversation.getAppTerms(sql, userId)],
  ["PUT", "/me/terms", ({ sql, userId, body }) => conversation.acceptAppTerms(sql, userId, body)],
  [
    "GET",
    "/fitness/summary",
    async ({ sql, userId, query }) => ({
      summary: await getFitnessActivitySummary(sql, userId, Object.fromEntries(query)),
    }),
  ],
  [
    "GET",
    "/assistant/goal",
    async ({ sql, userId }) => ({ goal: await getPrivateGoal(sql, userId) }),
  ],
  [
    "GET",
    "/assistant/chat",
    async ({ sql, userId, query }) => {
      if (query.get("agentCards") === "true") {
        const timeZone = conversation.turnInput.shape.timeZone.parse(
          query.get("timeZone") ?? "UTC",
        );
        await syncAgentPlanUpdates(sql, userId, Date.now(), timeZone);
      }
      const history = await conversation.getHistory(sql, userId);
      return {
        ...history,
        messages: history.messages.map((message) =>
          conversation.compatibleMessage(
            message,
            query.get("workoutPlanDrafts") === "true",
            query.get("agentCards") === "true",
          ),
        ),
      };
    },
  ],
  [
    "PUT",
    "/assistant/settings",
    ({ sql, userId, body }) => conversation.setSettings(sql, userId, body),
  ],
  ["DELETE", "/assistant/chat", ({ sql, userId }) => conversation.clearHistory(sql, userId)],
  [
    "POST",
    "/assistant/chat",
    ({ sql, userId, body, request }) =>
      conversation.chatResponse(sql, userId, body, request.signal),
  ],
  [
    "POST",
    "/assistant/actions/:id/execute",
    ({ sql, userId, params, body }) => executeChatAction(sql, userId, params.id, body),
  ],
  [
    "GET",
    "/fitness/plans",
    ({ sql, userId, query }) => workoutPlans.listPlans(sql, userId, Object.fromEntries(query)),
  ],
  [
    "POST",
    "/fitness/plans",
    async ({ sql, userId, body }) => ({ plan: await workoutPlans.createPlan(sql, userId, body) }),
  ],
  [
    "GET",
    "/fitness/plans/:id",
    async ({ sql, userId, params }) => ({
      plan: await workoutPlans.getPlan(sql, userId, params.id),
    }),
  ],
  [
    "PUT",
    "/fitness/plans/:id",
    async ({ sql, userId, params, body }) => ({
      plan: await workoutPlans.updatePlan(sql, userId, params.id, body),
    }),
  ],
  [
    "DELETE",
    "/fitness/plans/:id",
    async ({ sql, userId, params }) => {
      await workoutPlans.deletePlan(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "GET",
    "/fitness/runs",
    ({ sql, userId, query }) => workoutPlans.listRuns(sql, userId, Object.fromEntries(query)),
  ],
  [
    "POST",
    "/fitness/runs",
    async ({ sql, userId, body }) => ({ run: await workoutPlans.startRun(sql, userId, body) }),
  ],
  [
    "GET",
    "/fitness/runs/:id",
    async ({ sql, userId, params }) => ({ run: await workoutPlans.getRun(sql, userId, params.id) }),
  ],
  [
    "PUT",
    "/fitness/runs/:id",
    async ({ sql, userId, params, body }) => ({
      run: await workoutPlans.updateRun(sql, userId, params.id, body),
    }),
  ],
  [
    "DELETE",
    "/fitness/runs/:id",
    async ({ sql, userId, params }) => {
      await workoutPlans.deleteRun(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "GET",
    "/sessions/:id/workout-plan",
    ({ sql, userId, params }) => workoutPlans.getSessionPlan(sql, userId, params.id),
  ],
  [
    "PUT",
    "/sessions/:id/workout-plan",
    ({ sql, userId, params, body }) => workoutPlans.attachSessionPlan(sql, userId, params.id, body),
  ],
  [
    "DELETE",
    "/sessions/:id/workout-plan",
    ({ sql, userId, params, body }) => workoutPlans.removeSessionPlan(sql, userId, params.id, body),
  ],
  [
    "POST",
    "/sessions/:id/workout-plan/copy",
    async ({ sql, userId, params, body }) => ({
      plan: await workoutPlans.copySessionPlan(sql, userId, params.id, body),
    }),
  ],
  [
    "POST",
    "/billing/refresh",
    ({ sql, userId, body }) => {
      emptyAgentBody.parse(body ?? {});
      return billing.refreshBilling(sql, userId);
    },
  ],
  ["GET", "/billing", ({ sql, userId }) => billing.getBilling(sql, userId)],
  [
    "POST",
    "/billing/membership/checkout",
    ({ sql, userId, body }) => billing.createMembershipCheckout(sql, userId, body),
  ],
  [
    "POST",
    "/billing/fees/:id/checkout",
    ({ sql, userId, params, body }) => billing.createFeeCheckout(sql, userId, params.id, body),
  ],
  ["POST", "/billing/portal", ({ sql, userId, body }) => billing.createPortal(sql, userId, body)],
  [
    "POST",
    "/billing/fees/:id/dispute",
    ({ sql, userId, params, body }) => billing.disputeFee(sql, userId, params.id, body),
  ],
  [
    "GET",
    "/admin/billing/disputes",
    admin(async ({ sql }) => ({ disputes: await billing.listBillingDisputes(sql) })),
  ],
  [
    "POST",
    "/admin/billing/disputes/:id/resolve",
    admin(async ({ sql, adminEmail, params, body }) => ({
      disputes: await billing.resolveBillingDispute(sql, adminEmail, params.id, body),
    })),
  ],
  [
    "GET",
    "/agents/discovery",
    async ({ sql, userId }) => ({ discovery: await discovery.getDiscovery(sql, userId) }),
  ],
  [
    "PUT",
    "/agents/discovery",
    async ({ sql, userId, body }) => ({
      discovery: await discovery.setDiscovery(sql, userId, body),
    }),
  ],
  [
    "POST",
    "/agents/discovery/invitations",
    async () => {
      throw new svc.PaceError(
        409,
        "Your agent initiates contact using your saved planning preferences.",
        "agent_chat_only",
      );
    },
  ],
  [
    "GET",
    "/fitness/pilot-consent",
    async ({ sql, userId }) => ({
      consent: await outcomes.getPilotConsent(sql, userId),
    }),
  ],
  [
    "PUT",
    "/fitness/pilot-consent",
    async ({ sql, userId, body }) => ({
      consent: await outcomes.setPilotConsent(sql, userId, body),
    }),
  ],
  [
    "POST",
    "/fitness/logging-sessions",
    async ({ sql, userId, body }) => ({
      measurement: await outcomes.startLoggingSession(sql, userId, body ?? {}),
    }),
  ],
  [
    "GET",
    "/fitness/logging-sessions/:id",
    async ({ sql, userId, params }) => ({
      outcome: await outcomes.getLoggingOutcome(sql, userId, agentId.parse(params.id)),
    }),
  ],
  [
    "POST",
    "/fitness/logging-sessions/:id/feedback",
    async ({ sql, userId, params, body }) => ({
      outcome: await outcomes.recordPilotFeedback(sql, userId, agentId.parse(params.id), body),
    }),
  ],
  [
    "GET",
    "/agents/negotiations/:id/coordination",
    async ({ sql, userId, params }) => ({
      coordination: await coordination.getCoordination(sql, userId, agentId.parse(params.id)),
    }),
  ],
  [
    "PUT",
    "/agents/negotiations/:id/coordination",
    async ({ sql, userId, params, body }) => ({
      coordination: await coordination.setCoordinationPermission(
        sql,
        userId,
        agentId.parse(params.id),
        body,
      ),
    }),
  ],
  [
    "DELETE",
    "/agents/negotiations/:id/coordination",
    async ({ sql, userId, params }) => ({
      coordination: await coordination.setCoordinationPermission(
        sql,
        userId,
        agentId.parse(params.id),
        { enabled: false },
      ),
    }),
  ],
  [
    "POST",
    "/agents/negotiations/:id/coordinate",
    async ({ sql, userId, params, body }) => ({
      coordination: await coordination.startCoordination(
        sql,
        userId,
        agentId.parse(params.id),
        body,
      ),
    }),
  ],
  [
    "GET",
    "/fitness/consent",
    async ({ sql, userId }) => ({ consent: await fitness.getConsent(sql, userId) }),
  ],
  [
    "PUT",
    "/fitness/consent",
    async ({ sql, userId, body }) => ({ consent: await fitness.setConsent(sql, userId, body) }),
  ],
  [
    "GET",
    "/fitness/logs",
    ({ sql, userId, query }) =>
      fitness.listStrengthLogs(sql, userId, fitnessPageInput.parse(Object.fromEntries(query))),
  ],
  [
    "POST",
    "/fitness/logs",
    async ({ sql, userId, body }) => ({ log: await fitness.createStrengthLog(sql, userId, body) }),
  ],
  [
    "PUT",
    "/fitness/logs/:id",
    async ({ sql, userId, params, body }) => ({
      log: await fitness.updateStrengthLog(sql, userId, params.id, body),
    }),
  ],
  [
    "DELETE",
    "/fitness/logs/:id",
    async ({ sql, userId, params }) => {
      await fitness.deleteStrengthLog(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "POST",
    "/fitness/draft",
    async ({ sql, userId, body }) => ({ draft: await fitness.draftExercise(sql, userId, body) }),
  ],
  [
    "GET",
    "/fitness/export",
    ({ sql, userId, query }) =>
      fitness.exportFitness(sql, userId, fitnessPageInput.parse(Object.fromEntries(query))),
  ],
  [
    "GET",
    "/fitness/workouts/:id/correction",
    async ({ sql, userId, params }) => ({
      correction: await fitness.getCorrection(sql, userId, params.id),
    }),
  ],
  [
    "PUT",
    "/fitness/workouts/:id/correction",
    async ({ sql, userId, params, body }) => ({
      correction: await fitness.saveCorrection(sql, userId, params.id, body),
    }),
  ],
  [
    "GET",
    "/fitness/workouts/:id/assessment",
    async ({ sql, userId, params }) => ({
      assessment: await fitness.getWorkoutAssessment(sql, userId, params.id),
    }),
  ],
  [
    "POST",
    "/fitness/workouts/:id/assessment",
    async ({ sql, userId, params, body }) => ({
      assessment: await fitness.assessWorkout(sql, userId, params.id, body),
    }),
  ],
  [
    "GET",
    "/agents/matching",
    async ({ sql, userId }) => ({ matching: await contacts.getAgentMatching(sql, userId) }),
  ],
  [
    "PUT",
    "/agents/matching",
    async ({ sql, userId, body }) => ({
      matching: await contacts.setAgentMatching(sql, userId, body),
    }),
  ],
  [
    "POST",
    "/agents/matching/check",
    async ({ sql, userId, body }) => {
      z.strictObject({}).parse(body);
      return { matching: await contacts.checkAgentMatching(sql, userId) };
    },
  ],
  [
    "GET",
    "/agents/preferences",
    async ({ sql, userId }) => ({ preferences: await assistant.getPreferences(sql, userId) }),
  ],
  [
    "PUT",
    "/agents/preferences",
    async ({ sql, userId, body }) => {
      const preferences = await assistant.setPreferences(sql, userId, body);
      // A failed worker does not undo a saved preference. Its revision remains due
      // for the durable cron scan; no payload or member identity is logged here.
      try {
        await contacts.checkAgentMatching(sql, userId);
      } catch {
        console.warn("Agent matching deferred to scheduled retry.");
      }
      return { preferences };
    },
  ],
  [
    "GET",
    "/agents/negotiations/:id/candidates",
    ({ sql, userId, params }) => assistant.suggestPlans(sql, userId, agentId.parse(params.id)),
  ],
  [
    "GET",
    "/agents/negotiations/:id/history",
    async ({ sql, userId, params }) => ({
      events: await assistant.getHistory(sql, userId, agentId.parse(params.id)),
    }),
  ],
  [
    "POST",
    "/agents/negotiations/:id/proposal",
    async ({ sql, userId, params }) => {
      await agents.getNegotiation(sql, userId, agentId.parse(params.id));
      throw new svc.PaceError(
        409,
        "Update your planning preferences so your agent can propose a workout.",
        "agent_chat_only",
      );
    },
  ],
  [
    "GET",
    "/agents/negotiations/:id/booking-terms",
    ({ sql, userId, params }) => assistant.getBookingTerms(sql, userId, agentId.parse(params.id)),
  ],
  [
    "POST",
    "/agents/negotiations/:id/book",
    ({ sql, userId, params, body }) =>
      assistant.approveBookingTerms(sql, userId, agentId.parse(params.id), body),
  ],
  [
    "GET",
    "/health/connection",
    async ({ sql, userId }) => ({ connection: await health.getConnection(sql, userId) }),
  ],
  [
    "POST",
    "/health/connection",
    async ({ sql, userId, body }) => ({ connection: await health.connect(sql, userId, body) }),
  ],
  [
    "DELETE",
    "/health/connection",
    async ({ sql, userId }) => {
      await health.disconnect(sql, userId);
      return { ok: true };
    },
  ],
  [
    "POST",
    "/health/sync",
    async ({ sql, userId, body }) => ({ connection: await health.sync(sql, userId, body) }),
  ],
  [
    "GET",
    "/health/workouts",
    ({ sql, userId, query }) =>
      health.listWorkouts(sql, userId, pageInput(50).parse(Object.fromEntries(query))),
  ],
  [
    "GET",
    "/health/workouts/:id",
    async ({ sql, userId, params }) => ({
      workout: await health.getWorkout(sql, userId, params.id),
    }),
  ],
  [
    "DELETE",
    "/health/workouts/:id",
    async ({ sql, userId, params }) => {
      await health.deleteWorkout(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "GET",
    "/health/today",
    ({ sql, userId, query }) => healthToday(sql, userId, Object.fromEntries(query)),
  ],
  [
    "GET",
    "/health/export",
    ({ sql, userId, query }) =>
      health.exportRecords(sql, userId, pageInput(200).parse(Object.fromEntries(query))),
  ],
  // Human control uses the same verified member session as the rest of this
  // API. A scoped sp_agent_ token authenticates only at /api/a2a and cannot
  // create delegations, opt either member in, or approve a proposal here.
  [
    "GET",
    "/agents/delegations",
    async ({ sql, userId }) => ({
      delegations: await agents.listDelegations(sql, userId),
    }),
  ],
  [
    "POST",
    "/agents/delegations",
    async ({ sql, userId, body }) => ({
      delegation: await agents.createDelegation(sql, userId, delegationInput.parse(body)),
    }),
  ],
  [
    "DELETE",
    "/agents/delegations/:id",
    async ({ sql, userId, params, body }) => {
      emptyAgentBody.parse(body ?? {});
      await agents.revokeDelegation(sql, userId, agentId.parse(params.id));
      return { ok: true };
    },
  ],
  [
    "GET",
    "/agents/negotiations",
    async ({ sql, userId }) => ({
      negotiations: (await agents.listNegotiations(sql, userId)).map((room) => agents.view(room)),
    }),
  ],
  [
    "POST",
    "/agents/negotiations",
    async ({ sql, userId, body }) => ({
      negotiation: agents.view(
        await agents.createNegotiation(sql, userId, negotiationBody.parse(body).bookingId),
      ),
    }),
  ],
  [
    "GET",
    "/agents/negotiations/:id",
    async ({ sql, userId, params }) => ({
      negotiation: agents.view(await agents.getNegotiation(sql, userId, agentId.parse(params.id))),
    }),
  ],
  [
    "POST",
    "/agents/negotiations/:id/consent",
    async ({ sql, userId, params, body }) => ({
      negotiation: agents.view(
        await agents.consentToNegotiation(
          sql,
          userId,
          agentId.parse(params.id),
          consentBody.parse(body).allow,
        ),
      ),
    }),
  ],
  [
    "POST",
    "/agents/negotiations/:id/confirm",
    async ({ sql, userId, params, body }) => ({
      negotiation: agents.view(
        await agents.confirmProposal(
          sql,
          userId,
          agentId.parse(params.id),
          confirmationBody.parse(body).revision,
        ),
      ),
    }),
  ],
  [
    "POST",
    "/agents/negotiations/:id/cancel",
    async ({ sql, userId, params, body }) => {
      emptyAgentBody.parse(body ?? {});
      return {
        negotiation: agents.view(
          await agents.cancelNegotiation(sql, userId, agentId.parse(params.id)),
        ),
      };
    },
  ],
  [
    "GET",
    "/me",
    async ({ sql, userId, user }) => ({
      ...(await svc.getMe(sql, userId)),
      isAdmin: safety.isAdmin(user),
      verification: await verification.getVerification(sql, userId),
    }),
  ],
  // Identity verification. Persona sees the selfie and the ID; we learn how it came out.
  [
    "POST",
    "/verification",
    ({ sql, userId, body }) =>
      verification.startVerification(
        sql,
        userId,
        z.object({ tier: z.enum(["member", "government_id"]) }).parse(body).tier,
      ),
  ],
  [
    "POST",
    "/verification/:id/refresh",
    ({ sql, userId, params }) => verification.refreshVerification(sql, userId, params.id),
  ],
  // The stand-in's whole flow. 404 wherever Persona is configured, and in production.
  [
    "POST",
    "/verification/:id/dev-complete",
    ({ sql, userId, params, body }) =>
      verification.devComplete(
        sql,
        userId,
        params.id,
        z.object({ outcome: z.enum(["approved", "declined"]) }).parse(body).outcome,
      ),
  ],
  [
    "DELETE",
    "/me",
    async ({ sql, userId }) => {
      // Apple asks that deleting the account also revokes the app's access.
      const { revokeAppleAccess } = await import("../auth/apple-revoke.server");
      await revokeAppleAccess(sql, userId);
      // Persona redaction is queued atomically with deletion and retried by cron.
      await safety.deleteAccount(sql, userId);
      return { ok: true };
    },
  ],
  // Sent once, right after Sign in with Apple, so that revocation is possible later.
  [
    "POST",
    "/me/apple-authorization",
    async ({ sql, userId, body }) => {
      const { storeAppleAuthorization } = await import("../auth/apple-revoke.server");
      const { code } = z.object({ code: z.string().min(1).max(2000) }).parse(body);
      return { stored: await storeAppleAuthorization(sql, userId, code) };
    },
  ],

  // Push: this device, and the activity list the same rows feed.
  [
    "POST",
    "/devices",
    async ({ sql, userId, body }) => {
      const input = z
        .object({
          token: z.string().max(200).refine(notify.isExpoToken, "not an Expo push token"),
          platform: z.enum(["ios", "android"]),
        })
        .parse(body);
      await notify.registerDevice(sql, userId, input);
      return { ok: true };
    },
  ],
  [
    "DELETE",
    "/devices/:token",
    async ({ sql, userId, params }) => {
      await notify.removeDevice(sql, userId, params.token);
      return { ok: true };
    },
  ],
  ["GET", "/notifications", ({ sql, userId }) => notify.listNotifications(sql, userId)],
  [
    "POST",
    "/notifications/read",
    async ({ sql, userId }) => {
      await notify.markAllRead(sql, userId);
      return { ok: true };
    },
  ],

  ["GET", "/blocks", async ({ sql, userId }) => ({ people: await safety.listBlocks(sql, userId) })],
  [
    "POST",
    "/blocks",
    async ({ sql, userId, body }) => {
      await safety.blockMember(
        sql,
        userId,
        z.object({ memberId: z.string().min(1) }).parse(body).memberId,
      );
      return { ok: true };
    },
  ],
  [
    "DELETE",
    "/blocks/:id",
    async ({ sql, userId, params }) => {
      await safety.unblockMember(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "POST",
    "/reports",
    ({ sql, userId, body }) => safety.reportMember(sql, userId, reportBody.parse(body)),
  ],

  ["GET", "/admin/overview", admin(({ sql }) => safety.adminOverview(sql))],
  ["GET", "/admin/operations", admin(({ sql }) => operationalOverview(sql))],
  [
    "GET",
    "/admin/reports",
    admin(({ sql, query }) =>
      safety.adminListReports(
        sql,
        z.enum(["open", "actioned", "dismissed"]).catch("open").parse(query.get("status")),
      ),
    ),
  ],
  [
    "POST",
    "/admin/reports/:id/resolve",
    admin(async ({ sql, adminEmail, params, body }) => {
      await safety.adminResolveReport(sql, adminEmail, params.id, resolveBody.parse(body));
      return { ok: true };
    }),
  ],
  [
    "GET",
    "/admin/members",
    admin(async ({ sql, query }) => ({
      members: await safety.adminSearchMembers(sql, query.get("q") ?? ""),
    })),
  ],
  [
    "GET",
    "/admin/members/:id",
    admin(async ({ sql, params }) => ({
      member: await safety.adminGetMember(sql, params.id),
    })),
  ],
  [
    "POST",
    "/admin/members/:id/suspend",
    admin(async ({ sql, adminEmail, params, body }) => {
      await safety.adminSuspend(sql, adminEmail, params.id, noteBody.parse(body).note);
      return { member: await safety.adminGetMember(sql, params.id) };
    }),
  ],
  [
    "POST",
    "/admin/members/:id/unsuspend",
    admin(async ({ sql, adminEmail, params }) => {
      await safety.adminUnsuspend(sql, adminEmail, params.id);
      return { member: await safety.adminGetMember(sql, params.id) };
    }),
  ],
  [
    "POST",
    "/admin/sessions/:id/remove",
    admin(async ({ sql, adminEmail, params, body }) => {
      await safety.adminRemoveSession(sql, adminEmail, params.id, noteBody.parse(body).note);
      return { ok: true };
    }),
  ],
  [
    "POST",
    "/admin/training-blocks/:id/remove",
    admin(async ({ sql, adminEmail, params, body }) => {
      await safety.adminRemoveTrainingBlock(sql, adminEmail, params.id, noteBody.parse(body).note);
      return { ok: true };
    }),
  ],
  [
    "GET",
    "/admin/actions",
    admin(async ({ sql }) => ({ actions: await safety.adminListActions(sql) })),
  ],

  [
    "PATCH",
    "/me",
    // The same shape as `GET /me`: the app replaces its copy of the profile with this.
    async ({ sql, userId, user, body }) => ({
      ...(await svc.updateProfile(sql, userId, profileBody.parse(body))),
      isAdmin: safety.isAdmin(user),
      verification: await verification.getVerification(sql, userId),
    }),
  ],
  ["GET", "/venues", async ({ sql }) => ({ venues: await svc.listVenues(sql) })],

  [
    "GET",
    "/sessions",
    ({ sql, userId, query }) =>
      svc.listPublicSessions(sql, userId, { womenOnly: query.get("womenOnly") === "1" }),
  ],
  [
    "POST",
    "/sessions",
    async ({ sql, userId, body }) => ({
      session: await svc.postSession(
        sql,
        userId,
        postSessionBody.parse(body) as svc.PostSessionInput,
      ),
    }),
  ],
  [
    "GET",
    "/sessions/:id",
    ({ sql, userId, params, query }) =>
      svc.getSession(sql, userId, params.id, { inviteCode: query.get("invite") ?? undefined }),
  ],
  [
    "POST",
    "/sessions/:id/cancel",
    async ({ sql, userId, params }) => {
      await svc.cancelSession(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "POST",
    "/sessions/:id/bookings",
    async ({ sql, userId, params, body }) => ({
      booking: await svc.bookSeat(
        sql,
        userId,
        params.id,
        z.object({ inviteCode: z.string().optional() }).parse(body ?? {}),
      ),
    }),
  ],
  [
    "POST",
    "/sessions/:id/code",
    ({ sql, userId, params }) => svc.revealCode(sql, userId, params.id),
  ],
  ["GET", "/invites/:code", ({ sql, userId, params }) => svc.getInvite(sql, userId, params.code)],

  [
    "GET",
    "/bookings",
    async ({ sql, userId }) => {
      const mine = await svc.listMyBookings(sql, userId);
      const trainingBlocks = await blocks.listMyTrainingBlocks(sql, userId);
      const known = new Set(mine.people.map((p) => p.id));
      const missing = trainingBlocks.flatMap((b) => b.memberIds).filter((id) => !known.has(id));
      return {
        ...mine,
        trainingBlocks,
        people: [...mine.people, ...(await svc.people(sql, missing))],
      };
    },
  ],
  // "Same time next week": a completed session becomes a standing slot.
  [
    "POST",
    "/bookings/:id/repeat",
    async ({ sql, userId, params }) => ({
      series: await svc.repeatWeekly(sql, userId, params.id),
    }),
  ],
  ["GET", "/series", async ({ sql, userId }) => ({ series: await svc.listMySeries(sql, userId) })],
  [
    "POST",
    "/series/:id/leave",
    async ({ sql, userId, params }) => {
      await svc.leaveSeries(sql, userId, params.id);
      return { ok: true };
    },
  ],
  // "Make this a training block": a standing slot gets a goal and a date.
  [
    "POST",
    "/series/:id/training-block",
    async ({ sql, userId, params, body }) => ({
      block: await blocks.blockFromSeries(sql, userId, params.id, blockGoalBody.parse(body)),
    }),
  ],
  // Discovery, for blocks: public, a regular seat open, four weeks or more to go.
  [
    "GET",
    "/training-blocks",
    async ({ sql, userId }) => ({
      blocks: await blocks.listPublicTrainingBlocks(sql, userId),
    }),
  ],
  [
    "POST",
    "/training-blocks",
    async ({ sql, userId, body }) => ({
      block: await blocks.postTrainingBlock(
        sql,
        userId,
        postBlockBody.parse(body) as blocks.PostBlockInput,
      ),
    }),
  ],
  [
    "GET",
    "/training-blocks/:id",
    ({ sql, userId, params, query }) =>
      blocks.getTrainingBlock(sql, userId, params.id, {
        inviteCode: query.get("invite") ?? undefined,
      }),
  ],
  // Joining takes every slot in the block. It is only ever asked for here.
  [
    "POST",
    "/training-blocks/:id/join",
    async ({ sql, userId, params, body }) => ({
      block: await blocks.joinTrainingBlock(sql, userId, params.id, inviteBody.parse(body ?? {})),
    }),
  ],
  [
    "POST",
    "/training-blocks/:id/requests/:memberId/approve",
    async ({ sql, userId, params }) => ({
      block: await blocks.resolveBlockRequest(sql, userId, params.id, params.memberId, "approve"),
    }),
  ],
  [
    "POST",
    "/training-blocks/:id/requests/:memberId/decline",
    async ({ sql, userId, params }) => ({
      block: await blocks.resolveBlockRequest(sql, userId, params.id, params.memberId, "decline"),
    }),
  ],
  // "Helped me stick to it?" — a finisher's one answer, in the week after the goal date.
  [
    "POST",
    "/training-blocks/:id/credits",
    async ({ sql, userId, params, body }) => ({
      block: await blocks.giveCredits(
        sql,
        userId,
        params.id,
        z.object({ toIds: z.array(z.string().min(1)).max(8) }).parse(body).toIds,
      ),
    }),
  ],
  // What becomes of a finished block's slots: they carry on, or start the next block.
  [
    "POST",
    "/training-blocks/:id/next",
    async ({ sql, userId, params, body }) => {
      const next = nextBody.parse(body);
      if (next.action === "keep_slots") {
        await blocks.keepBlockSlots(sql, userId, params.id);
        return { ok: true };
      }
      return { block: await blocks.nextTrainingBlock(sql, userId, params.id, next) };
    },
  ],
  [
    "POST",
    "/training-blocks/:id/clone",
    async ({ sql, userId, params, body }) => ({
      block: await blocks.cloneTrainingBlock(sql, userId, params.id, inviteBody.parse(body ?? {})),
    }),
  ],
  [
    "POST",
    "/training-blocks/:id/slots",
    async ({ sql, userId, params, body }) => ({
      block: await blocks.addBlockSlot(sql, userId, params.id, blockSlotBody.parse(body)),
    }),
  ],
  [
    "POST",
    "/training-blocks/:id/leave",
    async ({ sql, userId, params }) => {
      await blocks.leaveTrainingBlock(sql, userId, params.id);
      return { ok: true };
    },
  ],
  [
    "GET",
    "/bookings/:id",
    async ({ sql, userId, params }) => ({
      booking: await svc.getBooking(sql, userId, params.id),
    }),
  ],
  [
    "POST",
    "/bookings/:id/approve",
    async ({ sql, userId, params }) => ({
      booking: await svc.approveBooking(sql, userId, params.id),
    }),
  ],
  [
    "POST",
    "/bookings/:id/decline",
    async ({ sql, userId, params }) => ({
      booking: await svc.declineBooking(sql, userId, params.id),
    }),
  ],
  [
    "POST",
    "/bookings/:id/cancel",
    async ({ sql, userId, params }) => ({
      booking: await svc.cancelBooking(sql, userId, params.id),
    }),
  ],
  [
    "POST",
    "/bookings/:id/checkin",
    async ({ sql, userId, params, body }) => ({
      booking: await svc.checkInGeo(sql, userId, params.id, geoBody.parse(body)),
    }),
  ],
  [
    "POST",
    "/bookings/:id/checkin-code",
    async ({ sql, userId, params, body }) => ({
      booking: await svc.checkInCode(
        sql,
        userId,
        params.id,
        z.object({ code: z.string().regex(/^\d{4}$/) }).parse(body).code,
      ),
    }),
  ],
  [
    "GET",
    "/bookings/:id/messages",
    async ({ sql, userId, params }) => ({
      messages: await svc.listMessages(sql, userId, params.id),
    }),
  ],
  [
    "POST",
    "/bookings/:id/messages",
    async ({ sql, userId, params, body }) => ({
      messages: await svc.sendMessage(
        sql,
        userId,
        params.id,
        z.object({ text: z.string().min(1).max(2000) }).parse(body).text,
      ),
    }),
  ],
  [
    "POST",
    "/bookings/:id/rating",
    async ({ sql, userId, params, body }) => ({
      booking: await svc.submitRating(sql, userId, params.id, ratingBody.parse(body)),
    }),
  ],
];

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/+$/, "") || "/";
  const healthRequest = isHealthPath(path);
  const fitnessRequest = path === "/fitness" || path.startsWith("/fitness/");
  const sessionWorkoutRequest = /^\/sessions\/[^/]+\/workout-plan(?:\/copy)?$/.test(path);
  const agentRequest = path === "/agents" || path.startsWith("/agents/");
  const conversationRequest =
    path === "/assistant" || path.startsWith("/assistant/") || path === "/me/terms";
  const privateFitnessRequest =
    healthRequest || fitnessRequest || conversationRequest || sessionWorkoutRequest;
  const sensitiveRequest =
    privateFitnessRequest ||
    agentRequest ||
    path.startsWith("/billing") ||
    path.startsWith("/admin/billing");
  const component: OperationComponent | null = healthRequest
    ? "health"
    : fitnessRequest
      ? "fitness"
      : agentRequest
        ? "agents"
        : null;
  if (healthRequest && !healthEnabled()) return json({ error: "Not found" }, 404);
  // Hide every agent control route before authentication or database work when
  // the foundation is disabled; deployment defaults to disabled.
  if ((path === "/agents" || path.startsWith("/agents/")) && process.env.A2A_ENABLED !== "true") {
    return json({ error: "Not found" }, 404);
  }
  let found: { handler: Handler; params: Record<string, string>; key: string } | null = null;
  let pathKnown = false;
  for (const [method, pattern, handler] of routes) {
    const params = match(pattern, path);
    if (!params) continue;
    pathKnown = true;
    if (method === request.method) {
      found = { handler, params, key: `${method} ${pattern}` };
      break;
    }
  }
  // The one public endpoint: which sign-in methods to draw. Public values only.
  if (path === "/auth-config" && request.method === "GET") {
    const { authConfig } = await import("../auth/social.server");
    return json(authConfig());
  }
  if (!found)
    return json({ error: pathKnown ? "Method not allowed" : "Not found" }, pathKnown ? 405 : 404);

  const started = Date.now();
  let metricSql: Sql | null = null;
  let responseStatus = 500;
  const respond = (data: unknown, status = 200) => {
    responseStatus = status;
    return json(data, status);
  };
  try {
    const { assertSameSiteRequest } = await import("../auth/isolation.server");
    assertSameSiteRequest();
    const { auth } = await import("../auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return respond({ error: "Unauthorized" }, 401);

    const sql = await getSql();
    metricSql = sql;
    if (!privateFitnessRequest) await ensureDemoCluster(sql);
    // First contact creates the profile from the auth identity.
    const me = await svc.ensureProfile(sql, {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    });
    // A deleted account's token can outlive it by a cached session; it opens nothing.
    if (me.deleted) return respond({ error: "Unauthorized" }, 401);
    if (me.suspended && !OPEN_WHEN_SUSPENDED.has(found.key)) {
      return respond({ error: "Your account is paused. Email support@samepace.app." }, 403);
    }

    let body: unknown = undefined;
    if (conversationRequest && ["POST", "PUT"].includes(request.method)) {
      body = await conversation.readChatBody(request);
    } else if (sensitiveRequest && request.method !== "GET") {
      body = await readHealthBody(request);
    } else if (request.method !== "GET" && request.headers.get("content-length") !== "0") {
      const text = await request.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return respond({ error: "Body must be JSON." }, 400);
        }
      }
    }
    const data = await found.handler({
      request,
      sql,
      userId: session.user.id,
      user: {
        email: session.user.email ?? null,
        emailVerified: session.user.emailVerified === true,
      },
      params: found.params,
      query: url.searchParams,
      body,
    });
    // Whatever that request caused is pushed now; the cron sweeps up anything missed.
    if (!privateFitnessRequest && request.method !== "GET") {
      await notify.deliverDue(sql).catch((err) => console.error("[push]", err));
    }
    if (data instanceof Response) {
      responseStatus = data.status;
      return data;
    }
    return respond(data);
  } catch (err) {
    if (err instanceof conversation.ChatError) return respond({ error: err.message }, err.status);
    if (err instanceof FitnessError) return respond({ error: err.message }, err.status);
    if (err instanceof HealthError) return respond({ error: err.message }, err.status);
    if (err instanceof svc.PaceError) {
      return respond(
        err.code ? { error: err.message, code: err.code } : { error: err.message },
        err.status,
      );
    }
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return respond({ error: `${first.path.join(".") || "body"}: ${first.message}` }, 400);
    }
    if ((err as { status?: number })?.status === 403) return respond({ error: "Forbidden" }, 403);
    // Database errors may contain SQL parameters. Never log a health payload,
    // anchor, source identifier, or error object from this private boundary.
    if (sensitiveRequest) console.error("[private-api] request failed");
    else console.error("[api]", request.method, path, err);
    return respond({ error: "Something broke on our side." }, 500);
  } finally {
    if (metricSql && component)
      await recordOperation(metricSql, {
        component,
        action: found.key,
        status: responseStatus,
        durationMs: Date.now() - started,
      }).catch(() => console.error("[operations] metric write failed"));
  }
}
