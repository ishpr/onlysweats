/**
 * Dev-only cluster: when running on the embedded PGLite database (no
 * `DATABASE_URL`) and nothing is posted yet, load the prototype's demo members
 * and their upcoming sessions so a fresh client isn't staring at an empty list.
 * Never runs against a real database.
 */
import { dbSource, type Sql } from "../db";
import { buildSeedSessions, people } from "../seed";
import { ME_ID } from "../types";
import type { Ability, Activity } from "./types";

const globalRef = globalThis as typeof globalThis & { __paceDemoSeed__?: Promise<void> };

/** The prototype's sessions predate ability levels — give each a plausible one. */
function abilityFor(activity: Activity, i: number): Ability {
  const paces = [
    [540, 570],
    [570, 600],
    [600, 660],
    [510, 540],
  ];
  const [paceMinSec, paceMaxSec] = paces[i % paces.length];
  switch (activity) {
    case "run":
      return { kind: "run", paceMinSec, paceMaxSec, miles: [3, 5, 4, 6][i % 4] };
    case "ride":
      return { kind: "ride", mphMin: 15, mphMax: 17, miles: 25, surface: "road" };
    case "strength":
      return { kind: "gym", experience: "regular", focus: "full body" };
    case "hike":
      return { kind: "hike", miles: 6, gainFt: 600, difficulty: "moderate" };
    case "walk":
      return { kind: "walk", effort: "brisk", miles: 3 };
    case "mobility":
      return { kind: "open" };
  }
}

async function seed(sql: Sql) {
  const [{ n }] = await sql<{ n: number }>`select count(*) as n from sessions`;
  if (Number(n) > 0) return;
  for (const p of people.filter((x) => x.id !== ME_ID)) {
    const total = p.completedCount;
    await sql`
      insert into profiles (id, name, handle, initials, neighborhood, accent,
        identity_verified, is_demo, completed_count,
        on_time_yes, on_time_total, would_join_yes, would_join_total)
      values (${`demo-${p.id}`}, ${p.name}, ${p.handle}, ${p.initials}, ${p.neighborhood},
        ${p.accent}, ${p.identityVerified}, true, ${total},
        ${Math.round((p.onTimePct * total) / 100)}, ${total},
        ${Math.round((p.wouldJoinPct * total) / 100)}, ${total})
      on conflict (id) do nothing`;
  }
  const posted = buildSeedSessions(new Date()).filter(
    (s) => s.hostId !== ME_ID && s.visibility === "public",
  );
  for (const [i, s] of posted.entries()) {
    const hostId = `demo-${s.hostId}`;
    // Women-only sessions are posted by women — mark the demo poster accordingly.
    if (s.womenOnly) await sql`update profiles set gender = 'woman' where id = ${hostId}`;
    await sql`
      insert into sessions (id, host_id, venue_id, activity, title, detail, ability, ability_flex,
        start_at, duration_min, capacity, visibility, join_mode, women_only, code)
      values (${`demo-${s.id}`}, ${hostId}, ${s.venueId}, ${s.activity}, ${s.title}, ${s.detail},
        ${JSON.stringify(abilityFor(s.activity, i))}::jsonb, ${i % 3 === 0 ? "flexible" : "strict"},
        ${s.startAt}, ${s.durationMin}, ${s.capacity}, 'public', ${s.joinMode}, ${s.womenOnly},
        ${s.code})
      on conflict (id) do nothing`;
  }
}

export function ensureDemoCluster(sql: Sql): Promise<void> {
  if (dbSource !== "pglite") return Promise.resolve();
  globalRef.__paceDemoSeed__ ??= seed(sql).catch((err) => {
    globalRef.__paceDemoSeed__ = undefined;
    console.error("[pace] demo seed failed:", err);
  });
  return globalRef.__paceDemoSeed__;
}
