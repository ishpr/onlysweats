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
import * as svc from "./service.server";

type Ctx = {
  sql: Sql;
  userId: string;
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

const routes: [method: string, pattern: string, handler: Handler][] = [
  ["GET", "/me", ({ sql, userId }) => svc.getMe(sql, userId)],
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

  ["GET", "/bookings", ({ sql, userId }) => svc.listMyBookings(sql, userId)],
  // "Same time next week": a completed session becomes a standing slot.
  ["POST", "/bookings/:id/repeat", async ({ sql, userId, params }) => ({
    series: await svc.repeatWeekly(sql, userId, params.id),
  })],
  ["GET", "/series", async ({ sql, userId }) => ({ series: await svc.listMySeries(sql, userId) })],
  ["POST", "/series/:id/leave", async ({ sql, userId, params }) => {
    await svc.leaveSeries(sql, userId, params.id);
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
  let found: { handler: Handler; params: Record<string, string> } | null = null;
  let pathKnown = false;
  for (const [method, pattern, handler] of routes) {
    const params = match(pattern, path);
    if (!params) continue;
    pathKnown = true;
    if (method === request.method) {
      found = { handler, params };
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
    await svc.ensureProfile(sql, {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    });

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
      params: found.params,
      query: url.searchParams,
      body,
    });
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
