/**
 * Identity verification (server-only, PRD v0.3 §8). Persona runs the checks — the
 * phone number, the selfie, the ID — and SamePace learns one thing per check: how
 * it came out. No image, number or document passes through or is stored here.
 *
 * The flow: the server creates a Persona inquiry and hands the app a hosted-flow
 * URL; the member finishes it in a browser sheet; Persona's signed webhook moves
 * our row. The app can also ask us to re-read the inquiry, in case the webhook is
 * slow. Outside production, with no Persona key, a `dev` provider stands in so
 * the rest of the product can be built and tested.
 */
import type { Sql } from "../db.ts";
import { enqueue } from "./notify.server.ts";
import { type Verified, type VerificationTier } from "./rules.ts";
import { at, newId, PaceError, verificationEnforced } from "./service.server.ts";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
export type Deps = { env?: Env; fetch?: Fetch };

export type VerificationStatus =
  "created" | "pending" | "needs_review" | "approved" | "declined" | "failed" | "expired";

const PERSONA_API = "https://api.withpersona.com/api/v1";
const PERSONA_VERSION = "2023-01-05";
/** A webhook older than this is refused: a captured one can't be replayed later. */
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;
/** Declines in a month before we stop offering another go and ask for an email. */
const MAX_DECLINES = 3;
const DECLINE_WINDOW_MS = 30 * 24 * 60 * 60_000;

const isProduction = (env: Env) => env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

function personaConfig(env: Env) {
  const apiKey = env.PERSONA_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    templates: {
      member: env.PERSONA_TEMPLATE_MEMBER?.trim(),
      government_id: env.PERSONA_TEMPLATE_GOVERNMENT_ID?.trim(),
    } as Record<VerificationTier, string | undefined>,
    hostedBase: env.PERSONA_HOSTED_BASE?.trim() || "https://inquiry.withpersona.com",
    // Where Persona sends the member when they finish: a page that hands back to the app.
    redirectUri: `${(env.BETTER_AUTH_URL?.trim() || "https://samepace.app").replace(/\/+$/, "")}/verified`,
  };
}

/** Persona when it's configured; a stand-in outside production; otherwise nothing. */
export function providerFor(env: Env = process.env): "persona" | "dev" | null {
  if (personaConfig(env)) return "persona";
  return isProduction(env) ? null : "dev";
}

// ── What a member has verified ───────────────────────────────────────────────

type TierState = "none" | "pending" | "needs_review" | "approved" | "declined";

export type VerificationDTO = {
  /** A member can verify right now. False in production until Persona is set up. */
  available: boolean;
  /** Unverified members are being turned away from public sessions. */
  enforced: boolean;
  provider: "persona" | "dev" | null;
  member: TierState;
  governmentId: TierState;
  /** A report about me was acted on: government ID before any more public sessions. */
  idRequired: boolean;
};

type Row = {
  id: string;
  profile_id: string;
  tier: VerificationTier | "background";
  provider: "persona" | "dev";
  provider_ref: string | null;
  status: VerificationStatus;
  created_at: Date;
};

export async function verifiedOf(sql: Sql, profileId: string): Promise<Verified> {
  const [p] = await sql<{
    verified_member_at: Date | null;
    verified_id_at: Date | null;
    id_required_at: Date | null;
  }>`select verified_member_at, verified_id_at, id_required_at from profiles where id = ${profileId}`;
  return {
    member: Boolean(p?.verified_member_at),
    governmentId: Boolean(p?.verified_id_at),
    idRequired: Boolean(p?.id_required_at),
  };
}

const latest = async (sql: Sql, profileId: string, tier: VerificationTier) =>
  (
    await sql<Row>`
      select * from verifications where profile_id = ${profileId} and tier = ${tier}
      order by created_at desc, id desc limit 1`
  )[0];

function stateOf(done: boolean, row: Row | undefined): TierState {
  if (done) return "approved";
  switch (row?.status) {
    case "created":
    case "pending":
      return "pending";
    case "needs_review":
      return "needs_review";
    case "declined":
    case "failed":
      return "declined";
    default:
      return "none";
  }
}

export async function getVerification(
  sql: Sql,
  userId: string,
  { env = process.env }: Deps = {},
): Promise<VerificationDTO> {
  const v = await verifiedOf(sql, userId);
  const provider = providerFor(env);
  return {
    available: provider !== null,
    enforced: verificationEnforced(env),
    provider,
    member: stateOf(v.member, await latest(sql, userId, "member")),
    governmentId: stateOf(v.governmentId, await latest(sql, userId, "government_id")),
    idRequired: v.idRequired,
  };
}

// ── Persona ──────────────────────────────────────────────────────────────────

async function persona<T>(
  cfg: NonNullable<ReturnType<typeof personaConfig>>,
  doFetch: Fetch,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await doFetch(`${PERSONA_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      accept: "application/json",
      "content-type": "application/json",
      "persona-version": PERSONA_VERSION,
      "key-inflection": "kebab",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // Persona's error text can echo what was sent; log the status, show nothing of it.
    console.error("[verification] persona", method, path.split("/")[1], res.status);
    throw new PaceError(409, "Verification isn’t available right now. Try again in a minute.");
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

type InquiryResponse = {
  data: { id: string; attributes: { status: string; "reference-id"?: string | null } };
  meta?: { "session-token"?: string };
};

const hostedUrl = (
  cfg: NonNullable<ReturnType<typeof personaConfig>>,
  inquiryId: string,
  sessionToken: string | undefined,
) => {
  const u = new URL("/verify", cfg.hostedBase);
  u.searchParams.set("inquiry-id", inquiryId);
  if (sessionToken) u.searchParams.set("session-token", sessionToken);
  u.searchParams.set("redirect-uri", cfg.redirectUri);
  return u.toString();
};

// ── Starting one ─────────────────────────────────────────────────────────────

export type StartedDTO = {
  id: string;
  tier: VerificationTier;
  provider: "persona" | "dev";
  /** Open this in a browser sheet. `null` for the dev stand-in. */
  url: string | null;
};

/**
 * Begin — or pick back up — a check. One open inquiry per tier: coming back to it
 * resumes the same one rather than starting (and paying for) another.
 */
export async function startVerification(
  sql: Sql,
  userId: string,
  tier: VerificationTier,
  now = Date.now(),
  { env = process.env, fetch: doFetch = fetch }: Deps = {},
): Promise<StartedDTO> {
  const provider = providerFor(env);
  if (!provider) throw new PaceError(409, "Verification isn’t open yet.");
  const done = await verifiedOf(sql, userId);
  if (tier === "member" ? done.member : done.governmentId) {
    throw new PaceError(409, "You’re already verified.");
  }
  const open = await latest(sql, userId, tier);
  if (open?.status === "needs_review") {
    throw new PaceError(409, "A person is looking at your last try. You’ll hear from us.");
  }
  const [{ n }] = await sql<{ n: number }>`
    select count(*) as n from verifications
    where profile_id = ${userId} and tier = ${tier} and status in ('declined', 'failed')
      and created_at > ${at(now - DECLINE_WINDOW_MS)}`;
  if (Number(n) >= MAX_DECLINES) {
    throw new PaceError(
      409,
      "That’s three tries. Email support@samepace.app and we’ll sort it out.",
    );
  }

  if (provider === "dev") {
    if (
      open &&
      (open.status === "created" || open.status === "pending") &&
      open.provider === "dev"
    ) {
      return { id: open.id, tier, provider, url: null };
    }
    const id = newId("ver");
    await sql`
      insert into verifications (id, profile_id, tier, provider, status, created_at, updated_at)
      values (${id}, ${userId}, ${tier}, 'dev', 'pending', ${at(now)}, ${at(now)})`;
    return { id, tier, provider, url: null };
  }

  const cfg = personaConfig(env)!;
  const resumable =
    open?.provider === "persona" &&
    open.provider_ref &&
    (open.status === "created" || open.status === "pending" || open.status === "expired");
  if (resumable) {
    const res = await persona<InquiryResponse>(
      cfg,
      doFetch,
      "POST",
      `/inquiries/${encodeURIComponent(open.provider_ref!)}/resume`,
    );
    await sql`
      update verifications set status = 'pending', updated_at = ${at(now)} where id = ${open.id}`;
    return {
      id: open.id,
      tier,
      provider,
      url: hostedUrl(cfg, open.provider_ref!, res.meta?.["session-token"]),
    };
  }

  const template = cfg.templates[tier];
  if (!template) throw new PaceError(409, "Verification isn’t open yet.");
  // The member's id is the only thing we send. Persona collects the rest itself.
  const res = await persona<InquiryResponse>(cfg, doFetch, "POST", "/inquiries", {
    data: { attributes: { "inquiry-template-id": template, "reference-id": userId } },
    meta: { "auto-create-inquiry-session": true },
  });
  const id = newId("ver");
  await sql`
    insert into verifications (id, profile_id, tier, provider, provider_ref, status, created_at, updated_at)
    values (${id}, ${userId}, ${tier}, 'persona', ${res.data.id}, 'created', ${at(now)}, ${at(now)})`;
  return { id, tier, provider, url: hostedUrl(cfg, res.data.id, res.meta?.["session-token"]) };
}

// ── How it came out ──────────────────────────────────────────────────────────

/** Persona's words for an inquiry, in ours. Unknown ones change nothing. */
function fromPersona(status: string): VerificationStatus | null {
  switch (status) {
    case "created":
      return "created";
    case "pending":
    case "completed": // the member is done; Persona hasn't decided yet
      return "pending";
    case "needs_review":
      return "needs_review";
    case "approved":
    case "declined":
    case "failed":
    case "expired":
      return status;
    default:
      return null;
  }
}

const DECIDED = new Set<VerificationStatus>(["approved", "declined", "failed"]);

/**
 * Move one check to a new status, and the profile with it. Events arrive late,
 * twice and out of order, so a decided check only moves to another decision —
 * a stray "pending" after "approved" changes nothing. A later decline does undo
 * an approval: a reviewer at Persona can reverse one.
 */
async function applyStatus(tx: Sql, row: Row, next: VerificationStatus, now: number) {
  if (row.status === next) return;
  if (DECIDED.has(row.status) && !DECIDED.has(next)) return;
  await tx`
    update verifications
    set status = ${next}, updated_at = ${at(now)},
      decided_at = ${DECIDED.has(next) ? at(now) : null}
    where id = ${row.id}`;
  if (row.tier === "background") return;
  const column = row.tier === "member" ? "verified_member_at" : "verified_id_at";

  if (next === "approved") {
    await tx.query(
      `update profiles set ${column} = coalesce(${column}, $2), identity_verified = true where id = $1`,
      [row.profile_id, at(now)],
    );
    await enqueue(
      tx,
      {
        profileId: row.profile_id,
        kind: "verified",
        category: "account",
        title: row.tier === "member" ? "You’re verified" : "Your ID is verified",
        body:
          row.tier === "member"
            ? "Public sessions are open to you."
            : "Women-only sessions that are open to you, and everything else, are unlocked.",
        url: "/",
        dedupeKey: `verified:${row.id}`,
      },
      now,
    );
  } else if (row.status === "approved") {
    // An approval was reversed.
    await tx.query(`update profiles set ${column} = null where id = $1`, [row.profile_id]);
    await tx`
      update profiles set identity_verified = (verified_member_at is not null or verified_id_at is not null)
      where id = ${row.profile_id}`;
  }
  if (next === "declined" || next === "failed") {
    await enqueue(
      tx,
      {
        profileId: row.profile_id,
        kind: "verification_declined",
        category: "account",
        title: "We couldn’t verify you",
        body: "It’s usually the light or a blurry photo. You can try again from You.",
        url: "/verify",
        dedupeKey: `verification_declined:${row.id}`,
      },
      now,
    );
  }
}

/**
 * The app is back from the browser sheet: read the inquiry ourselves rather than
 * wait on the webhook. Only ever the caller's own check.
 */
export async function refreshVerification(
  sql: Sql,
  userId: string,
  verificationId: string,
  now = Date.now(),
  { env = process.env, fetch: doFetch = fetch }: Deps = {},
): Promise<VerificationDTO> {
  const [row] = await sql<Row>`
    select * from verifications where id = ${verificationId} and profile_id = ${userId}`;
  if (!row) throw new PaceError(404, "No such check.");
  const cfg = personaConfig(env);
  if (row.provider === "persona" && row.provider_ref && cfg) {
    const res = await persona<InquiryResponse>(
      cfg,
      doFetch,
      "GET",
      `/inquiries/${encodeURIComponent(row.provider_ref)}`,
    );
    const next = fromPersona(res.data.attributes.status);
    if (next) {
      await sql.transaction(async (tx) => {
        const [locked] = await tx<Row>`select * from verifications where id = ${row.id} for update`;
        if (locked) await applyStatus(tx, locked, next, now);
      });
    }
  }
  return getVerification(sql, userId, { env });
}

/** The dev stand-in's whole flow. Refuses to exist in production. */
export async function devComplete(
  sql: Sql,
  userId: string,
  verificationId: string,
  outcome: "approved" | "declined",
  now = Date.now(),
  { env = process.env }: Deps = {},
): Promise<VerificationDTO> {
  if (providerFor(env) !== "dev") throw new PaceError(404, "Not found");
  await sql.transaction(async (tx) => {
    const [row] = await tx<Row>`
      select * from verifications
      where id = ${verificationId} and profile_id = ${userId} and provider = 'dev' for update`;
    if (!row) throw new PaceError(404, "No such check.");
    await applyStatus(tx, row, outcome, now);
  });
  return getVerification(sql, userId, { env });
}

// ── Webhook ──────────────────────────────────────────────────────────────────

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacSha256(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Length-independent of where the first difference is. */
function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `Persona-Signature: t=<unix>,v1=<hmac>` — several space-separated pairs while a
 * secret is being rotated, and we may hold two secrets ourselves for the same
 * reason. Any pair matching any secret, inside the tolerance, is good.
 */
export async function verifyPersonaSignature(
  rawBody: string,
  header: string | null,
  secrets: string[],
  now = Date.now(),
): Promise<boolean> {
  if (!header || secrets.length === 0) return false;
  for (const pair of header.trim().split(/\s+/)) {
    const parts = Object.fromEntries(
      pair.split(",").map((kv) => kv.split("=") as [string, string]),
    );
    const t = Number(parts.t);
    if (!Number.isFinite(t) || !parts.v1) continue;
    if (Math.abs(now - t * 1000) > WEBHOOK_TOLERANCE_MS) continue;
    for (const secret of secrets) {
      if (sameString(await hmacSha256(secret, `${parts.t}.${rawBody}`), parts.v1)) return true;
    }
  }
  return false;
}

type PersonaEvent = {
  data?: {
    id?: string;
    attributes?: {
      name?: string;
      payload?: {
        data?: { id?: string; attributes?: { status?: string; "reference-id"?: string | null } };
      };
    };
  };
};

/**
 * One signed event from Persona. It can only move a check we created ourselves
 * (matched on the inquiry id) for the member we created it for (the reference id
 * has to agree) — a valid signature on someone else's inquiry changes nothing.
 */
export async function handlePersonaWebhook(
  sql: Sql,
  rawBody: string,
  signature: string | null,
  now = Date.now(),
  { env = process.env }: Deps = {},
): Promise<{ status: 200 | 401; outcome: string }> {
  const secrets = (env.PERSONA_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!(await verifyPersonaSignature(rawBody, signature, secrets, now))) {
    return { status: 401, outcome: "bad_signature" };
  }
  let event: PersonaEvent;
  try {
    event = JSON.parse(rawBody) as PersonaEvent;
  } catch {
    return { status: 200, outcome: "ignored" };
  }
  const eventId = event.data?.id;
  const name = event.data?.attributes?.name ?? "";
  const inquiry = event.data?.attributes?.payload?.data;
  const next = fromPersona(inquiry?.attributes?.status ?? "");
  if (!eventId || !name.startsWith("inquiry.") || !inquiry?.id || !next) {
    return { status: 200, outcome: "ignored" };
  }

  return sql.transaction(async (tx) => {
    const fresh = await tx`
      insert into verification_events (id, received_at) values (${eventId}, ${at(now)})
      on conflict (id) do nothing returning id`;
    if (fresh.length === 0) return { status: 200 as const, outcome: "duplicate" };
    const [row] = await tx<Row>`
      select * from verifications where provider = 'persona' and provider_ref = ${inquiry.id}
      for update`;
    if (!row || inquiry.attributes?.["reference-id"] !== row.profile_id) {
      return { status: 200 as const, outcome: "unknown_inquiry" };
    }
    await applyStatus(tx, row, next, now);
    return { status: 200 as const, outcome: next };
  });
}

// ── Leaving ──────────────────────────────────────────────────────────────────

/**
 * Deleting an account asks Persona to delete what it holds too. Best effort, and
 * before the profile is scrubbed: a failure here must never block the deletion.
 */
export async function redactVerifications(
  sql: Sql,
  userId: string,
  { env = process.env, fetch: doFetch = fetch }: Deps = {},
): Promise<number> {
  const cfg = personaConfig(env);
  if (!cfg) return 0;
  const rows = await sql<{ provider_ref: string }>`
    select provider_ref from verifications
    where profile_id = ${userId} and provider = 'persona' and provider_ref is not null`;
  let redacted = 0;
  for (const { provider_ref } of rows) {
    try {
      await persona(cfg, doFetch, "DELETE", `/inquiries/${encodeURIComponent(provider_ref)}`);
      redacted += 1;
    } catch {
      /* logged in persona(); carry on */
    }
  }
  return redacted;
}
