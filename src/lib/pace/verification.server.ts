/**
 * Identity verification (server-only, PRD v0.3 §8). Persona runs the checks — the
 * phone number, the selfie, the ID — and SamePace learns one thing per check: how
 * it came out. No image, number or document is stored or returned to the app.
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
import {
  cancelPersonaCreationIntents,
  claimPersonaCreationIntent,
  completePersonaCreationIntent,
  failPersonaCreationIntent,
  listDuePersonaCreationIntents,
  preparePersonaCreationIntent,
  recordPersonaAccountReview,
  type CreationClaim,
} from "./persona-creation-intents.server.ts";

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

/** Vercel previews run production builds, but use their own sandbox data. */
function allowsSandbox(env: Env) {
  if (env.VERCEL_ENV === "production") return false;
  if (env.VERCEL_ENV === "preview") return true;
  return env.NODE_ENV !== "production";
}

function personaConfig(env: Env) {
  const apiKey = env.PERSONA_API_KEY?.trim();
  if (!apiKey) return null;
  const environment = apiKey.startsWith("persona_sandbox_")
    ? ("sandbox" as const)
    : apiKey.startsWith("persona_production_")
      ? ("production" as const)
      : null;
  if (!environment) return null;
  // Sandbox decisions are simulated. Unknown/placeholder keys must not enable
  // signed webhook writes either: production requires the documented live prefix.
  if (!allowsSandbox(env) && !apiKey.startsWith("persona_production_")) return null;
  return {
    apiKey,
    environment,
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
  if (env.PERSONA_API_KEY?.trim()) return null;
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
  provider_updated_at: Date | null;
  binding_version: 0 | 1;
  provider_template_id: string | null;
  provider_environment: "sandbox" | "production" | null;
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
  idempotencyKey?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await doFetch(`${PERSONA_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        accept: "application/json",
        "content-type": "application/json",
        "persona-version": PERSONA_VERSION,
        "key-inflection": "kebab",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    if (method === "DELETE" && res.status === 404) return null as T;
    if (!res.ok) {
      // Persona's error text can echo what was sent; log the status, show nothing of it.
      console.error("[verification] persona", method, path.split("/")[1], res.status);
      throw new PaceError(409, "Verification isn’t available right now. Try again in a minute.");
    }
    if (res.status === 204) return null as T;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Missing provider response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 512 * 1024) {
        await reader.cancel();
        throw new Error("Provider response too large");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new PaceError(409, "Verification isn’t available right now. Try again in a minute.");
  } finally {
    clearTimeout(timer);
  }
}

type InquiryResource = {
  id: string;
  type?: string;
  attributes: { status: string; "reference-id"?: string | null; "updated-at"?: string };
  relationships?: {
    account?: { data?: { id?: string; type?: string } | null };
    "inquiry-template"?: { data?: { id?: string; type?: string } | null };
  };
};
type InquiryResponse = {
  data: InquiryResource;
  meta?: { "session-token"?: string };
  included?: { id?: string; type?: string }[];
};

type InquiryBinding = {
  providerRef: string;
  profileId: string | null;
  templateId: string | null;
  environment: "sandbox" | "production" | null;
  version: 0 | 1;
};
const inquiryIdValid = (id: unknown): id is string =>
  typeof id === "string" && /^inq_[a-zA-Z0-9_-]{1,200}$/.test(id);
const accountOf = (res: InquiryResponse) => res?.data?.relationships?.account?.data;
const accountDetected = (res: InquiryResponse) =>
  accountOf(res) != null ||
  (Array.isArray(res?.included) && res.included.some((item) => item?.type === "account"));
const accountReference = (res: InquiryResponse) => {
  const id =
    accountOf(res)?.id ??
    (Array.isArray(res?.included)
      ? res.included.find((item) => item?.type === "account")?.id
      : undefined);
  return typeof id === "string" && /^act_[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : undefined;
};

/** New accountless rows trust only the immutable server-created binding. */
function matchesInquiry(
  res: InquiryResponse,
  binding: InquiryBinding,
  cfg: NonNullable<ReturnType<typeof personaConfig>>,
  allowAccount = false,
) {
  const inquiry = res?.data;
  if (
    !inquiryIdValid(inquiry?.id) ||
    inquiry.id !== binding.providerRef ||
    inquiry.type !== "inquiry"
  )
    return false;
  if (binding.environment !== cfg.environment) return false;
  if (binding.version === 1 && (!binding.templateId || !binding.environment)) return false;
  const reference = inquiry.attributes?.["reference-id"];
  // Legacy rows never gain permission to omit the provider reference implicitly.
  if (
    binding.version === 0
      ? reference !== binding.profileId || !binding.profileId
      : reference != null && reference !== binding.profileId
  )
    return false;
  const template = inquiry.relationships?.["inquiry-template"]?.data;
  if (
    !binding.templateId ||
    template?.type !== "inquiry-template" ||
    template.id !== binding.templateId
  )
    return false;
  return allowAccount || (accountOf(res) === null && !accountDetected(res));
}

type AccountReview = Parameters<typeof recordPersonaAccountReview>[1];
function accountReviewFor(
  res: InquiryResponse,
  binding: InquiryBinding,
  cfg: NonNullable<ReturnType<typeof personaConfig>>,
): AccountReview | null {
  if (!accountDetected(res) || !matchesInquiry(res, binding, cfg, true)) return null;
  return {
    providerRef: binding.providerRef,
    templateId: binding.templateId!,
    environment: cfg.environment,
    accountRef: accountReference(res),
  };
}

function bindingFor(row: Row, cfg: NonNullable<ReturnType<typeof personaConfig>>): InquiryBinding {
  return {
    providerRef: row.provider_ref ?? "",
    profileId: row.profile_id,
    templateId:
      row.provider_template_id ??
      (row.binding_version === 0 ? (cfg.templates[row.tier as VerificationTier] ?? null) : null),
    environment: row.provider_environment,
    version: row.binding_version,
  };
}

const sessionTokenOf = (res: InquiryResponse) => {
  const token = res?.meta?.["session-token"];
  return typeof token === "string" && token.length > 0 && token.length <= 16_384 ? token : null;
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
type CreationPlan = {
  create: true;
  cfg: NonNullable<ReturnType<typeof personaConfig>>;
  template: string;
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
  let review: AccountReview | null = null;
  let plan: StartedDTO | CreationPlan;
  try {
    plan = await sql.transaction(async (tx) => {
      const [owner] = await tx<{ deleted_at: Date | null; suspended_at: Date | null }>`
      select deleted_at, suspended_at from profiles where id = ${userId} for no key update`;
      if (!owner || owner.deleted_at || owner.suspended_at)
        throw new PaceError(403, "Your account cannot start a check.");
      return startLocked(tx, userId, tier, now, { env, fetch: doFetch }, (found) => {
        review = found;
      });
    });
  } catch (error) {
    if (review) await sql.transaction((tx) => recordPersonaAccountReview(tx, review!, now));
    throw error;
  }
  if (!("create" in plan)) return plan;
  // This transaction must commit before HTTP, so a lost create response can be
  // recovered even when the member deletes the account before the retry.
  const intent = await preparePersonaCreationIntent(
    sql,
    {
      profileId: userId,
      tier,
      templateId: plan.template,
      environment: plan.cfg.environment,
      bindingVersion: 1,
    },
    now,
    async (tx) => {
      const done = await verifiedOf(tx, userId);
      const current = await latest(tx, userId, tier);
      if (
        (tier === "member" ? done.member : done.governmentId) ||
        current?.status === "needs_review" ||
        (current?.provider === "persona" &&
          ["created", "pending", "expired"].includes(current.status))
      )
        throw new PaceError(
          409,
          "Your verification is already in progress. Please try again in a moment.",
        );
      await assertDeclineBudget(tx, userId, tier, now);
    },
  );
  const claim = await claimPersonaCreationIntent(sql, intent.id, plan.cfg.environment, now);
  if (!claim)
    throw new PaceError(409, "Your verification is being prepared. Please try again in a moment.");
  const started = await executeCreation(sql, claim, plan.cfg, doFetch, now, true);
  if (!started)
    throw new PaceError(409, "Verification isn’t available right now. Try again in a minute.");
  return started;
}

async function startLocked(
  sql: Sql,
  userId: string,
  tier: VerificationTier,
  now: number,
  { env = process.env, fetch: doFetch = fetch }: Deps,
  onAccount: (review: AccountReview) => void,
): Promise<StartedDTO | CreationPlan> {
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
  await assertDeclineBudget(sql, userId, tier, now);

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
    if (open.provider_environment !== cfg.environment)
      throw new PaceError(409, "This check belongs to a different verification environment.");
    const res = await persona<InquiryResponse>(
      cfg,
      doFetch,
      "POST",
      `/inquiries/${encodeURIComponent(open.provider_ref!)}/resume`,
    );
    const review = accountReviewFor(res, bindingFor(open, cfg), cfg);
    if (review) onAccount(review);
    const token = sessionTokenOf(res);
    if (!matchesInquiry(res, bindingFor(open, cfg), cfg) || !token)
      throw new PaceError(409, "Verification returned an invalid response.");
    const next = fromPersona(res.data.attributes.status);
    const providerAt = validProviderTime(res, now);
    if (providerAt === null) throw new PaceError(409, "Verification returned an invalid response.");
    if (next) await applyStatus(sql, open, next, now, providerAt);
    return {
      id: open.id,
      tier,
      provider,
      url: hostedUrl(cfg, open.provider_ref!, token),
    };
  }

  const template = cfg.templates[tier];
  if (!template) throw new PaceError(409, "Verification isn’t open yet.");
  return { create: true, cfg, template };
}

function validProviderTime(res: InquiryResponse, now: number) {
  const time = Date.parse(res?.data?.attributes?.["updated-at"] ?? "");
  return Number.isFinite(time) && time <= now + WEBHOOK_TOLERANCE_MS ? time : null;
}

async function assertDeclineBudget(sql: Sql, userId: string, tier: VerificationTier, now: number) {
  const [{ n }] = await sql<{ n: number }>`select count(*) as n from verifications
    where profile_id = ${userId} and tier = ${tier} and status in ('declined', 'failed')
      and created_at > ${at(now - DECLINE_WINDOW_MS)}`;
  if (Number(n) >= MAX_DECLINES)
    throw new PaceError(
      409,
      "That’s three tries. Email support@samepace.app and we’ll sort it out.",
    );
}

async function executeCreation(
  sql: Sql,
  claim: CreationClaim,
  cfg: NonNullable<ReturnType<typeof personaConfig>>,
  doFetch: Fetch,
  now: number,
  issueUrl: boolean,
): Promise<StartedDTO | null> {
  try {
    if (claim.provider_ref && (claim.cancel_requested || !claim.profile_id)) {
      await completePersonaCreationIntent(
        sql,
        claim,
        { providerRef: claim.provider_ref, valid: false },
        now,
      );
      return null;
    }
    let res = claim.provider_ref
      ? await persona<InquiryResponse>(
          cfg,
          doFetch,
          "GET",
          `/inquiries/${encodeURIComponent(claim.provider_ref)}`,
        )
      : await persona<InquiryResponse>(
          cfg,
          doFetch,
          "POST",
          "/inquiries",
          {
            data: { attributes: { "inquiry-template-id": claim.template_id } },
            meta: { "auto-create-inquiry-session": true, "auto-create-account": false },
          },
          claim.idempotency_key,
        );
    if (
      !inquiryIdValid(res?.data?.id) ||
      (claim.provider_ref && res.data.id !== claim.provider_ref)
    )
      throw new PaceError(409, "Verification returned an invalid response.");
    const providerRef = res.data.id;
    const binding: InquiryBinding = {
      providerRef,
      profileId: claim.profile_id,
      templateId: claim.template_id,
      environment: claim.provider_environment,
      version: 1,
    };
    let valid = matchesInquiry(res, binding, cfg) && validProviderTime(res, now) !== null;
    if (claim.provider_ref && issueUrl && valid && claim.profile_id && !claim.cancel_requested) {
      res = await persona<InquiryResponse>(
        cfg,
        doFetch,
        "POST",
        `/inquiries/${encodeURIComponent(providerRef)}/resume`,
      );
      valid = matchesInquiry(res, binding, cfg) && validProviderTime(res, now) !== null;
    }
    const token = sessionTokenOf(res);
    if (issueUrl && !token) valid = false;
    const completed = await completePersonaCreationIntent<StartedDTO | null>(
      sql,
      claim,
      {
        providerRef,
        valid,
        accountDetected: accountDetected(res),
        accountRef: accountReference(res),
      },
      now,
      async (tx, intent) => {
        const owner = intent.profile_id!;
        const tier = intent.tier!;
        const done = await verifiedOf(tx, owner);
        const current = await latest(tx, owner, tier);
        if (
          (tier === "member" ? done.member : done.governmentId) ||
          (current && +new Date(current.created_at) >= +new Date(intent.created_at))
        ) {
          await tx`insert into persona_redaction_jobs (provider_ref, provider_environment, next_attempt_at, created_at)
          values (${providerRef}, ${cfg.environment}, ${at(now)}, ${at(now)}) on conflict (provider_ref) do nothing`;
          return null;
        }
        const id = newId("ver");
        const [row] = await tx<Row>`insert into verifications
        (id, profile_id, tier, provider, provider_ref, status, binding_version, provider_template_id, provider_environment, created_at, updated_at)
        values (${id}, ${owner}, ${tier}, 'persona', ${providerRef}, 'created', 1, ${intent.template_id}, ${intent.provider_environment}, ${at(now)}, ${at(now)}) returning *`;
        const next = fromPersona(res.data.attributes.status);
        if (next) await applyStatus(tx, row, next, now, validProviderTime(res, now)!);
        return {
          id,
          tier,
          provider: "persona",
          url: token ? hostedUrl(cfg, providerRef, token) : null,
        };
      },
    );
    // Deletion may remove a known-ID intent while an authenticated GET is in
    // flight. Keep any newly discovered Account evidence without binding it.
    if (completed.outcome === "stale") {
      const review = accountReviewFor(res, binding, cfg);
      if (review) await sql.transaction((tx) => recordPersonaAccountReview(tx, review, now));
    }
    return completed.outcome === "bound" ? (completed.value ?? null) : null;
  } catch (error) {
    await failPersonaCreationIntent(sql, claim, now);
    throw error;
  }
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
async function applyStatus(
  tx: Sql,
  row: Row,
  next: VerificationStatus,
  now: number,
  providerAt?: number,
) {
  if (providerAt !== undefined) {
    const prior = row.provider_updated_at ? +new Date(row.provider_updated_at) : -Infinity;
    if (providerAt < prior || (providerAt === prior && next !== "declined" && next !== "failed"))
      return;
    await tx`update verifications set provider_updated_at = ${at(providerAt)} where id = ${row.id}`;
  }
  if ((await latest(tx, row.profile_id, row.tier as VerificationTier))?.id !== row.id) return;
  const [owner] = await tx<{
    deleted_at: Date | null;
  }>`select deleted_at from profiles where id = ${row.profile_id}`;
  if (!owner || owner.deleted_at) return;
  if (row.status === next) return;
  if (providerAt === undefined && DECIDED.has(row.status) && !DECIDED.has(next)) return;
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
    if (row.provider_environment !== cfg.environment)
      throw new PaceError(409, "This check belongs to a different verification environment.");
    const res = await persona<InquiryResponse>(
      cfg,
      doFetch,
      "GET",
      `/inquiries/${encodeURIComponent(row.provider_ref)}`,
    );
    const review = accountReviewFor(res, bindingFor(row, cfg), cfg);
    if (review) await sql.transaction((tx) => recordPersonaAccountReview(tx, review, now));
    if (!matchesInquiry(res, bindingFor(row, cfg), cfg))
      throw new PaceError(409, "Verification returned an invalid response.");
    const next = fromPersona(res.data.attributes.status);
    const providerAt = Date.parse(res.data.attributes["updated-at"] ?? "");
    if (!Number.isFinite(providerAt) || providerAt > now + WEBHOOK_TOLERANCE_MS)
      throw new PaceError(409, "Verification returned an invalid response.");
    if (next) {
      await sql.transaction(async (tx) => {
        const [owner] = await tx<{
          deleted_at: Date | null;
        }>`select deleted_at from profiles where id = ${userId} for no key update`;
        const [locked] = await tx<Row>`select * from verifications where id = ${row.id} for update`;
        if (
          !owner ||
          owner.deleted_at ||
          !locked ||
          (await latest(tx, userId, row.tier as VerificationTier))?.id !== row.id
        )
          throw new PaceError(409, "This check is no longer active.");
        if (!matchesInquiry(res, bindingFor(locked, cfg), cfg))
          throw new PaceError(409, "Verification returned an invalid response.");
        await applyStatus(tx, locked, next, now, providerAt);
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
    await tx`select id from profiles where id = ${userId} for no key update`;
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
      "created-at"?: string;
      payload?: {
        data?: InquiryResource;
        included?: { id?: string; type?: string }[];
      };
    };
  };
};

/**
 * One signed event from Persona. It can only move a check we created ourselves
 * (matched on the inquiry id) for the member and template we bound at creation.
 * Legacy rows still require the remote reference; new accountless rows allow it
 * to be absent, but reject a supplied mismatch. Unknown or old checks never bind.
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
  // A valid sandbox signature does not authorize a production state change.
  // Require the same provider configuration used by create and refresh.
  const cfg = personaConfig(env);
  if (!cfg) return { status: 401, outcome: "provider_unavailable" };
  let event: PersonaEvent;
  try {
    event = JSON.parse(rawBody) as PersonaEvent;
  } catch {
    return { status: 200, outcome: "ignored" };
  }
  if (!event || typeof event !== "object") return { status: 200, outcome: "ignored" };
  const eventId = event.data?.id;
  const name = event.data?.attributes?.name ?? "";
  const inquiry = event.data?.attributes?.payload?.data;
  const next = fromPersona(inquiry?.attributes?.status ?? "");
  const providerAt = Date.parse(event.data?.attributes?.["created-at"] ?? "");
  if (
    !eventId ||
    typeof eventId !== "string" ||
    eventId.length > 255 ||
    typeof name !== "string" ||
    !name.startsWith("inquiry.") ||
    typeof inquiry?.id !== "string" ||
    !/^inq_[a-zA-Z0-9_-]{1,200}$/.test(inquiry.id) ||
    !next ||
    !Number.isFinite(providerAt) ||
    providerAt > now + WEBHOOK_TOLERANCE_MS
  ) {
    return { status: 200, outcome: "ignored" };
  }

  return sql.transaction(async (tx) => {
    const [reference] = await tx<{
      profile_id: string;
    }>`select profile_id from verifications where provider = 'persona' and provider_ref = ${inquiry.id}`;
    if (!reference) return { status: 200 as const, outcome: "unknown_inquiry" };
    await tx`select id from profiles where id = ${reference.profile_id} for no key update`;
    const [row] = await tx<Row>`
      select * from verifications where provider = 'persona' and provider_ref = ${inquiry.id}
      for update`;
    if (!row) return { status: 200 as const, outcome: "unknown_inquiry" };
    const response = { data: inquiry, included: event.data?.attributes?.payload?.included };
    const review = accountReviewFor(response, bindingFor(row, cfg), cfg);
    if (review) {
      await recordPersonaAccountReview(tx, review, now);
      return { status: 200 as const, outcome: "account_review_required" };
    }
    if (!matchesInquiry(response, bindingFor(row, cfg), cfg)) {
      return { status: 200 as const, outcome: "unknown_inquiry" };
    }
    if ((await latest(tx, row.profile_id, row.tier as VerificationTier))?.id !== row.id)
      return { status: 200 as const, outcome: "superseded_inquiry" };
    const [owner] = await tx<{
      deleted_at: Date | null;
    }>`select deleted_at from profiles where id = ${row.profile_id}`;
    if (!owner || owner.deleted_at) return { status: 200 as const, outcome: "unknown_inquiry" };
    const fresh = await tx`
      insert into verification_events (id, received_at) values (${eventId}, ${at(now)})
      on conflict (id) do nothing returning id`;
    if (fresh.length === 0) return { status: 200 as const, outcome: "duplicate" };
    await applyStatus(tx, row, next, now, providerAt);
    return { status: 200 as const, outcome: next };
  });
}

// ── Leaving ──────────────────────────────────────────────────────────────────

/** Called inside account deletion, while its profile lock is held. */
export async function queueVerificationRedactions(sql: Sql, userId: string, now = Date.now()) {
  await cancelPersonaCreationIntents(sql, userId, now);
  await sql`insert into persona_redaction_jobs (provider_ref, provider_environment, next_attempt_at, created_at)
    select provider_ref, provider_environment, ${at(now)}, ${at(now)} from verifications
    where profile_id = ${userId} and provider = 'persona' and provider_ref is not null
    on conflict (provider_ref) do nothing`;
}

/** Recover bounded create attempts without exposing a hosted session URL. */
export async function recoverPersonaCreations(
  sql: Sql,
  now = Date.now(),
  { env = process.env, fetch: doFetch = fetch }: Deps = {},
) {
  const result = { bound: 0, reconciled: 0, failed: 0 };
  const cfg = personaConfig(env);
  if (!cfg) return result;
  const ids = await listDuePersonaCreationIntents(sql, cfg.environment, now, 5);
  for (const id of ids) {
    const claim = await claimPersonaCreationIntent(sql, id, cfg.environment, now);
    if (!claim) continue;
    try {
      const bound = await executeCreation(sql, claim, cfg, doFetch, now, false);
      if (bound) result.bound++;
      else result.reconciled++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** Bounded, leased retries; absent credentials preserve the deletion obligation. */
export async function retryPersonaRedactions(
  sql: Sql,
  now = Date.now(),
  { env = process.env, fetch: doFetch = fetch }: Deps = {},
  refs?: string[],
) {
  const cfg = personaConfig(env);
  const result = { redacted: 0, failed: 0 };
  if (!cfg) return result;
  for (let n = 0; n < 5; n++) {
    const [job] = await sql<{ provider_ref: string; attempts: number }>`
      update persona_redaction_jobs set state = 'processing', attempts = attempts + 1,
        next_attempt_at = ${at(now + 60_000)}
      where provider_ref in (select provider_ref from persona_redaction_jobs
        where next_attempt_at <= ${at(now)}
          and provider_environment = ${cfg.environment}
          and (${refs ?? null}::text[] is null or provider_ref = any(${refs ?? null}))
        order by next_attempt_at, provider_ref for update skip locked limit 1)
      returning provider_ref, attempts`;
    if (!job) break;
    try {
      await persona(cfg, doFetch, "DELETE", `/inquiries/${encodeURIComponent(job.provider_ref)}`);
      const removed =
        await sql`delete from persona_redaction_jobs where provider_ref = ${job.provider_ref}
        and attempts = ${job.attempts} returning provider_ref`;
      result.redacted += removed.length;
    } catch {
      const delay = Math.min(24 * 3600_000, 60_000 * 2 ** Math.min(job.attempts, 10));
      await sql`update persona_redaction_jobs set state = 'failed', next_attempt_at = ${at(now + delay)}
        where provider_ref = ${job.provider_ref} and attempts = ${job.attempts}`;
      result.failed++;
    }
  }
  await sql`delete from verification_events where received_at < ${at(now - 30 * 86400_000)}`;
  return result;
}

/** Compatibility helper for an immediate attempt; failures remain durable. */
export async function redactVerifications(sql: Sql, userId: string, deps: Deps = {}) {
  await queueVerificationRedactions(sql, userId);
  const refs = await sql<{ provider_ref: string }>`select provider_ref from verifications
    where profile_id = ${userId} and provider = 'persona' and provider_ref is not null`;
  return (
    await retryPersonaRedactions(
      sql,
      Date.now(),
      deps,
      refs.map((r) => r.provider_ref),
    )
  ).redacted;
}
