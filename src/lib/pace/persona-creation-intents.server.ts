/** Durable create/recovery bookkeeping only. This module never calls Persona. */
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import type { VerificationTier } from "./rules.ts";
import { PaceError } from "./service.server.ts";

export type PersonaEnvironment = "sandbox" | "production";
export type CreationIntent = {
  id: string;
  profile_id: string | null;
  tier: VerificationTier | null;
  template_id: string;
  provider_environment: PersonaEnvironment;
  binding_version: 1;
  idempotency_key: string;
  provider_ref: string | null;
  provider_account_ref: string | null;
  first_dispatched_at: Date | null;
  attempts: number;
  cancel_requested: boolean;
  state: "pending" | "review_required";
  review_reason: "replay_expired" | "account_detected" | "inconsistent_inquiry" | null;
  next_attempt_at: Date;
  lease_token: string | null;
  lease_until: Date | null;
  created_at: Date;
  updated_at: Date;
};
export type CreationClaim = CreationIntent & { leaseToken: string };
export const PERSONA_CREATE_REPLAY_MS = 23 * 3_600_000;
export const PERSONA_CREATE_LEASE_MS = 60_000;
const date = (now: number) => new Date(now).toISOString();
const inquiryId = (id: string) => /^inq_[a-zA-Z0-9_-]{1,200}$/.test(id);

/** Call on the root Sql, not inside another transaction: commit before HTTP. */
export async function preparePersonaCreationIntent(
  sql: Sql,
  input: {
    profileId: string;
    tier: VerificationTier;
    templateId: string;
    environment: PersonaEnvironment;
    bindingVersion: 1;
  },
  now = Date.now(),
  assertReady?: (tx: Sql) => Promise<void>,
): Promise<CreationIntent> {
  if (!/^itmpl_[a-zA-Z0-9_-]{1,200}$/.test(input.templateId))
    throw new PaceError(409, "Verification isn’t open yet.");
  return sql.transaction(async (tx) => {
    const [owner] = await tx<{ deleted_at: Date | null; suspended_at: Date | null }>`
      select deleted_at, suspended_at from profiles where id = ${input.profileId} for no key update`;
    if (!owner || owner.deleted_at || owner.suspended_at)
      throw new PaceError(403, "Your account cannot start a check.");
    await assertReady?.(tx);
    const [existing] = await tx<CreationIntent>`select * from persona_creation_intents
      where profile_id = ${input.profileId} and tier = ${input.tier} for update`;
    if (existing) {
      if (
        existing.state === "review_required" ||
        existing.cancel_requested ||
        existing.template_id !== input.templateId ||
        existing.provider_environment !== input.environment
      )
        throw new PaceError(409, "Your earlier verification needs review. Please try again later.");
      return existing;
    }
    const id = `pci_${randomUUID()}`;
    const [created] = await tx<CreationIntent>`insert into persona_creation_intents
      (id, profile_id, tier, template_id, provider_environment, binding_version, idempotency_key,
       next_attempt_at, created_at, updated_at)
      values (${id}, ${input.profileId}, ${input.tier}, ${input.templateId}, ${input.environment},
        ${input.bindingVersion}, ${`samepace-persona-${id}`}, ${date(now)}, ${date(now)}, ${date(now)}) returning *`;
    return created;
  });
}

/** A claim is also the durable first-dispatch marker. Never replay past 23h. */
export async function claimPersonaCreationIntent(
  sql: Sql,
  id: string,
  environment: PersonaEnvironment,
  now = Date.now(),
): Promise<CreationClaim | null> {
  return sql.transaction(async (tx) => {
    const [row] = await tx<CreationIntent>`select * from persona_creation_intents
      where id = ${id} and provider_environment = ${environment} for update`;
    if (
      !row ||
      row.state !== "pending" ||
      +new Date(row.next_attempt_at) > now ||
      (row.lease_until && +new Date(row.lease_until) > now)
    )
      return null;
    if (
      (row.cancel_requested || !row.profile_id) &&
      !row.first_dispatched_at &&
      !row.provider_ref
    ) {
      await tx`delete from persona_creation_intents where id = ${id}`;
      return null;
    }
    if (
      !row.provider_ref &&
      row.first_dispatched_at &&
      now - +new Date(row.first_dispatched_at) >= PERSONA_CREATE_REPLAY_MS
    ) {
      await tx`update persona_creation_intents set state = 'review_required', review_reason = 'replay_expired',
        lease_token = null, lease_until = null, updated_at = ${date(now)} where id = ${id}`;
      return null;
    }
    const leaseToken = randomUUID();
    const [claimed] = await tx<CreationIntent>`update persona_creation_intents set
      lease_token = ${leaseToken}, lease_until = ${date(now + PERSONA_CREATE_LEASE_MS)},
      first_dispatched_at = coalesce(first_dispatched_at, ${date(now)}), attempts = attempts + 1,
      updated_at = ${date(now)} where id = ${id} returning *`;
    return { ...claimed, leaseToken };
  });
}

async function queueRedaction(tx: Sql, row: CreationIntent, ref: string, now: number) {
  await tx`insert into persona_redaction_jobs (provider_ref, provider_environment, next_attempt_at, created_at)
    values (${ref}, ${row.provider_environment}, ${date(now)}, ${date(now)})
    on conflict (provider_ref) do nothing`;
  const [job] = await tx<{ provider_environment: PersonaEnvironment | null }>`
    select provider_environment from persona_redaction_jobs where provider_ref = ${ref}`;
  if (job?.provider_environment !== row.provider_environment)
    throw new Error("Persona redaction environment needs review.");
}

export type CreationCompletion<T> = {
  outcome: "bound" | "redaction_queued" | "review_required" | "stale";
  value?: T;
};

/**
 * First commit the returned ID, then bind under profile→intent locks. A callback
 * rollback cannot erase the provider identity. No hosted URL may escape before
 * this function returns bound. Stale workers never bind, delete, or release work.
 */
export async function completePersonaCreationIntent<T>(
  sql: Sql,
  claim: CreationClaim,
  result: { providerRef: string; valid: boolean; accountDetected?: boolean; accountRef?: string },
  now = Date.now(),
  bind?: (tx: Sql, intent: CreationIntent) => Promise<T>,
): Promise<CreationCompletion<T>> {
  if (!inquiryId(result.providerRef)) throw new Error("Invalid Persona inquiry identifier.");
  if (result.accountRef && !/^act_[a-zA-Z0-9_-]{1,200}$/.test(result.accountRef))
    throw new Error("Invalid Persona account identifier.");
  const recorded = await sql.transaction(async (tx) => {
    const [row] =
      await tx<CreationIntent>`select * from persona_creation_intents where id = ${claim.id} for update`;
    if (
      !row ||
      row.lease_token !== claim.leaseToken ||
      row.provider_environment !== claim.provider_environment
    )
      return null;
    if (row.provider_ref && row.provider_ref !== result.providerRef) {
      await queueRedaction(tx, row, result.providerRef, now);
      await queueRedaction(tx, row, row.provider_ref, now);
      await tx`update persona_creation_intents set state = 'review_required', review_reason = 'inconsistent_inquiry',
        lease_token = null, lease_until = null, updated_at = ${date(now)} where id = ${row.id}`;
      return "review_required" as const;
    }
    const [updated] =
      await tx<CreationIntent>`update persona_creation_intents set provider_ref = ${result.providerRef},
      provider_account_ref = coalesce(${result.accountRef ?? null}, provider_account_ref),
      cancel_requested = cancel_requested or ${!result.valid || !!result.accountDetected || !!result.accountRef},
      review_reason = case when ${!!result.accountDetected || !!result.accountRef} then 'account_detected' else review_reason end,
      updated_at = ${date(now)} where id = ${row.id} returning *`;
    return updated;
  });
  if (recorded === "review_required") return { outcome: "review_required" };
  if (!recorded) return { outcome: "stale" };
  return sql.transaction(async (tx) => {
    const [owner] = recorded.profile_id
      ? await tx<{
          deleted_at: Date | null;
          suspended_at: Date | null;
        }>`select deleted_at, suspended_at
          from profiles where id = ${recorded.profile_id} for no key update`
      : [];
    const [row] =
      await tx<CreationIntent>`select * from persona_creation_intents where id = ${claim.id} for update`;
    if (!row || row.lease_token !== claim.leaseToken || row.state !== "pending")
      return { outcome: "stale" };
    const canceled =
      row.cancel_requested ||
      !row.profile_id ||
      !owner ||
      !!owner.deleted_at ||
      !!owner.suspended_at;
    if (
      !result.valid ||
      canceled ||
      result.accountDetected ||
      row.provider_account_ref ||
      row.review_reason === "account_detected"
    ) {
      await queueRedaction(tx, row, result.providerRef, now);
      if (
        result.accountDetected ||
        row.provider_account_ref ||
        row.review_reason === "account_detected"
      ) {
        await tx`update persona_creation_intents set state = 'review_required', review_reason = 'account_detected',
          lease_token = null, lease_until = null, updated_at = ${date(now)} where id = ${row.id}`;
        return { outcome: "review_required" };
      }
      await tx`delete from persona_creation_intents where id = ${row.id}`;
      return { outcome: "redaction_queued" };
    }
    if (!bind) throw new Error("A valid Persona inquiry needs a binding callback.");
    const value = await bind(tx, row);
    await tx`delete from persona_creation_intents where id = ${row.id}`;
    return { outcome: "bound", value };
  });
}

/** An ambiguous HTTP failure remains recoverable with the exact same key/body. */
export async function failPersonaCreationIntent(sql: Sql, claim: CreationClaim, now = Date.now()) {
  const delay = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(claim.attempts - 1, 8));
  await sql`update persona_creation_intents set lease_token = null, lease_until = null,
    next_attempt_at = ${date(now + delay)}, updated_at = ${date(now)}
    where id = ${claim.id} and lease_token = ${claim.leaseToken} and state = 'pending'`;
}

/** Called inside account deletion while the caller holds the profile lock. */
export async function cancelPersonaCreationIntents(tx: Sql, profileId: string, now = Date.now()) {
  const rows = await tx<CreationIntent>`select * from persona_creation_intents
    where profile_id = ${profileId} order by id for update`;
  for (const row of rows) {
    if (row.provider_ref) await queueRedaction(tx, row, row.provider_ref, now);
    // Never-sent work is safe to discard. Account review obligations are not.
    if (
      (!row.first_dispatched_at || row.provider_ref) &&
      row.state !== "review_required" &&
      !row.provider_account_ref &&
      row.review_reason !== "account_detected"
    ) {
      await tx`delete from persona_creation_intents where id = ${row.id}`;
    } else {
      await tx`update persona_creation_intents set profile_id = null, tier = null, cancel_requested = true,
        updated_at = ${date(now)} where id = ${row.id}`;
    }
  }
}

/** Preserve unexpected Account evidence after binding; never delete the Account. */
export async function recordPersonaAccountReview(
  tx: Sql,
  input: {
    providerRef: string;
    templateId: string;
    environment: PersonaEnvironment;
    accountRef?: string;
  },
  now = Date.now(),
) {
  if (
    !inquiryId(input.providerRef) ||
    !/^itmpl_[a-zA-Z0-9_-]{1,200}$/.test(input.templateId) ||
    (input.accountRef && !/^act_[a-zA-Z0-9_-]{1,200}$/.test(input.accountRef))
  )
    throw new Error("Invalid Persona review identifiers.");
  const id = `pci_${randomUUID()}`;
  const [row] = await tx<CreationIntent>`insert into persona_creation_intents
    (id, template_id, provider_environment, binding_version, idempotency_key, provider_ref,
     provider_account_ref, cancel_requested, state, review_reason, next_attempt_at, created_at, updated_at)
    values (${id}, ${input.templateId}, ${input.environment}, 1, ${`samepace-persona-${id}`}, ${input.providerRef},
      ${input.accountRef ?? null}, true, 'review_required', 'account_detected', ${date(now)}, ${date(now)}, ${date(now)})
    on conflict (provider_ref) do update set state = 'review_required', review_reason = 'account_detected',
      cancel_requested = true, provider_account_ref = coalesce(excluded.provider_account_ref, persona_creation_intents.provider_account_ref),
      lease_token = null, lease_until = null, updated_at = excluded.updated_at
    where persona_creation_intents.provider_environment = excluded.provider_environment
      and persona_creation_intents.template_id = excluded.template_id returning *`;
  if (!row) throw new Error("Persona Account review binding needs reconciliation.");
  await queueRedaction(tx, row, input.providerRef, now);
}

/** Return IDs only; claim each separately before doing any provider work. */
export async function listDuePersonaCreationIntents(
  sql: Sql,
  environment: PersonaEnvironment,
  now = Date.now(),
  limit = 5,
  includeUndispatched = true,
): Promise<string[]> {
  const bounded = Math.max(1, Math.min(20, Math.floor(limit) || 5));
  const rows = await sql<{ id: string }>`select id from persona_creation_intents
    where provider_environment = ${environment} and state = 'pending'
      and (${includeUndispatched} or first_dispatched_at is not null or provider_ref is not null)
      and next_attempt_at <= ${date(now)} and (lease_until is null or lease_until <= ${date(now)})
    order by next_attempt_at, id limit ${bounded}`;
  return rows.map((row) => row.id);
}
