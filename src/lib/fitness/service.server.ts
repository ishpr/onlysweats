import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { getConnection, getWorkout } from "../health/service.server.ts";
import { HealthError } from "../health/contracts.ts";
import { FITNESS_AI_NOTICE_VERSION, type ExerciseDraft, type FitnessConsent, type FitnessAssessmentMetadata, type FitnessExportPage, type FitnessExportRecord, type StrengthLog, type StrengthLogInput, type WorkoutAssessment, type WorkoutCorrection } from "../../../shared/fitness.ts";
import { assessmentInput, consentInput, correctionInput, FitnessError, fitnessId, fitnessPageInput, noteInput, strengthLogInput, updateStrengthLogInput, type FitnessPageArgs } from "./contracts.ts";
import { acceptedChoice, draftFromAnswers, emptyDraft, exerciseQuestions, EXERCISE_QUESTION_VERSION, numericCandidates, statedUnits, workoutQuestions, WORKOUT_QUESTION_VERSION } from "./questions.ts";
import { inferenceAvailable, productionProvider, type FitnessProvider, type ProviderResult } from "./typesafe.server.ts";

const iso = (value: Date | string) => new Date(value).toISOString();
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type ConsentRow = { enabled: boolean; generation: string; notice_version: string; updated_at: Date | string; last_requested_at: Date | string | null; request_day: Date | string | null; request_count: number };
type LogRow = { id: string; revision: number; data: StrengthLogInput; created_at: Date | string; updated_at: Date | string };
type CorrectionData = Pick<WorkoutCorrection, "title" | "note" | "activity">;
type CorrectionRow = { workout_id: string; revision: number; data: CorrectionData; updated_at: Date | string };
type AssessmentRow = { request: z.infer<typeof assessmentInput>; result: WorkoutAssessment };
type InferenceOptions = { provider?: FitnessProvider; now?: number };

async function lockOwner(sql: Sql, userId: string): Promise<void> {
  const [owner] = await sql`select id from "user" where id = ${userId} for update`;
  if (!owner) throw new FitnessError(401, "Unauthorized");
}
async function consentRow(sql: Sql, userId: string): Promise<ConsentRow | undefined> {
  const [row] = await sql<ConsentRow>`select * from fitness_consents where user_id = ${userId}`;
  return row;
}
function consentView(row?: ConsentRow): FitnessConsent {
  return { enabled: Boolean(row?.enabled && row.notice_version === FITNESS_AI_NOTICE_VERSION), generation: row?.generation ?? null,
    updatedAt: row ? iso(row.updated_at) : null, noticeVersion: FITNESS_AI_NOTICE_VERSION, providerAvailable: inferenceAvailable() };
}
export async function getConsent(sql: Sql, userId: string): Promise<FitnessConsent> {
  return sql.transaction(async (tx) => { await lockOwner(tx, userId); return consentView(await consentRow(tx, userId)); });
}
export async function setConsent(sql: Sql, userId: string, input: unknown, now = Date.now()): Promise<FitnessConsent> {
  const { enabled } = consentInput.parse(input);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const previous = await consentRow(tx, userId);
    if (previous?.enabled === enabled && previous.notice_version === FITNESS_AI_NOTICE_VERSION) return consentView(previous);
    const [row] = await tx<ConsentRow>`insert into fitness_consents (user_id, enabled, generation, notice_version, updated_at)
      values (${userId}, ${enabled}, ${randomUUID()}, ${FITNESS_AI_NOTICE_VERSION}, ${new Date(now)})
      on conflict (user_id) do update set enabled = excluded.enabled, generation = excluded.generation,
        notice_version = excluded.notice_version, updated_at = excluded.updated_at returning *`;
    // A new consent generation cannot retain interpretations of an older one.
    await tx`delete from fitness_workout_assessments where user_id = ${userId}`;
    return consentView(row);
  });
}
function requireConsent(row: ConsentRow | undefined): ConsentRow {
  if (!row?.enabled || row.notice_version !== FITNESS_AI_NOTICE_VERSION) throw new FitnessError(403, "Enable AI assistance separately before sending a note to TypeSafe.");
  return row;
}
async function reserveInference(sql: Sql, userId: string, now: number): Promise<ConsentRow> {
  const consent = requireConsent(await consentRow(sql, userId));
  if (consent.last_requested_at !== null && now - new Date(consent.last_requested_at).getTime() < 3000) throw new FitnessError(429, "Please wait a few seconds before requesting another suggestion.");
  const day = new Date(now).toISOString().slice(0, 10);
  const count = consent.request_day && iso(consent.request_day).slice(0, 10) === day ? consent.request_count : 0;
  if (count >= 60) throw new FitnessError(429, "Today's AI suggestion limit is reached. Manual logging is still available.");
  await sql`update fitness_consents set last_requested_at = ${new Date(now)}, request_day = ${day}::date, request_count = ${count + 1} where user_id = ${userId}`;
  return consent;
}
function logView(row: LogRow): StrengthLog {
  const totalRepetitions = row.data.sets.reduce((sum, set) => sum + set.reps, 0);
  const totalVolumeKg = row.data.sets.some((set) => set.unit === "bodyweight" || set.weight === null) ? null
    : Math.round(row.data.sets.reduce((sum, set) => sum + set.reps * (set.weight ?? 0) * (set.unit === "lb" ? 0.45359237 : 1), 0) * 1000) / 1000;
  return { ...row.data, id: row.id, revision: row.revision, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), totalRepetitions, totalVolumeKg };
}
function correctionView(row: CorrectionRow): WorkoutCorrection {
  return { ...row.data, workoutId: row.workout_id, revision: row.revision, updatedAt: iso(row.updated_at) };
}
function checkLogTime(input: StrengthLogInput, now: number) {
  const started = new Date(input.startedAt).getTime();
  if (started > now + 300_000 || started < Date.UTC(2000, 0, 1)) throw new FitnessError(400, "Choose a valid past workout time.");
}
export async function createStrengthLog(sql: Sql, userId: string, input: unknown, now = Date.now()): Promise<StrengthLog> {
  const parsed = strengthLogInput.parse(input);
  checkLogTime(parsed, now);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const [row] = await tx<LogRow>`insert into fitness_strength_logs (user_id, id, data, created_at, updated_at)
      values (${userId}, ${randomUUID()}, ${JSON.stringify(parsed)}::jsonb, ${new Date(now)}, ${new Date(now)}) returning *`;
    return logView(row);
  });
}
export async function updateStrengthLog(sql: Sql, userId: string, id: string, input: unknown, now = Date.now()): Promise<StrengthLog> {
  const logId = fitnessId.parse(id);
  const { expectedRevision, ...parsed } = updateStrengthLogInput.parse(input);
  checkLogTime(parsed, now);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const [current] = await tx<LogRow>`select * from fitness_strength_logs where user_id = ${userId} and id = ${logId}`;
    if (!current) throw new FitnessError(404, "Exercise log not found.");
    if (current.revision !== expectedRevision) throw new FitnessError(409, "This log changed. Reload it before editing.");
    const [row] = await tx<LogRow>`update fitness_strength_logs set data = ${JSON.stringify(parsed)}::jsonb,
      revision = revision + 1, updated_at = ${new Date(now)} where user_id = ${userId} and id = ${logId} returning *`;
    return logView(row);
  });
}
export async function deleteStrengthLog(sql: Sql, userId: string, id: string): Promise<void> {
  const logId = fitnessId.parse(id);
  await sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const rows = await tx`delete from fitness_strength_logs where user_id = ${userId} and id = ${logId} returning id`;
    if (!rows.length) throw new FitnessError(404, "Exercise log not found.");
  });
}
function decodeCursor(input: string | undefined, kind: string): [string, string] | null {
  if (!input) return null;
  try {
    const parsed = z.tuple([z.literal(kind), z.string().max(50), fitnessId]).parse(JSON.parse(Buffer.from(input, "base64url").toString("utf8")));
    return [parsed[1], parsed[2]];
  } catch { throw new FitnessError(400, "Invalid page cursor."); }
}
const encodeCursor = (kind: string, position: string, id: string) => Buffer.from(JSON.stringify([kind, position, id])).toString("base64url");
export async function listStrengthLogs(sql: Sql, userId: string, input: FitnessPageArgs): Promise<{ logs: StrengthLog[]; nextCursor: string | null }> {
  const page = fitnessPageInput.parse(input);
  const cursor = decodeCursor(page.cursor, "logs");
  const rows = await sql<LogRow>`select * from fitness_strength_logs where user_id = ${userId}
    and (${cursor === null} or (data->>'startedAt', id) < (${cursor?.[0] ?? ""}, ${cursor?.[1] ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    order by data->>'startedAt' desc, id desc limit ${page.limit + 1}`;
  const visible = rows.slice(0, page.limit);
  return { logs: visible.map(logView), nextCursor: rows.length > page.limit ? encodeCursor("logs", visible.at(-1)!.data.startedAt, visible.at(-1)!.id) : null };
}
async function ownedWorkout(sql: Sql, userId: string, id: string) {
  try { return await getWorkout(sql, userId, id); }
  catch (error) { if (error instanceof HealthError) throw new FitnessError(error.status, error.message); throw error; }
}
async function readCorrection(sql: Sql, userId: string, workoutId: string): Promise<WorkoutCorrection | null> {
  const [row] = await sql<CorrectionRow>`select * from fitness_workout_corrections where user_id = ${userId} and workout_id = ${workoutId}`;
  return row ? correctionView(row) : null;
}
export async function getCorrection(sql: Sql, userId: string, id: string): Promise<WorkoutCorrection | null> {
  const workoutId = fitnessId.parse(id);
  return sql.transaction(async (tx) => { await lockOwner(tx, userId); await ownedWorkout(tx, userId, workoutId); return readCorrection(tx, userId, workoutId); });
}
export async function saveCorrection(sql: Sql, userId: string, id: string, input: unknown, now = Date.now()): Promise<WorkoutCorrection> {
  const workoutId = fitnessId.parse(id);
  const { expectedRevision, ...data } = correctionInput.parse(input);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    await ownedWorkout(tx, userId, workoutId);
    const previous = await readCorrection(tx, userId, workoutId);
    if ((previous?.revision ?? 0) !== expectedRevision) throw new FitnessError(409, "This correction changed. Reload it before editing.");
    const [row] = await tx<CorrectionRow>`insert into fitness_workout_corrections (user_id, workout_id, data, updated_at)
      values (${userId}, ${workoutId}, ${JSON.stringify(data)}::jsonb, ${new Date(now)})
      on conflict (user_id, workout_id) do update set data = excluded.data, updated_at = excluded.updated_at,
        revision = fitness_workout_corrections.revision + 1 returning *`;
    await tx`delete from fitness_workout_assessments where user_id = ${userId} and workout_id = ${workoutId}`;
    return correctionView(row);
  });
}
function metadata(result: ProviderResult, snapshotRevision: string, questionVersion: string, now: number): FitnessAssessmentMetadata {
  return { ...result, snapshotRevision, questionVersion, assessedAt: new Date(now).toISOString() };
}
export async function draftExercise(sql: Sql, userId: string, input: unknown, options: InferenceOptions = {}): Promise<ExerciseDraft> {
  const { note } = noteInput.parse(input);
  const now = options.now ?? Date.now();
  const candidates = numericCandidates(note);
  const units = statedUnits(note);
  const consent = await sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const current = requireConsent(await consentRow(tx, userId));
    if (candidates.length > 32 || (!options.provider && !inferenceAvailable())) return current;
    return reserveInference(tx, userId, now);
  });
  if (candidates.length > 32) return emptyDraft("insufficient_data");
  if (!options.provider && !inferenceAvailable()) return emptyDraft("provider_unavailable");
  const snapshotRevision = fingerprint({ userId, generation: consent.generation, notice: FITNESS_AI_NOTICE_VERSION, note });
  const result = await (options.provider ?? productionProvider)({ note, candidates }, exerciseQuestions(candidates, units));
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const current = requireConsent(await consentRow(tx, userId));
    if (current.generation !== consent.generation) throw new FitnessError(409, "AI permission changed while preparing this draft. Please try again.");
    if (!result) return emptyDraft("provider_unavailable");
    return { ...draftFromAnswers(result.answers, candidates, units), metadata: metadata(result, snapshotRevision, EXERCISE_QUESTION_VERSION, options.now ?? Date.now()) };
  });
}
async function workoutSnapshot(sql: Sql, userId: string, workoutId: string, request: z.infer<typeof assessmentInput>) {
  const consent = requireConsent(await consentRow(sql, userId));
  const workout = await ownedWorkout(sql, userId, workoutId);
  const connection = await getConnection(sql, userId);
  if (!connection) throw new FitnessError(409, "Reconnect Apple Health before requesting a workout interpretation.");
  const correction = await readCorrection(sql, userId, workoutId);
  const snapshotRevision = fingerprint({ userId, generation: consent.generation, connection, workout, correction, request, questionVersion: WORKOUT_QUESTION_VERSION });
  // Only the selected workout's small nonmedical summary goes to TypeSafe. No
  // account ID, device ID, timestamps, source IDs, raw samples or daily history.
  const state = { goal: request.goal, note: request.note, workout: {
    sourceActivity: workout.record.activity, memberActivity: correction?.activity ?? null,
    durationSeconds: workout.record.durationSeconds, distanceMeters: workout.record.distanceMeters,
  } };
  return { snapshotRevision, state, endAt: workout.record.endAt };
}
export async function assessWorkout(sql: Sql, userId: string, id: string, input: unknown, options: InferenceOptions = {}): Promise<WorkoutAssessment> {
  const workoutId = fitnessId.parse(id);
  const request = assessmentInput.parse(input);
  const now = options.now ?? Date.now();
  const prepared = await sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const snapshot = await workoutSnapshot(tx, userId, workoutId, request);
    // An explicit member note is evidence of intent. Heart rate or elapsed time
    // alone is never enough, and stale imports require a new sync first.
    const connection = await getConnection(tx, userId);
    const insufficient = request.note.length < 8 || request.goal.length < 3 ||
      now - new Date(connection!.lastSyncedAt ?? 0).getTime() > 7 * 86_400_000 ||
      new Date(snapshot.endAt).getTime() > now + 300_000;
    if (!insufficient && (options.provider || inferenceAvailable())) await reserveInference(tx, userId, now);
    return { ...snapshot, insufficient };
  });
  const base = { workoutId, snapshotRevision: prepared.snapshotRevision, interpretation: null, metadata: null };
  if (prepared.insufficient) return { ...base, status: "insufficient_data" };
  if (!options.provider && !inferenceAvailable()) return { ...base, status: "provider_unavailable" };
  const result = await (options.provider ?? productionProvider)(prepared.state, workoutQuestions);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const latest = await workoutSnapshot(tx, userId, workoutId, request);
    if (latest.snapshotRevision !== prepared.snapshotRevision) throw new FitnessError(409, "This workout or its permissions changed. Request a fresh interpretation.");
    if (!result) return { ...base, status: "provider_unavailable" };
    const picked = acceptedChoice(result.answers.interpretation);
    const interpretation = picked === "goal_aligned" || picked === "intentional_change" ? picked : "unclear";
    const assessment: WorkoutAssessment = { ...base, status: interpretation === "unclear" ? "insufficient_data" : "available", interpretation,
      metadata: metadata(result, prepared.snapshotRevision, WORKOUT_QUESTION_VERSION, options.now ?? Date.now()) };
    await tx`insert into fitness_workout_assessments (user_id, workout_id, request, result)
      values (${userId}, ${workoutId}, ${JSON.stringify(request)}::jsonb, ${JSON.stringify(assessment)}::jsonb)
      on conflict (user_id, workout_id) do update set request = excluded.request, result = excluded.result`;
    return assessment;
  });
}
async function currentAssessment(sql: Sql, userId: string, workoutId: string, row: AssessmentRow): Promise<WorkoutAssessment | null> {
  try {
    const latest = await workoutSnapshot(sql, userId, workoutId, row.request);
    if (latest.snapshotRevision === row.result.snapshotRevision) return row.result;
  } catch (error) { if (!(error instanceof FitnessError)) throw error; }
  await sql`delete from fitness_workout_assessments where user_id = ${userId} and workout_id = ${workoutId}`;
  return null;
}
export async function getWorkoutAssessment(sql: Sql, userId: string, id: string): Promise<WorkoutAssessment | null> {
  const workoutId = fitnessId.parse(id);
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    await ownedWorkout(tx, userId, workoutId);
    const [row] = await tx<AssessmentRow>`select request, result from fitness_workout_assessments where user_id = ${userId} and workout_id = ${workoutId}`;
    if (!row) return null;
    const current = await currentAssessment(tx, userId, workoutId, row);
    return current ? { ...current, request: row.request } : null;
  });
}
export async function exportFitness(sql: Sql, userId: string, input: FitnessPageArgs): Promise<FitnessExportPage> {
  const page = fitnessPageInput.parse(input);
  const cursor = decodeCursor(page.cursor, "fitness-export");
  return sql.transaction(async (tx) => {
    await lockOwner(tx, userId);
    const rows = await tx<{ kind: string; id: string }>`select kind, id from (
      select 'strength_log' as kind, id from fitness_strength_logs where user_id = ${userId}
      union all select 'workout_correction' as kind, workout_id as id from fitness_workout_corrections where user_id = ${userId}
      union all select 'workout_assessment' as kind, workout_id as id from fitness_workout_assessments where user_id = ${userId}
    ) entries where (${cursor === null} or (kind, id) > (${cursor?.[0] ?? ""}, ${cursor?.[1] ?? "00000000-0000-0000-0000-000000000000"}::uuid))
      order by kind, id limit ${page.limit + 1}`;
    const records: FitnessExportRecord[] = [];
    const visible = rows.slice(0, page.limit);
    for (const row of visible) {
      if (row.kind === "strength_log") {
        const [log] = await tx<LogRow>`select * from fitness_strength_logs where user_id = ${userId} and id = ${row.id}`;
        records.push({ kind: "strength_log", value: logView(log) });
      } else if (row.kind === "workout_correction") {
        records.push({ kind: "workout_correction", value: (await readCorrection(tx, userId, row.id))! });
      } else {
        const [assessment] = await tx<AssessmentRow>`select request, result from fitness_workout_assessments where user_id = ${userId} and workout_id = ${row.id}`;
        const value = await currentAssessment(tx, userId, row.id, assessment);
        if (value) records.push({ kind: "workout_assessment", value: { ...value, request: assessment.request } });
      }
    }
    const last = visible.at(-1);
    return { consent: consentView(await consentRow(tx, userId)), records,
      nextCursor: rows.length > page.limit && last ? encodeCursor("fitness-export", last.kind, last.id) : null };
  });
}
