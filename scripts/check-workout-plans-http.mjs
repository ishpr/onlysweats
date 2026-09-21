#!/usr/bin/env node
/** Synthetic, self-contained HTTP acceptance. Starts only loopback + in-memory DB. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.argv[2] ?? 8102);
assert.ok(
  Number.isInteger(port) && port >= 1024 && port <= 65535,
  "Choose a local non-privileged port.",
);
const origin = `http://127.0.0.1:${port}`;
const parsed = new URL(origin);
assert.equal(parsed.hostname, "127.0.0.1");
assert.equal(parsed.protocol, "http:");
const temp = await mkdtemp(join(tmpdir(), "samepace-workout-http-"));
await chmod(temp, 0o700);
const environment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
Object.assign(environment, {
  NODE_ENV: "development",
  VITE_AUTH_ENABLED: "true",
  AUTH_EMAIL_PASSWORD: "on",
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  A2A_ENABLED: "true",
  HEALTH_SYNC_ENABLED: "true",
  BILLING_ENABLED: "false",
  BILLING_ENFORCED: "false",
  VERIFICATION_ENFORCED: "false",
  ASSISTANT_CHAT_ENABLED: "false",
  SAMEPACE_SMOKE_PORT: String(port),
  SAMEPACE_SMOKE_ENV_DIR: temp,
});
// Empty envDir prevents Vite from reading .env files. The child gets no database,
// provider keys, Expo tokens, Vercel credentials or inherited application flags.
const child = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  import { createServer } from 'vite';
  const server = await createServer({ envDir: process.env.SAMEPACE_SMOKE_ENV_DIR,
    server: { host: '127.0.0.1', port: Number(process.env.SAMEPACE_SMOKE_PORT), strictPort: true } });
  const database = await server.ssrLoadModule('/src/lib/db.ts');
  if (database.dbSource !== 'pglite' || process.env.DATABASE_URL) throw new Error('Acceptance requires an in-memory database.');
  await server.listen();
  process.stdout.write('SAMEPACE_SMOKE_READY\\n');
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
`,
  ],
  { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] },
);
let exited = false,
  ready = false;
child.once("exit", () => {
  exited = true;
});
let readinessTail = "";
child.stdout.on("data", (part) => {
  readinessTail = (readinessTail + String(part)).slice(-1000);
  if (readinessTail.includes("SAMEPACE_SMOKE_READY")) ready = true;
});
child.stderr.on("data", () => {});
const members = [];
let checks = 0;
async function request(
  member,
  path,
  { method = "GET", json, expected = 200, headers = {}, auth = false } = {},
) {
  const result = await fetch(origin + (auth ? "/api/auth" : "/api/v1") + path, {
    method,
    headers: {
      origin,
      ...(member ? { cookie: member.cookie } : {}),
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  assert.equal(result.status, expected, `${method} ${path} status`);
  if (!auth)
    assert.match(
      result.headers.get("cache-control") ?? "",
      /no-store/,
      `${path} must not be cached`,
    );
  const data = await result.json();
  checks++;
  return { data, result };
}
async function signup(label) {
  const response = await request(null, "/sign-up/email", {
    method: "POST",
    auth: true,
    json: {
      name: `Synthetic ${label}`,
      email: `workout-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("base64url"),
    },
  });
  const cookie = response.result.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie, "Signup returns a private session cookie.");
  const member = { cookie, id: response.data.user.id };
  members.push(member);
  await request(member, "/me");
  return member;
}
const quantities = {
  reps: 8,
  durationSeconds: null,
  distanceMeters: null,
  weight: null,
  unit: "bodyweight",
  restSeconds: 60,
};
const planInput = () => ({
  id: randomUUID(),
  title: "Synthetic shared plan",
  activity: "run",
  instructions: "Synthetic member-entered acceptance only.",
  exercises: [
    {
      id: randomUUID(),
      name: "Running drills",
      instructions: "Use your chosen comfortable pace.",
      sets: Array.from({ length: 2 }, () => ({ id: randomUUID(), ...quantities })),
    },
  ],
});
let failure;
try {
  const deadline = Date.now() + 45_000;
  while (true) {
    if (exited) throw new Error("Local acceptance server exited before readiness.");
    if (ready) {
      try {
        const response = await fetch(origin + "/api/v1/auth-config", {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) break;
      } catch {
        /* The new local listener may still be starting. */
      }
    }
    if (Date.now() > deadline) throw new Error("Local acceptance server readiness timed out.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await request(null, "/fitness/plans", { expected: 401 });
  await request(null, "/fitness/runs", { method: "POST", json: {}, expected: 401 });
  const host = await signup("host"),
    buddy = await signup("buddy"),
    visitor = await signup("visitor");
  const input = planInput();
  const created = (await request(host, "/fitness/plans", { method: "POST", json: input })).data
    .plan;
  assert.equal(created.revision, 1);
  assert.equal(
    (await request(host, "/fitness/plans", { method: "POST", json: input })).data.plan.id,
    created.id,
  );
  await request(host, "/fitness/plans", {
    method: "POST",
    json: { ...input, title: "Conflicting retry" },
    expected: 409,
  });
  await request(buddy, `/fitness/plans/${created.id}`, { expected: 404 });
  const { id: _id, ...content } = input;
  const updated = (
    await request(host, `/fitness/plans/${created.id}`, {
      method: "PUT",
      json: { ...content, expectedRevision: 1, title: "Reviewed shared plan" },
    })
  ).data.plan;
  await request(host, `/fitness/plans/${created.id}`, {
    method: "PUT",
    json: { ...content, expectedRevision: 1 },
    expected: 409,
  });
  const standalone = (
    await request(host, "/fitness/runs", {
      method: "POST",
      json: { id: randomUUID(), planId: created.id, expectedPlanRevision: 2 },
    })
  ).data.run;
  assert.deepEqual(standalone.results, []);
  assert.equal(standalone.shareAccountability, false);
  await request(buddy, `/fitness/runs/${standalone.id}`, { expected: 404 });
  const actual = {
    exerciseId: input.exercises[0].id,
    setId: input.exercises[0].sets[0].id,
    status: "completed",
    reps: 6,
    durationSeconds: null,
    distanceMeters: null,
    weight: null,
    unit: "bodyweight",
  };
  const saved = (
    await request(host, `/fitness/runs/${standalone.id}`, {
      method: "PUT",
      json: {
        expectedRevision: 1,
        results: [actual],
        note: "Synthetic private actual",
        shareAccountability: false,
        finish: true,
      },
    })
  ).data.run;
  assert.equal(saved.results[0].reps, 6);
  assert.equal(saved.snapshot.exercises[0].sets[0].reps, 8);
  await request(host, `/fitness/runs/${standalone.id}`, {
    method: "PUT",
    json: {
      expectedRevision: 1,
      results: [actual],
      note: "Stale",
      shareAccountability: false,
      finish: true,
    },
    expected: 409,
  });
  const exported = (await request(host, "/fitness/export?limit=100")).data.records;
  assert.ok(
    exported.some((record) => record.kind === "workout_plan" && record.value.id === created.id),
  );
  assert.ok(
    exported.some((record) => record.kind === "workout_run" && record.value.id === standalone.id),
  );
  const listing = {
    venueId: "katy",
    activity: "run",
    title: "Synthetic HTTP workout",
    detail: "",
    ability: { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 5 },
    abilityFlex: "strict",
    startAt: new Date(Date.now() + 30 * 60_000 + 1000).toISOString(),
    durationMin: 40,
    capacity: 4,
    visibility: "public",
    joinMode: "instant",
    womenOnly: false,
  };
  const session = (await request(host, "/sessions", { method: "POST", json: listing })).data
    .session;
  const attached = (
    await request(host, `/sessions/${session.id}/workout-plan`, {
      method: "PUT",
      json: { planId: created.id, expectedPlanRevision: 2 },
    })
  ).data;
  assert.equal(attached.plan.snapshot.title, updated.title);
  await request(visitor, `/sessions/${session.id}/workout-plan`, { expected: 404 });
  await request(buddy, `/sessions/${session.id}/bookings`, { method: "POST", json: {} });
  const view = (await request(buddy, `/sessions/${session.id}/workout-plan`)).data;
  assert.equal(view.plan.planId, created.id);
  assert.deepEqual(view.accountability, []);
  assert.equal(view.canAttach, false);
  const copy = (
    await request(buddy, `/sessions/${session.id}/workout-plan/copy`, {
      method: "POST",
      json: {
        id: randomUUID(),
        expectedPlanId: created.id,
        expectedPlanRevision: 2,
      },
    })
  ).data.plan;
  assert.equal(copy.title, updated.title);
  await request(host, `/sessions/${session.id}/workout-plan`, {
    method: "DELETE",
    json: { expectedPlanId: created.id, expectedPlanRevision: 2 },
    expected: 409,
  });
  await request(host, `/fitness/plans/${created.id}`, {
    method: "PUT",
    json: { ...content, title: "Private revision 3", expectedRevision: 2 },
  });
  assert.equal(
    (await request(buddy, `/sessions/${session.id}/workout-plan`)).data.plan.snapshot.title,
    updated.title,
  );
  const remaining = new Date(listing.startAt).getTime() - 30 * 60_000 - Date.now();
  if (remaining > 0)
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining + 20, 1500)));
  let buddyRun = (
    await request(buddy, "/fitness/runs", {
      method: "POST",
      json: {
        id: randomUUID(),
        sessionId: session.id,
        expectedPlanId: created.id,
        expectedPlanRevision: 2,
      },
    })
  ).data.run;
  assert.equal(buddyRun.shareAccountability, false);
  const progress = {
    results: [actual],
    note: "Do not share this private note",
    shareAccountability: true,
    finish: true,
  };
  buddyRun = (
    await request(buddy, `/fitness/runs/${buddyRun.id}`, {
      method: "PUT",
      json: { ...progress, expectedRevision: buddyRun.revision },
    })
  ).data.run;
  const shared = (await request(host, `/sessions/${session.id}/workout-plan`)).data.accountability;
  assert.equal(shared.length, 1);
  assert.equal(shared[0].completedSets, 1);
  assert.equal(shared[0].plannedSets, 2);
  assert.equal("results" in shared[0], false);
  assert.equal("note" in shared[0], false);
  assert.equal("reps" in shared[0], false);
  buddyRun = (
    await request(buddy, `/fitness/runs/${buddyRun.id}`, {
      method: "PUT",
      json: { ...progress, expectedRevision: buddyRun.revision, shareAccountability: false },
    })
  ).data.run;
  assert.deepEqual(
    (await request(host, `/sessions/${session.id}/workout-plan`)).data.accountability,
    [],
  );
  const delegation = (
    await request(host, "/agents/delegations", {
      method: "POST",
      json: { label: "Synthetic HTTP boundary", expiresInHours: 1 },
    })
  ).data.delegation;
  assert.ok(delegation.token.startsWith("sp_agent_"));
  const delegatedHeaders = { authorization: `Bearer ${delegation.token}` };
  await request(null, "/fitness/plans", { headers: delegatedHeaders, expected: 401 });
  await request(null, "/fitness/runs", { headers: delegatedHeaders, expected: 401 });
  await request(null, `/sessions/${session.id}/workout-plan`, {
    headers: delegatedHeaders,
    expected: 401,
  });
  await request(host, "/fitness/plans", {
    method: "POST",
    json: planInput(),
    headers: { "sec-fetch-site": "cross-site" },
    expected: 403,
  });
  await request(host, `/fitness/runs/${standalone.id}`, { method: "DELETE", json: {} });
  await request(host, `/fitness/plans/${created.id}`, { method: "DELETE", json: {} });
  assert.equal(
    (await request(buddy, `/sessions/${session.id}/workout-plan`)).data.plan.planId,
    created.id,
  );
  console.log(
    `Passed ${checks} authenticated loopback HTTP checks, including private exports, shared snapshots, actual results, accountability and A2A isolation.`,
  );
} catch (error) {
  failure = error;
} finally {
  const failures = [];
  for (const member of members.reverse()) {
    try {
      await request(member, "/me", { method: "DELETE", json: {} });
      await request(member, "/fitness/plans", { expected: 401 });
    } catch {
      failures.push("A synthetic account could not be explicitly removed before shutdown.");
    }
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (!exited) child.kill("SIGKILL");
  await rm(temp, { recursive: true, force: true });
  if (failures.length) failure ??= new Error(failures.join(" "));
  console.log(
    `Deleted ${members.length} synthetic accounts and stopped the in-memory loopback server.`,
  );
  // Never print server logs: generated sessions and credentials are private too.
  readinessTail = "";
}

if (failure) throw failure;
