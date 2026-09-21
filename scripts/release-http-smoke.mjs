#!/usr/bin/env node
/**
 * Local release acceptance through the actual HTTP router.
 *
 * Usage: node scripts/release-http-smoke.mjs [http://127.0.0.1:8091]
 * Optional URL-only configuration: RELEASE_SMOKE_BASE_URL and
 * RELEASE_SMOKE_AUTH_ORIGIN. The default auth origin is the repository
 * development origin http://localhost:8080; all requests still target the
 * selected loopback base, including when the API uses another local port.
 * The already-running local server needs AUTH_EMAIL_PASSWORD=on,
 * HEALTH_SYNC_ENABLED=true, and A2A_ENABLED=true. This script never reads server
 * credentials or enables inference. Its only draft request is made while the
 * newly created member's separate AI consent is off, and must return 403.
 *
 * Every account, exercise and delegation created here is synthetic. The account
 * is deleted in finally, including after a failed check. Tokens, credentials,
 * response bodies and upstream error text are never written to output.
 */
import { randomBytes, randomUUID } from "node:crypto";

class SmokeFailure extends Error {}
const check = (condition, message) => { if (!condition) throw new SmokeFailure(message); };

function localBase(input) {
  let url;
  try { url = new URL(input); } catch { throw new SmokeFailure("Provide a valid loopback base URL."); }
  check(["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "The smoke test only accepts loopback servers.");
  check(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "The loopback URL must contain only its scheme, host and port.");
  return url.origin;
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      check(size <= 256_000, "A local response exceeded the smoke-test size limit.");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (size === 0) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new SmokeFailure("The local API did not return JSON."); }
}

async function run(base, authOrigin) {
  const marker = randomUUID();
  const email = `release-http-smoke-${marker}@example.test`;
  const password = `Aa1!${randomBytes(24).toString("base64url")}`;
  let token = null;
  let created = false;
  let deleted = false;
  let stage = "unauthenticated access";
  let failure = null;
  const passed = [];
  const request = async (path, { method = "GET", json, credential = token, expected = 200 } = {}) => {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { accept: "application/json", origin: authOrigin, ...(path === "/api/a2a" ? { "a2a-version": "1.0" } : {}), ...(json === undefined ? {} : { "content-type": "application/json" }),
          ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
    } catch { throw new SmokeFailure("The local HTTP request failed or timed out."); }
    const body = await readJson(response);
    check(response.status === expected, `Expected HTTP ${expected}; received HTTP ${response.status}.`);
    return { response, body };
  };
  const api = (path, options) => request(`/api/v1${path}`, options);
  try {
    await api("/fitness/logs", { credential: null, expected: 401 });
    await api("/health/connection", { credential: null, expected: 401 });
    await api("/agents/delegations", { credential: null, expected: 401 });
    await api("/agents/discovery", { credential: null, expected: 401 });
    await api("/billing", { credential: null, expected: 401 });
    await api("/fitness/pilot-consent", { credential: null, expected: 401 });
    passed.push("Unauthenticated fitness, health and agent requests return 401");

    stage = "synthetic local signup";
    const config = await api("/auth-config", { credential: null });
    check(config.body?.password === true, "Enable local password authentication before running the smoke test.");
    const signup = await request("/api/auth/sign-up/email", { method: "POST", credential: null,
      json: { name: "Synthetic release HTTP check", email, password } });
    created = true;
    token = signup.response.headers.get("set-auth-token") || (typeof signup.body?.token === "string" ? signup.body.token : null);
    if (!token) {
      const signin = await request("/api/auth/sign-in/email", { method: "POST", credential: null, json: { email, password } });
      token = signin.response.headers.get("set-auth-token") || (typeof signin.body?.token === "string" ? signin.body.token : null);
    }
    check(Boolean(token), "The synthetic signup did not produce a usable member session.");
    await api("/me");
    passed.push("Synthetic account signs in through the HTTP authentication endpoint");

    stage = "separate AI consent";
    const consent = await api("/fitness/consent");
    check(consent.body?.consent?.enabled === false, "A new member unexpectedly has AI consent enabled.");
    await api("/fitness/draft", { method: "POST", json: { note: "Synthetic bench press: 3 sets of 8 at 60 kg." }, expected: 403 });
    // Deliberately do not enable consent or send another inference request,
    // including when this local server already has a provider key configured.
    passed.push("AI drafts require separate member consent before provider access");

    stage = "separate feedback consent and disabled discovery";
    check((await api("/fitness/pilot-consent")).body?.consent?.enabled === false, "Feedback consent must start disabled.");
    await api("/fitness/pilot-consent", { method: "PUT", json: { enabled: true }, expected: 403 });
    check((await api("/fitness/logging-sessions", { method: "POST", json: {} })).body?.measurement === null, "No measurement may start without feedback consent.");
    await api("/fitness/pilot-consent", { method: "PUT", json: { enabled: false } });
    const discovery = (await api("/agents/discovery")).body?.discovery;
    check(discovery?.enabled === false && discovery?.candidates?.length === 0, "Discovery must start disabled and reveal no candidates.");
    await api("/agents/discovery", { method: "PUT", json: { enabled: false } });
    await api(`/agents/negotiations/${randomUUID()}/coordination`, { expected: 404 });
    const billing = (await api("/billing")).body;
    check(billing?.monthlyCents === 1200 && billing?.freeSessionsLeft === 2 && billing?.fees?.length === 0, "Billing must reflect the new member's server-owned records.");
    passed.push("Pilot measurement, discovery and planning controls enforce explicit consent and ownership; billing starts with two free workouts");

    stage = "manual log creation";
    const input = { startedAt: new Date(Date.now() - 3_600_000).toISOString(), exerciseId: "bench_press",
      note: "Synthetic HTTP fixture; not measured activity.", sets: [{ reps: 8, weight: 135, unit: "lb" }, { reps: 8, weight: 60, unit: "kg" }] };
    const first = (await api("/fitness/logs", { method: "POST", json: input })).body?.log;
    check(typeof first?.id === "string" && first.revision === 1, "The created log is missing its identity or first revision.");
    check(first.totalRepetitions === 16 && first.totalVolumeKg === 969.88, "The manual log totals do not match the explicit source values.");
    const second = (await api("/fitness/logs", { method: "POST", json: { ...input, exerciseId: "push_up", sets: [{ reps: 10, weight: null, unit: "bodyweight" }] } })).body?.log;
    check(typeof second?.id === "string" && second.totalRepetitions === 10 && second.totalVolumeKg === null, "Bodyweight logging must preserve unknown load totals.");
    passed.push("Manual logs preserve explicit values and calculate exact totals");

    stage = "HTTP PUT and revision protection";
    await api(`/fitness/logs/${encodeURIComponent(first.id)}`, { method: "PUT", json: { ...input, expectedRevision: 999 }, expected: 409 });
    const updated = (await api(`/fitness/logs/${encodeURIComponent(first.id)}`, { method: "PUT", json: {
      ...input, expectedRevision: 1, note: "Synthetic member correction.", sets: [{ reps: 5, weight: 20, unit: "kg" }],
    } })).body?.log;
    check(updated?.id === first.id && updated.revision === 2 && updated.totalRepetitions === 5 && updated.totalVolumeKg === 100,
      "The HTTP PUT update did not save the expected revision and totals.");
    await api(`/fitness/logs/${encodeURIComponent(first.id)}`, { method: "PUT", json: { ...input, expectedRevision: 1 }, expected: 409 });
    passed.push("Actual HTTP PUT saves changes and rejects stale revisions");

    stage = "full paginated export";
    const exportedIds = [];
    const visited = new Set();
    let cursor = null;
    let pages = 0;
    do {
      const page = (await api(`/fitness/export?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).body;
      check(Array.isArray(page?.records) && page.records.length <= 1, "The fitness export page shape is invalid.");
      check(page.consent?.enabled === false, "Export changed the member's AI consent.");
      for (const record of page.records) {
        check(record.kind === "strength_log" && typeof record.value?.id === "string", "The synthetic export contains an unexpected record.");
        exportedIds.push(record.value.id);
      }
      cursor = page.nextCursor;
      check(cursor === null || typeof cursor === "string", "The export cursor shape is invalid.");
      pages++;
      check(pages <= 10 && (cursor === null || !visited.has(cursor)), "The export pagination did not terminate safely.");
      if (cursor !== null) visited.add(cursor);
    } while (cursor !== null);
    check(pages === 2 && exportedIds.length === 2 && new Set(exportedIds).size === 2 && exportedIds.includes(first.id) && exportedIds.includes(second.id),
      "Paginated export did not contain exactly this account's two synthetic logs.");
    passed.push("Every export page contains only the synthetic member's complete logs");

    stage = "scoped A2A access isolation";
    const delegation = (await api("/agents/delegations", { method: "POST", json: { label: "Synthetic HTTP scope check", expiresInHours: 1 } })).body?.delegation;
    check(typeof delegation?.id === "string" && typeof delegation.token === "string" && delegation.scope === "workout:negotiate", "The local delegation response is invalid.");
    const agentTasks = await request("/api/a2a", { method: "POST", credential: delegation.token,
      json: { jsonrpc: "2.0", id: "synthetic-check", method: "ListTasks", params: {} } });
    check(agentTasks.body?.result !== undefined && agentTasks.body?.error === undefined, "The issued scoped credential could not access its intended A2A route.");
    await api("/fitness/logs", { credential: delegation.token, expected: 401 });
    await api("/fitness/export", { credential: delegation.token, expected: 401 });
    await api("/health/connection", { credential: delegation.token, expected: 401 });
    await api("/billing", { credential: delegation.token, expected: 401 });
    await api("/agents/discovery", { credential: delegation.token, expected: 401 });
    await api("/fitness/pilot-consent", { credential: delegation.token, expected: 401 });
    passed.push("Scoped A2A credentials cannot read fitness or health information");

    stage = "delegation revocation";
    await api(`/agents/delegations/${encodeURIComponent(delegation.id)}`, { method: "DELETE", json: {} });
    const delegations = (await api("/agents/delegations")).body?.delegations;
    check(Array.isArray(delegations) && delegations.some((entry) => entry.id === delegation.id && entry.revokedAt !== null), "The scoped delegation was not revoked.");
    await request("/api/a2a", { method: "POST", credential: delegation.token,
      json: { jsonrpc: "2.0", id: "synthetic-check", method: "ListTasks", params: {} }, expected: 401 });
    passed.push("Revoked delegation is rejected at the A2A endpoint");

    stage = "non-admin access";
    await api("/admin/overview", { expected: 404 });
    await api("/admin/operations", { expected: 404 });
    await api("/admin/billing/disputes", { expected: 404 });
    passed.push("Admin information remains hidden from ordinary members");
  } catch (error) {
    failure = { stage, message: error instanceof SmokeFailure ? error.message : "Unexpected local smoke-test failure." };
  } finally {
    if (token) {
      try {
        await api("/me", { method: "DELETE", json: {} });
        deleted = true;
        await api("/fitness/logs", { expected: 401 });
        passed.push("DELETE /me removes the synthetic account and invalidates its private access");
      } catch { failure ??= { stage: "synthetic account cleanup", message: "Synthetic account cleanup could not be verified." }; }
    } else if (created) {
      failure ??= { stage: "synthetic account cleanup", message: "The created account did not provide a session for cleanup." };
    }
  }
  const result = { ok: failure === null, checks: passed, accountCleanup: created ? deleted ? "deleted" : "not_verified" : "not_created",
    ...(failure ? { failure } : {}), ...(created && !deleted ? { syntheticAccountCleanupReference: email } : {}) };
  console.log(JSON.stringify(result, null, 2));
  if (failure) process.exitCode = 1;
}

try {
  if (process.argv[2] === "--help") {
    console.log("Usage: node scripts/release-http-smoke.mjs [http://127.0.0.1:8091]\nOnly loopback servers are accepted. The server needs local password auth, health sync and A2A enabled.");
  } else {
    check(process.argv.length <= 3, "Provide at most one loopback base URL.");
    const base = localBase(process.argv[2] ?? process.env.RELEASE_SMOKE_BASE_URL ?? "http://127.0.0.1:8091");
    const authOrigin = localBase(process.env.RELEASE_SMOKE_AUTH_ORIGIN ?? "http://localhost:8080");
    await run(base, authOrigin);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, failure: error instanceof SmokeFailure ? error.message : "Could not start the local smoke test." }));
  process.exitCode = 1;
}
