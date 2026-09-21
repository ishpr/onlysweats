import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import {
  FITNESS_AI_NOTICE_VERSION,
  type ExerciseDraft,
  type StrengthLogInput,
} from "../../../shared/fitness.ts";
import {
  FITNESS_PILOT_NOTICE_VERSION,
  type FitnessDraftMeasurement,
  type FitnessLoggingSession,
  type FitnessPilotConsent,
  type FitnessPilotFeedback,
  type FitnessPilotOutcome,
  type FitnessPilotOverview,
  type FitnessSaveMeasurement,
} from "../../../shared/fitness-outcomes.ts";
import { consentInput, FitnessError, fitnessId } from "./contracts.ts";

const RETENTION_MS = 30 * 86400_000;
const SESSION_MS = 2 * 3600_000;
const iso = (value: Date | string) => new Date(value).toISOString();
const fields = ["exerciseId", "sets", "reps", "weight", "unit"] as const;
type Field = (typeof fields)[number];
type Fingerprints = Partial<Record<Field, string>>;
type ConsentRow = {
  enabled: boolean;
  generation: string;
  notice_version: string;
  updated_at: Date | string;
};
type SessionRow = {
  id: string;
  consent_generation: string;
  started_at: Date | string;
  expires_at: Date | string;
  ai_request_marker: string | null;
  draft_id: string | null;
  draft_status: ExerciseDraft["status"] | null;
  field_salt: string;
  field_hashes: Fingerprints;
  log_id: string | null;
  save_fingerprint: string | null;
  saved_at: Date | string | null;
  elapsed_ms: number | null;
  mode: FitnessPilotOutcome["mode"];
  suggested_fields: number;
  unchanged_fields: number | null;
  changed_fields: number | null;
  filled_fields: number | null;
  comparison_revision: number | null;
  feedback: FitnessPilotFeedback | null;
};
type PreparedDraft = FitnessDraftMeasurement & { generation: string };
type PreparedSave = {
  row: SessionRow;
  fingerprint: string;
  mode: FitnessPilotOutcome["mode"];
  existingLogId?: string;
};
export const pilotFeedbackInput = z.strictObject({
  helpfulness: z.enum(["helpful", "neutral", "not_helpful", "unknown"]),
  timeSaved: z.enum(["yes", "no", "unsure"]),
});
const hash = (salt: string, field: string, value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify([salt, field, value]))
    .digest("hex");
async function lockOwner(sql: Sql, userId: string) {
  const [owner] = await sql`select id from "user" where id = ${userId} for update`;
  if (!owner) throw new FitnessError(401, "Unauthorized");
}
async function consentRow(sql: Sql, userId: string) {
  const [row] =
    await sql<ConsentRow>`select * from fitness_pilot_consents where user_id = ${userId}`;
  return row;
}
const active = (row?: ConsentRow) =>
  Boolean(row?.enabled && row.notice_version === FITNESS_PILOT_NOTICE_VERSION);
function consentView(row?: ConsentRow): FitnessPilotConsent {
  return {
    enabled: active(row),
    generation: row?.generation ?? null,
    noticeVersion: FITNESS_PILOT_NOTICE_VERSION,
    updatedAt: row ? iso(row.updated_at) : null,
  };
}
async function aiMarker(sql: Sql, userId: string): Promise<string | null> {
  const [row] = await sql<{
    last_requested_at: Date | string | null;
    request_day: Date | string | null;
    request_count: number;
  }>`select last_requested_at, request_day, request_count from fitness_consents where user_id = ${userId}`;
  return row
    ? JSON.stringify([
        row.last_requested_at ? iso(row.last_requested_at) : null,
        row.request_day ? iso(row.request_day).slice(0, 10) : null,
        row.request_count,
      ])
    : null;
}
export async function readPilotConsent(sql: Sql, userId: string): Promise<FitnessPilotConsent> {
  return consentView(await consentRow(sql, userId));
}
export async function getPilotConsent(sql: Sql, userId: string): Promise<FitnessPilotConsent> {
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    return readPilotConsent(tx, userId);
  });
}
export async function setPilotConsent(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<FitnessPilotConsent> {
  const { enabled } = consentInput.parse(input);
  return sql.transaction(async (tx) => {
    // Profile-first matches account deletion/moderation ordering. Revocation
    // remains available even when normal account actions are restricted.
    if (enabled) {
      const [profile] = await tx<{
        suspended_at: Date | null;
        deleted_at: Date | null;
      }>`select suspended_at, deleted_at from profiles where id = ${userId} for no key update`;
      if (profile?.suspended_at || profile?.deleted_at)
        throw new FitnessError(403, "This account cannot join the feedback pilot.");
    }
    await lockOwner(tx, userId);
    if (enabled) {
      const [ai] = await tx<{
        enabled: boolean;
        notice_version: string;
      }>`select enabled, notice_version from fitness_consents where user_id = ${userId}`;
      if (!ai?.enabled || ai.notice_version !== FITNESS_AI_NOTICE_VERSION)
        throw new FitnessError(
          403,
          "Enable AI assistance before joining the optional feedback pilot.",
        );
    }
    const previous = await consentRow(tx, userId);
    if (previous?.enabled === enabled && previous.notice_version === FITNESS_PILOT_NOTICE_VERSION)
      return consentView(previous);
    await tx`delete from fitness_logging_sessions where user_id = ${userId}`;
    const [row] =
      await tx<ConsentRow>`insert into fitness_pilot_consents (user_id, enabled, generation, notice_version, updated_at)
      values (${userId}, ${enabled}, ${randomUUID()}, ${FITNESS_PILOT_NOTICE_VERSION}, ${new Date(now)})
      on conflict (user_id) do update set enabled = excluded.enabled, generation = excluded.generation,
      notice_version = excluded.notice_version, updated_at = excluded.updated_at returning *`;
    return consentView(row);
  });
}
/** Called while holding the same owner lock as AI consent changes. */
export async function revokePilotMeasurements(sql: Sql, userId: string, now: number) {
  await sql`delete from fitness_logging_sessions where user_id = ${userId}`;
  await sql`update fitness_pilot_consents set enabled = false, generation = ${randomUUID()}, updated_at = ${new Date(now)} where user_id = ${userId}`;
}
export async function startLoggingSession(
  sql: Sql,
  userId: string,
  input: unknown = {},
  now = Date.now(),
): Promise<FitnessLoggingSession | null> {
  z.strictObject({}).parse(input);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const consent = await consentRow(tx, userId);
    if (!active(consent)) return null;
    await tx`delete from fitness_logging_sessions where user_id = ${userId} and started_at < ${new Date(now - RETENTION_MS)}`;
    const [limits] = await tx<{ open: number; today: number }>`select
      count(*) filter (where saved_at is null and expires_at > ${new Date(now)})::int as open,
      count(*) filter (where started_at >= ${new Date(now - 86400_000)})::int as today
      from fitness_logging_sessions where user_id = ${userId}`;
    if (limits.open >= 20 || limits.today >= 200)
      throw new FitnessError(
        429,
        "Feedback measurement limit reached. You can still save your workout.",
      );
    const id = randomUUID();
    const expiresAt = new Date(now + SESSION_MS).toISOString();
    await tx`insert into fitness_logging_sessions (user_id, id, consent_generation, started_at, expires_at, ai_request_marker, field_salt)
      values (${userId}, ${id}, ${consent!.generation}, ${new Date(now)}, ${expiresAt}, ${await aiMarker(tx, userId)}, ${randomUUID()})`;
    return { id, expiresAt };
  });
}
async function findSession(
  sql: Sql,
  userId: string,
  id: string,
  now: number,
): Promise<SessionRow | undefined> {
  const [row] =
    await sql<SessionRow>`select s.* from fitness_logging_sessions s join fitness_pilot_consents c on c.user_id = s.user_id
    where s.user_id = ${userId} and s.id = ${id} and c.enabled and c.notice_version = ${FITNESS_PILOT_NOTICE_VERSION}
    and s.consent_generation = c.generation and s.started_at >= ${new Date(now - RETENTION_MS)}`;
  return row;
}
export function pilotOutcomeView(row: SessionRow, now: number): FitnessPilotOutcome {
  return {
    sessionId: row.id,
    logId: row.log_id,
    startedAt: iso(row.started_at),
    savedAt: row.saved_at ? iso(row.saved_at) : null,
    status: row.saved_at ? "saved" : new Date(row.expires_at).getTime() <= now ? "expired" : "open",
    mode: row.mode,
    draftStatus: row.draft_status,
    elapsedMs: row.elapsed_ms,
    suggestedFields: row.suggested_fields,
    unchangedSuggestedFields: row.unchanged_fields,
    changedSuggestedFields: row.changed_fields,
    filledMissingFields: row.filled_fields,
    comparisonRevision: row.comparison_revision,
    feedback: row.feedback,
  };
}
/** Export helper used under an existing authenticated owner transaction. */
export async function readLoggingOutcome(
  sql: Sql,
  userId: string,
  id: string,
  now = Date.now(),
): Promise<FitnessPilotOutcome> {
  const row = await findSession(sql, userId, fitnessId.parse(id), now);
  if (!row) throw new FitnessError(404, "Feedback session not found.");
  return pilotOutcomeView(row, now);
}
export async function getLoggingOutcome(
  sql: Sql,
  userId: string,
  id: string,
  now = Date.now(),
): Promise<FitnessPilotOutcome> {
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    return readLoggingOutcome(tx, userId, id, now);
  });
}
export async function recordPilotFeedback(
  sql: Sql,
  userId: string,
  id: string,
  input: unknown,
  now = Date.now(),
): Promise<FitnessPilotOutcome> {
  const feedback = pilotFeedbackInput.parse(input);
  const sessionId = fitnessId.parse(id);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const row = await findSession(tx, userId, sessionId, now);
    if (!row) throw new FitnessError(404, "Feedback session not found.");
    if (!row.saved_at) throw new FitnessError(409, "Save the workout before sharing feedback.");
    if (
      row.feedback &&
      (row.feedback.helpfulness !== feedback.helpfulness ||
        row.feedback.timeSaved !== feedback.timeSaved)
    )
      throw new FitnessError(409, "Feedback has already been recorded.");
    if (!row.feedback)
      await tx`update fitness_logging_sessions set feedback = ${JSON.stringify(feedback)}::jsonb where user_id = ${userId} and id = ${sessionId}`;
    return pilotOutcomeView({ ...row, feedback }, now);
  });
}
/** Latest request wins. An older in-flight result cannot replace this receipt. */
export async function preparePilotDraft(
  sql: Sql,
  userId: string,
  sessionId: string | undefined,
  now: number,
): Promise<PreparedDraft | null> {
  if (!sessionId || !active(await consentRow(sql, userId))) return null;
  const row = await findSession(sql, userId, sessionId, now);
  if (!row) throw new FitnessError(404, "Feedback session not found.");
  if (row.saved_at || new Date(row.expires_at).getTime() <= now) return null;
  const draftId = randomUUID();
  await sql`update fitness_logging_sessions set draft_id = ${draftId}, draft_status = null, field_hashes = '{}'::jsonb,
    suggested_fields = 0, model = null, question_version = null, mode = 'unobserved_draft_use' where user_id = ${userId} and id = ${sessionId}`;
  return { sessionId, draftId, generation: row.consent_generation };
}
export async function attachPilotDraft(
  sql: Sql,
  userId: string,
  prepared: PreparedDraft | null,
  draft: ExerciseDraft,
  now: number,
): Promise<ExerciseDraft> {
  if (!prepared) return draft;
  const row = await findSession(sql, userId, prepared.sessionId, now);
  if (
    !row ||
    row.saved_at ||
    row.draft_id !== prepared.draftId ||
    row.consent_generation !== prepared.generation ||
    new Date(row.expires_at).getTime() <= now
  )
    return draft;
  const fingerprints = Object.fromEntries(
    fields
      .filter((field) => draft[field] !== null)
      .map((field) => [field, hash(row.field_salt, field, draft[field])]),
  );
  await sql`update fitness_logging_sessions set draft_status = ${draft.status}, field_hashes = ${JSON.stringify(fingerprints)}::jsonb,
    suggested_fields = ${Object.keys(fingerprints).length}, model = ${draft.metadata?.model ?? null}, question_version = ${draft.metadata?.questionVersion ?? null}
    where user_id = ${userId} and id = ${prepared.sessionId}`;
  return { ...draft, measurement: { sessionId: prepared.sessionId, draftId: prepared.draftId } };
}
function comparison(row: SessionRow, input: StrengthLogInput) {
  const uniform = (field: "reps" | "weight" | "unit") =>
    input.sets.every((set) => set[field] === input.sets[0][field])
      ? input.sets[0][field]
      : { mixed: true };
  const values = {
    exerciseId: input.exerciseId,
    sets: input.sets.length,
    reps: uniform("reps"),
    weight: uniform("weight"),
    unit: uniform("unit"),
  };
  let unchanged = 0;
  let changed = 0;
  let filled = 0;
  for (const field of fields) {
    if (row.field_hashes[field]) {
      if (hash(row.field_salt, field, values[field]) === row.field_hashes[field]) unchanged++;
      else changed++;
    } else if (values[field] !== null && typeof values[field] !== "object") filled++;
  }
  return { unchanged, changed, filled };
}
/** Client only identifies receipts; all counts and clocks come from server data. */
export async function prepareSaveMeasurement(
  sql: Sql,
  userId: string,
  measurement: FitnessSaveMeasurement | undefined,
  input: StrengthLogInput,
  now: number,
): Promise<PreparedSave | null> {
  if (!measurement || !active(await consentRow(sql, userId))) return null;
  const row = await findSession(sql, userId, measurement.sessionId, now);
  if (!row) return null;
  const fingerprint = hash(row.field_salt, "save", { input, draftId: measurement.draftId ?? null });
  if (row.saved_at) {
    if (row.save_fingerprint !== fingerprint)
      throw new FitnessError(409, "This feedback session already belongs to a saved workout.");
    return { row, fingerprint, mode: row.mode, existingLogId: row.log_id! };
  }
  if (new Date(row.expires_at).getTime() <= now) return null;
  const linked =
    measurement.draftId && measurement.draftId === row.draft_id && row.draft_status !== null;
  const mode = linked
    ? "linked_draft"
    : measurement.draftId || row.draft_id || row.ai_request_marker !== (await aiMarker(sql, userId))
      ? "unobserved_draft_use"
      : "no_linked_draft";
  return { row, fingerprint, mode };
}
export async function finishSaveMeasurement(
  sql: Sql,
  userId: string,
  prepared: PreparedSave | null,
  logId: string,
  revision: number,
  input: StrengthLogInput,
  now: number,
) {
  if (!prepared) return;
  const { row, mode, fingerprint } = prepared;
  const counts = mode === "linked_draft" ? comparison(row, input) : null;
  await sql`update fitness_logging_sessions set log_id = ${logId}, save_fingerprint = ${fingerprint}, saved_at = ${new Date(now)},
    elapsed_ms = ${Math.max(0, Math.min(SESSION_MS, now - new Date(row.started_at).getTime()))}, mode = ${mode},
    unchanged_fields = ${counts?.unchanged ?? null}, changed_fields = ${counts?.changed ?? null}, filled_fields = ${counts?.filled ?? null},
    comparison_revision = ${mode === "linked_draft" ? revision : null} where user_id = ${userId} and id = ${row.id}`;
}
export async function refreshSavedMeasurement(
  sql: Sql,
  userId: string,
  logId: string,
  revision: number,
  input: StrengthLogInput,
  now: number,
) {
  const [row] =
    await sql<SessionRow>`select * from fitness_logging_sessions where user_id = ${userId} and log_id = ${logId} and mode = 'linked_draft' and started_at >= ${new Date(now - RETENTION_MS)}`;
  if (!row) return;
  const counts = comparison(row, input);
  await sql`update fitness_logging_sessions set unchanged_fields = ${counts.unchanged}, changed_fields = ${counts.changed},
    filled_fields = ${counts.filled}, comparison_revision = ${revision} where user_id = ${userId} and id = ${row.id}`;
}
export async function pruneFitnessOutcomes(sql: Sql, now = Date.now()) {
  await sql`delete from fitness_logging_sessions where started_at < ${new Date(now - RETENTION_MS)}`;
}
/** Only aggregate counts, with small cohorts suppressed. No private field hashes. */
export async function fitnessPilotOverview(
  sql: Sql,
  now = Date.now(),
): Promise<FitnessPilotOverview> {
  const since = new Date(now - RETENTION_MS).toISOString();
  const base = {
    since,
    retentionDays: 30 as const,
    minimumMembers: 5 as const,
    measuredTimeSavedMs: null,
  };
  const [summary] = await sql<NonNullable<FitnessPilotOverview["summary"]>>`select
    count(distinct s.user_id)::int as members, count(*)::int as "sessionsStarted", count(s.saved_at)::int as "savedLogs",
    count(*) filter (where s.saved_at is null and s.expires_at <= ${new Date(now)})::int as "expiredWithoutSave",
    count(*) filter (where s.draft_status = 'available')::int as "draftAvailable",
    count(*) filter (where s.draft_status = 'insufficient_data')::int as "draftAbstained",
    count(*) filter (where s.draft_status = 'provider_unavailable')::int as "providerUnavailable",
    count(*) filter (where s.feedback->>'helpfulness' = 'helpful')::int as helpful,
    count(*) filter (where s.feedback->>'helpfulness' = 'neutral')::int as neutral,
    count(*) filter (where s.feedback->>'helpfulness' = 'not_helpful')::int as "notHelpful",
    count(*) filter (where s.feedback->>'helpfulness' = 'unknown')::int as "feedbackUnknown",
    count(*) filter (where s.feedback->>'timeSaved' = 'yes')::int as "reportsTimeSaved",
    count(*) filter (where s.feedback->>'timeSaved' = 'no')::int as "reportsNoTimeSaved",
    count(*) filter (where s.feedback->>'timeSaved' = 'unsure')::int as "timeSavedUnsure", count(s.feedback)::int as "feedbackResponses"
    from fitness_logging_sessions s join fitness_pilot_consents c on c.user_id = s.user_id
    where c.enabled and c.notice_version = ${FITNESS_PILOT_NOTICE_VERSION} and s.consent_generation = c.generation and s.started_at >= ${since}`;
  if (summary.members < 5) return { ...base, suppressed: true, summary: null, groups: [] };
  const groups = await sql<FitnessPilotOverview["groups"][number]>`select s.mode,
    count(distinct s.user_id)::int as members, count(*)::int as "savedLogs", sum(s.suggested_fields)::int as "suggestedFields",
    sum(s.unchanged_fields)::int as "unchangedSuggestedFields", sum(s.changed_fields)::int as "changedSuggestedFields",
    sum(s.filled_fields)::int as "filledMissingFields", percentile_cont(0.5) within group (order by s.elapsed_ms) as "medianElapsedMs",
    percentile_cont(0.95) within group (order by s.elapsed_ms) as "p95ElapsedMs"
    from fitness_logging_sessions s join fitness_pilot_consents c on c.user_id = s.user_id
    where c.enabled and c.notice_version = ${FITNESS_PILOT_NOTICE_VERSION} and s.consent_generation = c.generation and s.started_at >= ${since} and s.saved_at is not null
    group by s.mode having count(distinct s.user_id) >= 5 order by s.mode`;
  return { ...base, suppressed: false, summary, groups };
}

/** Optional links for the owner's saved-log UI; expired/revoked records disappear. */
export async function loggingSessionLinks(
  sql: Sql,
  userId: string,
  logIds: string[],
  now = Date.now(),
): Promise<Map<string, string>> {
  if (!logIds.length) return new Map();
  const rows = await sql<{
    log_id: string;
    id: string;
  }>`select s.log_id, s.id from fitness_logging_sessions s
    join fitness_pilot_consents c on c.user_id = s.user_id where s.user_id = ${userId} and s.log_id = any(${logIds}::uuid[])
    and c.enabled and c.notice_version = ${FITNESS_PILOT_NOTICE_VERSION} and s.consent_generation = c.generation
    and s.started_at >= ${new Date(now - RETENTION_MS)}`;
  return new Map(rows.map((row) => [row.log_id, row.id]));
}
