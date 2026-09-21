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
import { GOAL_KINDS } from "./types";

type Ctx = {
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
  z.object({ kind: z.literal("run"), paceMinSec: z.number(), paceMaxSec: z.number(), miles: z.number() }),
  z.object({
    kind: z.literal("ride"),
    mphMin: z.number(),
    mphMax: z.number(),
    miles: z.number(),
    surface: z.enum(["road", "gravel"]),
  }),
  z.object({ kind: z.literal("gym"), experience: EXPERIENCE, focus: z.string().max(60).default("") }),
  z.object({ kind: z.literal("hike"), miles: z.number(), gainFt: z.number(), difficulty: DIFFICULTY }),
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
  routeUrl: z.url({ protocol: /^https$/ }).max(500).nullish(),
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
  alsoBlock: z.boolean().optional(),
});

const resolveBody = z.object({
  action: z.enum(["dismiss", "suspend", "remove_session", "suspend_and_remove"]),
  note: z.string().max(1000).optional(),
});
const noteBody = z.object({ note: z.string().trim().min(1).max(1000) });

/** Admin routes answer 404 to everyone else — the queue isn't advertised. */
const admin =
  (fn: (ctx: Ctx & { adminEmail: string }) => Promise<unknown>): Handler =>
  (ctx) => {
    if (!safety.isAdmin(ctx.user)) throw new svc.PaceError(404, "Not found");
    return fn({ ...ctx, adminEmail: ctx.user.email! });
  };

/** What a suspended member can still reach: read why, and delete the account. */
const OPEN_WHEN_SUSPENDED = new Set([
  "GET /me",
  "DELETE /me",
  "POST /devices",
  "DELETE /devices/:token",
  "GET /notifications",
  "POST /notifications/read",
]);

const routes: [method: string, pattern: string, handler: Handler][] = [
  ["GET", "/me", async ({ sql, userId, user }) => ({
    ...(await svc.getMe(sql, userId)),
    isAdmin: safety.isAdmin(user),
  })],
  ["DELETE", "/me", async ({ sql, userId }) => {
    // Apple asks that deleting the account also revokes the app's access.
    const { revokeAppleAccess } = await import("../auth/apple-revoke.server");
    await revokeAppleAccess(sql, userId);
    await safety.deleteAccount(sql, userId);
    return { ok: true };
  }],
  // Sent once, right after Sign in with Apple, so that revocation is possible later.
  ["POST", "/me/apple-authorization", async ({ sql, userId, body }) => {
    const { storeAppleAuthorization } = await import("../auth/apple-revoke.server");
    const { code } = z.object({ code: z.string().min(1).max(2000) }).parse(body);
    return { stored: await storeAppleAuthorization(sql, userId, code) };
  }],

  // Push: this device, and the activity list the same rows feed.
  ["POST", "/devices", async ({ sql, userId, body }) => {
    const input = z
      .object({
        token: z.string().max(200).refine(notify.isExpoToken, "not an Expo push token"),
        platform: z.enum(["ios", "android"]),
      })
      .parse(body);
    await notify.registerDevice(sql, userId, input);
    return { ok: true };
  }],
  ["DELETE", "/devices/:token", async ({ sql, userId, params }) => {
    await notify.removeDevice(sql, userId, params.token);
    return { ok: true };
  }],
  ["GET", "/notifications", ({ sql, userId }) => notify.listNotifications(sql, userId)],
  ["POST", "/notifications/read", async ({ sql, userId }) => {
    await notify.markAllRead(sql, userId);
    return { ok: true };
  }],

  ["GET", "/blocks", async ({ sql, userId }) => ({ people: await safety.listBlocks(sql, userId) })],
  ["POST", "/blocks", async ({ sql, userId, body }) => {
    await safety.blockMember(sql, userId, z.object({ memberId: z.string().min(1) }).parse(body).memberId);
    return { ok: true };
  }],
  ["DELETE", "/blocks/:id", async ({ sql, userId, params }) => {
    await safety.unblockMember(sql, userId, params.id);
    return { ok: true };
  }],
  ["POST", "/reports", ({ sql, userId, body }) =>
    safety.reportMember(sql, userId, reportBody.parse(body))],

  ["GET", "/admin/overview", admin(({ sql }) => safety.adminOverview(sql))],
  ["GET", "/admin/reports", admin(({ sql, query }) =>
    safety.adminListReports(
      sql,
      z.enum(["open", "actioned", "dismissed"]).catch("open").parse(query.get("status")),
    ))],
  ["POST", "/admin/reports/:id/resolve", admin(async ({ sql, adminEmail, params, body }) => {
    await safety.adminResolveReport(sql, adminEmail, params.id, resolveBody.parse(body));
    return { ok: true };
  })],
  ["GET", "/admin/members", admin(async ({ sql, query }) => ({
    members: await safety.adminSearchMembers(sql, query.get("q") ?? ""),
  }))],
  ["GET", "/admin/members/:id", admin(async ({ sql, params }) => ({
    member: await safety.adminGetMember(sql, params.id),
  }))],
  ["POST", "/admin/members/:id/suspend", admin(async ({ sql, adminEmail, params, body }) => {
    await safety.adminSuspend(sql, adminEmail, params.id, noteBody.parse(body).note);
    return { member: await safety.adminGetMember(sql, params.id) };
  })],
  ["POST", "/admin/members/:id/unsuspend", admin(async ({ sql, adminEmail, params }) => {
    await safety.adminUnsuspend(sql, adminEmail, params.id);
    return { member: await safety.adminGetMember(sql, params.id) };
  })],
  ["POST", "/admin/sessions/:id/remove", admin(async ({ sql, adminEmail, params, body }) => {
    await safety.adminRemoveSession(sql, adminEmail, params.id, noteBody.parse(body).note);
    return { ok: true };
  })],
  ["POST", "/admin/training-blocks/:id/remove", admin(async ({ sql, adminEmail, params, body }) => {
    await safety.adminRemoveTrainingBlock(sql, adminEmail, params.id, noteBody.parse(body).note);
    return { ok: true };
  })],
  ["GET", "/admin/actions", admin(async ({ sql }) => ({ actions: await safety.adminListActions(sql) }))],

  ["PATCH", "/me", ({ sql, userId, body }) => svc.updateProfile(sql, userId, profileBody.parse(body))],
  ["GET", "/venues", async ({ sql }) => ({ venues: await svc.listVenues(sql) })],

  [
    "GET",
    "/sessions",
    ({ sql, userId, query }) =>
      svc.listPublicSessions(sql, userId, { womenOnly: query.get("womenOnly") === "1" }),
  ],
  ["POST", "/sessions", async ({ sql, userId, body }) => ({
    session: await svc.postSession(sql, userId, postSessionBody.parse(body) as svc.PostSessionInput),
  })],
  ["GET", "/sessions/:id", ({ sql, userId, params, query }) =>
    svc.getSession(sql, userId, params.id, { inviteCode: query.get("invite") ?? undefined })],
  ["POST", "/sessions/:id/cancel", async ({ sql, userId, params }) => {
    await svc.cancelSession(sql, userId, params.id);
    return { ok: true };
  }],
  ["POST", "/sessions/:id/bookings", async ({ sql, userId, params, body }) => ({
    booking: await svc.bookSeat(
      sql,
      userId,
      params.id,
      z.object({ inviteCode: z.string().optional() }).parse(body ?? {}),
    ),
  })],
  ["POST", "/sessions/:id/code", ({ sql, userId, params }) => svc.revealCode(sql, userId, params.id)],
  ["GET", "/invites/:code", ({ sql, userId, params }) => svc.getInvite(sql, userId, params.code)],

  ["GET", "/bookings", async ({ sql, userId }) => {
    const mine = await svc.listMyBookings(sql, userId);
    const trainingBlocks = await blocks.listMyTrainingBlocks(sql, userId);
    const known = new Set(mine.people.map((p) => p.id));
    const missing = trainingBlocks.flatMap((b) => b.memberIds).filter((id) => !known.has(id));
    return {
      ...mine,
      trainingBlocks,
      people: [...mine.people, ...(await svc.people(sql, missing))],
    };
  }],
  // "Same time next week": a completed session becomes a standing slot.
  ["POST", "/bookings/:id/repeat", async ({ sql, userId, params }) => ({
    series: await svc.repeatWeekly(sql, userId, params.id),
  })],
  ["GET", "/series", async ({ sql, userId }) => ({ series: await svc.listMySeries(sql, userId) })],
  ["POST", "/series/:id/leave", async ({ sql, userId, params }) => {
    await svc.leaveSeries(sql, userId, params.id);
    return { ok: true };
  }],
  // "Make this a training block": a standing slot gets a goal and a date.
  ["POST", "/series/:id/training-block", async ({ sql, userId, params, body }) => ({
    block: await blocks.blockFromSeries(sql, userId, params.id, blockGoalBody.parse(body)),
  })],
  // Discovery, for blocks: public, a regular seat open, four weeks or more to go.
  ["GET", "/training-blocks", async ({ sql, userId }) => ({
    blocks: await blocks.listPublicTrainingBlocks(sql, userId),
  })],
  ["POST", "/training-blocks", async ({ sql, userId, body }) => ({
    block: await blocks.postTrainingBlock(
      sql,
      userId,
      postBlockBody.parse(body) as blocks.PostBlockInput,
    ),
  })],
  ["GET", "/training-blocks/:id", ({ sql, userId, params, query }) =>
    blocks.getTrainingBlock(sql, userId, params.id, {
      inviteCode: query.get("invite") ?? undefined,
    })],
  // Joining takes every slot in the block. It is only ever asked for here.
  ["POST", "/training-blocks/:id/join", async ({ sql, userId, params, body }) => ({
    block: await blocks.joinTrainingBlock(sql, userId, params.id, inviteBody.parse(body ?? {})),
  })],
  ["POST", "/training-blocks/:id/requests/:memberId/approve", async ({ sql, userId, params }) => ({
    block: await blocks.resolveBlockRequest(sql, userId, params.id, params.memberId, "approve"),
  })],
  ["POST", "/training-blocks/:id/requests/:memberId/decline", async ({ sql, userId, params }) => ({
    block: await blocks.resolveBlockRequest(sql, userId, params.id, params.memberId, "decline"),
  })],
  // "Helped me stick to it?" — a finisher's one answer, in the week after the goal date.
  ["POST", "/training-blocks/:id/credits", async ({ sql, userId, params, body }) => ({
    block: await blocks.giveCredits(
      sql,
      userId,
      params.id,
      z.object({ toIds: z.array(z.string().min(1)).max(8) }).parse(body).toIds,
    ),
  })],
  // What becomes of a finished block's slots: they carry on, or start the next block.
  ["POST", "/training-blocks/:id/next", async ({ sql, userId, params, body }) => {
    const next = nextBody.parse(body);
    if (next.action === "keep_slots") {
      await blocks.keepBlockSlots(sql, userId, params.id);
      return { ok: true };
    }
    return { block: await blocks.nextTrainingBlock(sql, userId, params.id, next) };
  }],
  ["POST", "/training-blocks/:id/clone", async ({ sql, userId, params, body }) => ({
    block: await blocks.cloneTrainingBlock(sql, userId, params.id, inviteBody.parse(body ?? {})),
  })],
  ["POST", "/training-blocks/:id/slots", async ({ sql, userId, params, body }) => ({
    block: await blocks.addBlockSlot(sql, userId, params.id, blockSlotBody.parse(body)),
  })],
  ["POST", "/training-blocks/:id/leave", async ({ sql, userId, params }) => {
    await blocks.leaveTrainingBlock(sql, userId, params.id);
    return { ok: true };
  }],
  ["GET", "/bookings/:id", async ({ sql, userId, params }) => ({
    booking: await svc.getBooking(sql, userId, params.id),
  })],
  ["POST", "/bookings/:id/approve", async ({ sql, userId, params }) => ({
    booking: await svc.approveBooking(sql, userId, params.id),
  })],
  ["POST", "/bookings/:id/decline", async ({ sql, userId, params }) => ({
    booking: await svc.declineBooking(sql, userId, params.id),
  })],
  ["POST", "/bookings/:id/cancel", async ({ sql, userId, params }) => ({
    booking: await svc.cancelBooking(sql, userId, params.id),
  })],
  ["POST", "/bookings/:id/checkin", async ({ sql, userId, params, body }) => ({
    booking: await svc.checkInGeo(sql, userId, params.id, geoBody.parse(body)),
  })],
  ["POST", "/bookings/:id/checkin-code", async ({ sql, userId, params, body }) => ({
    booking: await svc.checkInCode(
      sql,
      userId,
      params.id,
      z.object({ code: z.string().regex(/^\d{4}$/) }).parse(body).code,
    ),
  })],
  ["GET", "/bookings/:id/messages", async ({ sql, userId, params }) => ({
    messages: await svc.listMessages(sql, userId, params.id),
  })],
  ["POST", "/bookings/:id/messages", async ({ sql, userId, params, body }) => ({
    messages: await svc.sendMessage(
      sql,
      userId,
      params.id,
      z.object({ text: z.string().min(1).max(2000) }).parse(body).text,
    ),
  })],
  ["POST", "/bookings/:id/rating", async ({ sql, userId, params, body }) => ({
    booking: await svc.submitRating(sql, userId, params.id, ratingBody.parse(body)),
  })],
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
  if (!found) return json({ error: pathKnown ? "Method not allowed" : "Not found" }, pathKnown ? 405 : 404);

  try {
    const { assertSameSiteRequest } = await import("../auth/isolation.server");
    assertSameSiteRequest();
    const { auth } = await import("../auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return json({ error: "Unauthorized" }, 401);

    const sql = await getSql();
    await ensureDemoCluster(sql);
    // First contact creates the profile from the auth identity.
    const me = await svc.ensureProfile(sql, {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    });
    // A deleted account's token can outlive it by a cached session; it opens nothing.
    if (me.deleted) return json({ error: "Unauthorized" }, 401);
    if (me.suspended && !OPEN_WHEN_SUSPENDED.has(found.key)) {
      return json({ error: "Your account is paused. Email support@samepace.app." }, 403);
    }

    let body: unknown = undefined;
    if (request.method !== "GET" && request.headers.get("content-length") !== "0") {
      const text = await request.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return json({ error: "Body must be JSON." }, 400);
        }
      }
    }
    const data = await found.handler({
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
    if (request.method !== "GET") {
      await notify.deliverDue(sql).catch((err) => console.error("[push]", err));
    }
    return json(data);
  } catch (err) {
    if (err instanceof svc.PaceError) return json({ error: err.message }, err.status);
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return json({ error: `${first.path.join(".") || "body"}: ${first.message}` }, 400);
    }
    if ((err as { status?: number })?.status === 403) return json({ error: "Forbidden" }, 403);
    console.error("[api]", request.method, path, err);
    return json({ error: "Something broke on our side." }, 500);
  }
}
