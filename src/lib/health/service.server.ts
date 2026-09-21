import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import type {
  HealthConnection,
  HealthCursor,
  HealthDataType,
  HealthRecord,
  HealthSyncInput,
  PrivateWorkout,
  WorkoutRecord,
} from "../../../shared/health.ts";
import { connectionInput, HEALTH_TYPES, HealthError, sourceId, syncInput } from "./contracts.ts";
import { summarizeWorkout } from "./summary.ts";
import { forgetFitnessConversation } from "../conversation/privacy.server.ts";

type ConnectionRow = {
  device_id: string;
  generation: string;
  types: HealthDataType[];
  automatic_sync?: boolean;
  since_at: Date | string;
  connected_at: Date | string;
  last_synced_at: Date | string | null;
};
const iso = (value: Date | string) => new Date(value).toISOString();
const canonicalTypes = (types: HealthDataType[]) =>
  HEALTH_TYPES.filter((type) => types.includes(type));

async function connectionView(
  sql: Sql,
  userId: string,
  row: ConnectionRow,
): Promise<HealthConnection> {
  const cursors = await sql<{ type: HealthDataType; sequence: number; anchor: string | null }>`
    select type, sequence, anchor from health_cursors where user_id = ${userId}`;
  return {
    automaticSync: row.automatic_sync === true,
    deviceId: row.device_id,
    generation: row.generation,
    types: row.types,
    sinceAt: iso(row.since_at),
    connectedAt: iso(row.connected_at),
    lastSyncedAt: row.last_synced_at === null ? null : iso(row.last_synced_at),
    cursors: Object.fromEntries(
      cursors.map(({ type, sequence, anchor }) => [type, { sequence, anchor }]),
    ),
  };
}

/** Lock the identity before the connection, including its first creation or
 * deletion. Every mutation uses this order, so a disconnected generation can
 * never recreate its connection or race a successful account deletion. */
async function lockConnection(sql: Sql, userId: string): Promise<ConnectionRow | undefined> {
  const [user] = await sql`select id from "user" where id = ${userId} for update`;
  if (!user) throw new HealthError(401, "Unauthorized");
  const [connection] =
    await sql<ConnectionRow>`select * from health_connections where user_id = ${userId} for update`;
  return connection;
}

export function getConnection(sql: Sql, userId: string): Promise<HealthConnection | null> {
  // Read connection and cursors under the same lock to avoid a mixed-generation
  // response if permissions change between the two reads.
  return sql.transaction(async (tx) => {
    const row = await lockConnection(tx, userId);
    return row ? connectionView(tx, userId, row) : null;
  });
}

export async function connect(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<HealthConnection> {
  const parsed = connectionInput.parse(input);
  const types = canonicalTypes(parsed.types);
  return sql.transaction(async (tx) => {
    const current = await lockConnection(tx, userId);
    if (
      current &&
      current.device_id === parsed.deviceId &&
      JSON.stringify(current.types) === JSON.stringify(types) &&
      (current.automatic_sync === true) === parsed.automaticSync
    ) {
      return connectionView(tx, userId, current);
    }
    const generation = randomUUID();
    const sinceAt = current ? iso(current.since_at) : new Date(now - 30 * 86_400_000).toISOString();
    const [row] = await tx<ConnectionRow>`
      insert into health_connections (user_id, device_id, generation, types, since_at, connected_at, automatic_sync)
      values (${userId}, ${parsed.deviceId}, ${generation}, ${types}, ${sinceAt}, ${new Date(now).toISOString()}, ${parsed.automaticSync})
      on conflict (user_id) do update set device_id = excluded.device_id, generation = excluded.generation,
        types = excluded.types, automatic_sync = excluded.automatic_sync, last_synced_at = null
      returning *`;
    await tx`delete from health_cursors where user_id = ${userId}`;
    // Withdrawing a type removes its records, not merely its permission flag.
    if (current?.types.some((type) => !types.includes(type))) {
      await forgetFitnessConversation(tx, userId);
    }
    await tx`delete from health_records where user_id = ${userId} and not (type = any(${types}::text[]))`;
    // Zone summaries are readings too: removing their consent scrubs embedded data.
    await tx`update health_records set record = jsonb_set(record, '{zones}',
      coalesce((select jsonb_agg(zone) from jsonb_array_elements(record->'zones') zone
        where zone->>'metric' = any(${types}::text[])), '[]'::jsonb)), revision = revision + 1
      where user_id = ${userId} and type = 'workout' and record ? 'zones'
        and exists (select 1 from jsonb_array_elements(record->'zones') zone
          where not (zone->>'metric' = any(${types}::text[])))`;
    for (const type of types) {
      await tx`insert into health_cursors (user_id, type) values (${userId}, ${type})`;
    }
    return connectionView(tx, userId, row);
  });
}

export async function disconnect(sql: Sql, userId: string): Promise<void> {
  await sql.transaction(async (tx) => {
    await lockConnection(tx, userId);
    await forgetFitnessConversation(tx, userId);
    await tx`delete from health_records where user_id = ${userId}`;
    await tx`delete from health_connections where user_id = ${userId}`;
  });
}

export async function sync(
  sql: Sql,
  userId: string,
  input: unknown,
  now = Date.now(),
): Promise<HealthConnection> {
  // Parse the whole batch before writing any row or accepting its opaque anchor.
  const page: HealthSyncInput = syncInput.parse(input);
  return sql.transaction(async (tx) => {
    const current = await lockConnection(tx, userId);
    if (!current || current.generation !== page.generation || current.device_id !== page.deviceId) {
      throw new HealthError(409, "Health connection changed. Refresh before syncing.");
    }
    if (!current.types.includes(page.type))
      throw new HealthError(403, "This health type has not been selected.");
    if (
      page.records.some(
        (record) =>
          record.type === "workout" &&
          record.zones?.some((group) => !current.types.includes(group.metric)),
      )
    ) {
      throw new HealthError(
        403,
        "Workout zones require consent to their corresponding reading type.",
      );
    }
    const [cursor] = await tx<HealthCursor>`
      select sequence, anchor from health_cursors where user_id = ${userId} and type = ${page.type}`;
    if (!cursor || cursor.sequence !== page.expectedSequence)
      throw new HealthError(409, "Health cursor changed. Refresh before syncing.");
    if (
      page.records.some((record) => Date.parse(record.endAt) < Date.parse(iso(current.since_at)))
    ) {
      throw new HealthError(400, "A record ends before this connection's import window.");
    }
    if (page.records.some((record) => Date.parse(record.endAt) > now + 5 * 60_000)) {
      throw new HealthError(400, "A record cannot end in the future.");
    }
    if (page.records.length) {
      const changed = await tx`
        insert into health_records (user_id, type, external_id, record, imported_at)
        select ${userId}, ${page.type}, (incoming.record->>'externalId')::uuid, incoming.record, ${new Date(now).toISOString()}::timestamptz
        from jsonb_array_elements(${JSON.stringify(page.records)}::jsonb) as incoming(record)
        on conflict (user_id, type, external_id) do update set record = excluded.record,
          revision = health_records.revision + case when health_records.record is distinct from excluded.record then 1 else 0 end
        where health_records.record is not null and health_records.record is distinct from excluded.record
        returning external_id`;
      // Late readings and source corrections change the same summary used by the
      // coach. Fence in-flight replies and saved history just as source removal does.
      // Reimporting identical records (or a tombstoned UUID) is not a change.
      if (changed.length && (page.type === "workout" || page.type === "heart_rate")) {
        await forgetFitnessConversation(tx, userId);
      }
    }
    // Deletion wins if the source puts a sample in both arrays in a page.
    if (page.deletedIds.length) {
      if (page.type === "workout" || page.type === "heart_rate") {
        await forgetFitnessConversation(tx, userId);
      }
      await tx`
        insert into health_records (user_id, type, external_id, record, imported_at)
        select ${userId}, ${page.type}, incoming.id, null, null
        from unnest(${[...new Set(page.deletedIds)]}::uuid[]) as incoming(id)
        on conflict (user_id, type, external_id) do update set record = null, imported_at = null,
          revision = health_records.revision + case when health_records.record is not null then 1 else 0 end`;
    }
    await tx`update health_cursors set sequence = sequence + 1, anchor = ${page.anchor}
      where user_id = ${userId} and type = ${page.type}`;
    const [updated] =
      await tx<ConnectionRow>`update health_connections set last_synced_at = ${new Date(now).toISOString()}
      where user_id = ${userId} returning *`;
    return connectionView(tx, userId, updated);
  });
}

type RecordRow = {
  external_id: string;
  record: WorkoutRecord;
  imported_at: Date | string;
  revision: number;
};

async function workoutView(sql: Sql, userId: string, row: RecordRow): Promise<PrivateWorkout> {
  const workout = summarizeWorkout(row.record, iso(row.imported_at), [], row.revision);
  // Aggregate in the database: even a long workout never returns an unbounded
  // sensor stream to the API process. Only samples fully inside the workout
  // from its recording source contribute, avoiding mixed recording sources.
  const [heart] = await sql<{
    sample_count: number;
    min_bpm: number | null;
    max_bpm: number | null;
    sample_mean_bpm: number | null;
    first_sample_at: string | null;
    last_sample_at: string | null;
  }>`
    select count(*)::integer as sample_count,
      min((record->>'value')::double precision) as min_bpm,
      max((record->>'value')::double precision) as max_bpm,
      avg((record->>'value')::double precision) as sample_mean_bpm,
      min(record->>'startAt') as first_sample_at, max(record->>'startAt') as last_sample_at
    from health_records where user_id = ${userId} and type = 'heart_rate' and record is not null
      and record->'source'->>'bundleId' = ${row.record.source.bundleId}
      and record->>'startAt' >= ${row.record.startAt} and record->>'endAt' <= ${row.record.endAt}`;
  workout.heartRate = {
    availability: heart.sample_count ? "available" : "unavailable",
    sampleCount: heart.sample_count,
    minBpm: heart.min_bpm,
    maxBpm: heart.max_bpm,
    sampleMeanBpm: heart.sample_mean_bpm,
    firstSampleAt: heart.first_sample_at,
    lastSampleAt: heart.last_sample_at,
  };
  return workout;
}

type PageArgs = { limit: number; cursor?: string };
function decodeCursor(cursor: string | undefined, kind: string): string[] | null {
  if (!cursor) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(data) ||
      data.length !== 3 ||
      data[0] !== kind ||
      data.some((v) => typeof v !== "string")
    )
      throw new Error();
    sourceId.parse(data[2]);
    if (kind === "workouts" && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(data[1]))
      throw new Error();
    if (kind === "export" && !HEALTH_TYPES.includes(data[1])) throw new Error();
    return data;
  } catch {
    throw new HealthError(400, "Invalid health page cursor.");
  }
}
const encodeCursor = (kind: string, position: string, id: string) =>
  Buffer.from(JSON.stringify([kind, position, id])).toString("base64url");

export async function listWorkouts(
  sql: Sql,
  userId: string,
  page: PageArgs,
): Promise<{ workouts: PrivateWorkout[]; nextCursor: string | null }> {
  const cursor = decodeCursor(page.cursor, "workouts");
  const rows =
    await sql<RecordRow>`select external_id, record, imported_at, revision from health_records
    where user_id = ${userId} and type = 'workout' and record is not null
      and (${cursor === null} or (record->>'startAt', external_id) < (${cursor?.[1] ?? ""}, ${cursor?.[2] ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    order by record->>'startAt' desc, external_id desc limit ${page.limit + 1}`;
  const visible = rows.slice(0, page.limit);
  const last = visible.at(-1);
  return {
    workouts: await Promise.all(visible.map((row) => workoutView(sql, userId, row))),
    nextCursor:
      rows.length > page.limit && last
        ? encodeCursor("workouts", last.record.startAt, last.external_id)
        : null,
  };
}

export async function getWorkout(sql: Sql, userId: string, id: string): Promise<PrivateWorkout> {
  const externalId = sourceId.parse(id);
  const [row] =
    await sql<RecordRow>`select external_id, record, imported_at, revision from health_records
    where user_id = ${userId} and type = 'workout' and external_id = ${externalId} and record is not null`;
  if (!row) throw new HealthError(404, "Workout not found.");
  return workoutView(sql, userId, row);
}

export async function deleteWorkout(sql: Sql, userId: string, id: string): Promise<void> {
  const externalId = sourceId.parse(id);
  await sql.transaction(async (tx) => {
    await lockConnection(tx, userId);
    // Do not let a guessed UUID create another member's tombstone. Repeating a
    // deletion of one's own tombstone is idempotent.
    const rows =
      await tx`update health_records set revision = revision + case when record is not null then 1 else 0 end,
      record = null, imported_at = null
      where user_id = ${userId} and type = 'workout' and external_id = ${externalId} returning external_id`;
    if (!rows.length) throw new HealthError(404, "Workout not found.");
    await forgetFitnessConversation(tx, userId);
  });
}

export async function exportRecords(
  sql: Sql,
  userId: string,
  page: PageArgs,
): Promise<{ records: HealthRecord[]; nextCursor: string | null }> {
  const cursor = decodeCursor(page.cursor, "export");
  const rows = await sql<{ type: HealthDataType; external_id: string; record: HealthRecord }>`
    select type, external_id, record from health_records where user_id = ${userId} and record is not null
      and (${cursor === null} or (type, external_id) > (${cursor?.[1] ?? ""}, ${cursor?.[2] ?? "00000000-0000-0000-0000-000000000000"}::uuid))
    order by type, external_id limit ${page.limit + 1}`;
  const visible = rows.slice(0, page.limit);
  const last = visible.at(-1);
  return {
    records: visible.map((row) => row.record),
    nextCursor:
      rows.length > page.limit && last ? encodeCursor("export", last.type, last.external_id) : null,
  };
}
