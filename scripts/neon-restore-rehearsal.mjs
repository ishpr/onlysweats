/** Synthetic-only Neon PITR rehearsal. Never prints CLI output or connection URLs. */
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const runFile = promisify(execFile);
const CLI = ["--yes", "neonctl@5.0.0"];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
export function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--execute") options.execute = true;
    else if (["--project-id", "--schema-source"].includes(arg))
      options[arg.slice(2)] = argv[++index];
    else throw new Error("Use --execute --project-id PROJECT --schema-source PREVIEW_BRANCH.");
  }
  if (
    !options.execute ||
    !/^[a-z0-9-]+$/.test(options["project-id"] ?? "") ||
    !/^br-[a-z0-9-]+$/.test(options["schema-source"] ?? "")
  ) {
    throw new Error("Explicit execution, project ID and schema-source branch ID are required.");
  }
  return options;
}
/** A failed CLI create may still have made a branch. Reconcile exact random names. */
export function ownedBranches(branches, beforeIds, attemptedNames) {
  return branches.filter(
    (branch) =>
      attemptedNames.includes(branch.name) &&
      !beforeIds.has(branch.id) &&
      !branch.default &&
      !branch.protected,
  );
}
export function sanitizeDiagnostic(stderr) {
  const raw = stripVTControlCharacters(String(stderr ?? ""));
  const line =
    raw.split("\n").find((value) => /^error:/i.test(value.trim())) ?? "Neon command failed.";
  return line
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[redacted URL]")
    .replace(
      /(?:authorization|api[-_ ]?key|password|secret|token)\s*[:=]\s*[^,;\s]+/gi,
      "[redacted credential]",
    )
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_+/=-]{40,}/g, "[redacted value]")
    .slice(0, 400);
}
async function cli(projectId, args, json = true) {
  // Output can contain credentials; keep it in this process and never surface it
  // on errors. Branch creation uses --no-secrets when supported. Connection
  // strings and raw API responses are captured only in process memory.
  let result;
  try {
    result = await runFile(
      "npx",
      [
        ...CLI,
        ...args,
        ...(args[0] === "api" ? [] : ["--project-id", projectId]),
        "--output",
        "json",
        "--no-color",
      ],
      {
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
      },
    );
  } catch (error) {
    // Only the CLI's single error line, never response objects or command
    // arguments. Redact URL credentials, authorization values and token shapes.
    const safe = new Error("Neon command failed.");
    safe.safeMessage = sanitizeDiagnostic(error?.stderr);
    throw safe;
  }
  return json ? JSON.parse(result.stdout) : result.stdout.trim();
}
async function connect(projectId, branchId) {
  const response = await cli(projectId, ["connection-string", branchId], false);
  let uri = response;
  // CLI versions may serialize the single URL as a JSON string or object.
  if (!/^postgres(?:ql)?:\/\//.test(uri)) {
    const value = JSON.parse(response);
    uri =
      typeof value === "string"
        ? value
        : (value.connection_uri ?? value.connection_string ?? value.url);
  }
  if (typeof uri !== "string" || !/^postgres(?:ql)?:\/\//.test(uri))
    throw new Error("No database connection was returned.");
  const parsed = new URL(uri);
  if (!parsed.hostname.endsWith(".neon.tech"))
    throw new Error("Expected a Neon temporary branch endpoint.");
  // verify-full keeps hostname/certificate verification enabled with modern pg.
  parsed.searchParams.set("sslmode", "verify-full");
  for (let attempt = 0; attempt < 4; attempt++) {
    const client = new pg.Client({
      connectionString: parsed.toString(),
      connectionTimeoutMillis: 20_000,
      statement_timeout: 30_000,
    });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => undefined);
      if (attempt === 3) throw new Error("Temporary branch did not become connectable.");
      await pause(2000);
    }
  }
  throw new Error("No temporary branch connection.");
}
async function emptyApplicationTables(client) {
  const { rows: tables } = await client.query(
    "select table_schema, table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  if (
    !tables.some((table) => table.table_name === "user") ||
    !tables.some((table) => table.table_name.startsWith("health_"))
  )
    throw new Error("Expected application auth and health schema.");
  const result = {};
  for (const table of tables) {
    const {
      rows: [{ count }],
    } = await client.query(
      `select count(*)::text as count from ${quote(table.table_schema)}.${quote(table.table_name)}`,
    );
    result[table.table_name] = Number(count);
    if (count !== "0")
      throw new Error(
        "Schema-only branch unexpectedly contains rows; stopping before any test writes.",
      );
  }
  return result;
}
export async function rehearse(options) {
  const start = Date.now();
  const projectId = options["project-id"];
  const sourceId = options["schema-source"];
  const suffix = `${new Date(start).toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const names = [
    `samepace-restore-drill-${suffix}-empty`,
    `samepace-restore-drill-${suffix}-restored`,
  ];
  const reportPath = resolve("docs/evaluations", `neon-restore-${suffix}.json`);
  const expiresAt = new Date(start + 24 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const report = {
    startedAt: new Date(start).toISOString(),
    projectId,
    sourceBranchId: sourceId,
    cliVersion: "5.0.0",
    computeUnits: 0.25,
    expiresAt,
    scope: "Schema-only copy; synthetic canary only; no writes or restore to existing branches.",
    status: "running",
    steps: {},
    cleanup: [],
    limits: [
      "Synthetic logical recovery on temporary branches; no application traffic failover or production-size restore.",
      "Does not validate recovery beyond the project's existing history window, or set RPO/RTO commitments.",
      "Does not change history retention, plan, main/preview endpoints, or environment variables.",
    ],
    sources: [
      "https://neon.com/docs/reference/cli-branches",
      "https://neon.com/docs/guides/branching-schema-only",
      "https://neon.com/docs/reference/cli-connection-string",
      "https://api-docs.neon.tech/reference/createprojectbranch",
      "https://neon.com/docs/guides/branch-expiration",
    ],
  };
  const attemptedNames = [];
  const created = [];
  const clients = [];
  report.attemptedBranchNames = [];
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  const checkpoint = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  let beforeIds = new Set();
  let stage = "list_source_metadata";
  let failed = false;
  try {
    const before = await cli(projectId, ["branches", "list"]);
    if (!Array.isArray(before)) throw new Error("Unexpected branch list shape.");
    beforeIds = new Set(before.map((branch) => branch.id));
    if (!beforeIds.has(sourceId)) throw new Error("Schema source branch was not found.");
    const source = before.find((branch) => branch.id === sourceId);
    report.sourceBranchName = source.name;
    report.existingBranchesCount = before.length;
    async function create(name, parent, schemaOnly, recoveryPoint) {
      attemptedNames.push(name);
      report.attemptedBranchNames = [...attemptedNames];
      await checkpoint();
      const at = Date.now();
      // CLI 5.0.0 create does not parse branch@timestamp. Use its official
      // authenticated API passthrough for explicit parent_id + parent_timestamp;
      // a bare --parent timestamp would select the project default, which is forbidden.
      const result = recoveryPoint
        ? await cli(projectId, [
            "api",
            `/projects/${projectId}/branches`,
            "-X",
            "POST",
            "--data",
            JSON.stringify({
              branch: {
                name,
                parent_id: parent,
                parent_timestamp: recoveryPoint.timestamp,
                expires_at: expiresAt,
              },
              endpoints: [
                {
                  type: "read_write",
                  autoscaling_limit_min_cu: 0.25,
                  autoscaling_limit_max_cu: 0.25,
                },
              ],
            }),
          ])
        : await cli(projectId, [
            "branches",
            "create",
            "--name",
            name,
            "--parent",
            parent,
            "--no-secrets",
            "--cu",
            "0.25",
            "--expires-at",
            expiresAt,
            "--schema-only",
          ]);
      if (recoveryPoint)
        report.steps.pointInTimeReplyShape = {
          keys: Object.keys(result),
          branchKeys: Object.keys(result.branch ?? {}),
        };
      const branch = result.branch;
      if (
        !branch?.id ||
        branch.name !== name ||
        beforeIds.has(branch.id) ||
        branch.default ||
        branch.protected ||
        (recoveryPoint && branch.parent_id !== parent)
      )
        throw new Error("Unexpected temporary branch identity.");
      created.push({ id: branch.id, name });
      report.steps[schemaOnly ? "schemaBranch" : "restoreBranch"] = {
        id: branch.id,
        name,
        durationMs: Date.now() - at,
        schemaOnly,
        creationMethod: recoveryPoint
          ? "CLI authenticated API: explicit parent_id + parent_timestamp"
          : "CLI branches create --schema-only",
        parentTimestamp: branch.parent_timestamp ?? null,
        parentLsn: branch.parent_lsn ?? null,
      };
      await checkpoint();
      return branch.id;
    }
    stage = "create_schema_only_branch";
    const seedId = await create(names[0], sourceId, true);
    stage = "verify_empty_schema_only_branch";
    const seed = await connect(projectId, seedId);
    clients.push(seed);
    report.steps.emptyTableCounts = await emptyApplicationTables(seed);
    stage = "write_synthetic_canary";
    await seed.query(
      "create table public.samepace_restore_canary (id integer primary key, marker text not null)",
    );
    await seed.query(
      "insert into public.samepace_restore_canary values (1, 'before-change'), (2, 'before-delete')",
    );
    // Timestamp after the insert commit, before either destructive canary change.
    const {
      rows: [point],
    } = await seed.query(
      "select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as timestamp, pg_current_wal_lsn()::text as lsn",
    );
    report.steps.recoveryPoint = point;
    await pause(2000);
    stage = "mutate_synthetic_canary";
    await seed.query(
      "update public.samepace_restore_canary set marker = 'after-change' where id = 1",
    );
    await seed.query("delete from public.samepace_restore_canary where id = 2");
    const mutationAt = Date.now();
    const { rows: changed } = await seed.query(
      "select id, marker from public.samepace_restore_canary order by id",
    );
    if (JSON.stringify(changed) !== JSON.stringify([{ id: 1, marker: "after-change" }]))
      throw new Error("Canary mutation mismatch.");
    report.steps.currentCanary = changed;
    // Neon forbids children of expiring branches. Only our newly-created
    // synthetic seed temporarily loses its expiry; finally removes child first,
    // then seed, and tries to restore expiry if deleting the seed fails.
    stage = "clear_synthetic_parent_expiry";
    await cli(projectId, ["branches", "set-expiration", seedId]);
    report.steps.seedExpiryTemporarilyRemoved = true;
    await checkpoint();
    stage = "create_point_in_time_branch";
    report.steps.restoreCoordinate = "recorded_post_commit_timestamp";
    const restoreStarted = Date.now();
    const restoredId = await create(names[1], seedId, false, point);
    stage = "verify_restored_canary";
    const restored = await connect(projectId, restoredId);
    clients.push(restored);
    const { rows: recovered } = await restored.query(
      "select id, marker from public.samepace_restore_canary order by id",
    );
    if (
      JSON.stringify(recovered) !==
      JSON.stringify([
        { id: 1, marker: "before-change" },
        { id: 2, marker: "before-delete" },
      ])
    )
      throw new Error("Restored canary did not match its pre-change state.");
    report.steps.restoredCanary = recovered;
    report.steps.restoreRequestToVerificationMs = Date.now() - restoreStarted;
    report.steps.mutationToVerificationMs = Date.now() - mutationAt;
    const {
      rows: [{ users, health }],
    } = await restored.query(
      'select (select count(*)::int from public."user") users, (select count(*)::int from public.health_records) health',
    );
    if (users !== 0 || health !== 0)
      throw new Error("Restored synthetic branch contains unexpected member data.");
    report.steps.restoredPrivateRowCounts = { users, health };
    report.status = "passed";
  } catch (error) {
    failed = true;
    report.status = "failed";
    report.failure = {
      stage,
      safeMessage: error?.safeMessage ?? null,
      internalReason: [
        "Unexpected temporary branch identity.",
        "Neon command failed.",
        "Restored canary did not match its pre-change state.",
      ].includes(error?.message)
        ? error.message
        : null,
      reason: "Operation failed; raw database/CLI/provider details were intentionally suppressed.",
    };
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    // Reconcile a timed-out create by its exact random name, never by prefix.
    let candidates = created;
    try {
      const listed = await cli(projectId, ["branches", "list"]);
      candidates = ownedBranches(listed, beforeIds, attemptedNames).map(({ id, name }) => ({
        id,
        name,
      }));
    } catch {
      report.cleanupListingFailed = true;
    }
    candidates.sort((a, b) => names.indexOf(b.name) - names.indexOf(a.name));
    for (const branch of candidates) {
      if (
        beforeIds.has(branch.id) ||
        branch.id === sourceId ||
        !attemptedNames.includes(branch.name)
      )
        continue;
      try {
        await cli(projectId, ["branches", "delete", branch.id]);
        report.cleanup.push({ ...branch, deleted: true });
      } catch {
        let expiryReapplied = false;
        try {
          await cli(projectId, [
            "branches",
            "set-expiration",
            branch.id,
            "--expires-at",
            expiresAt,
          ]);
          expiryReapplied = true;
        } catch {
          /* A remaining child can prevent parent expiry; preserve IDs. */
        }
        report.cleanup.push({ ...branch, deleted: false, expiryReapplied });
        failed = true;
      }
    }
    try {
      const remaining = await cli(projectId, ["branches", "list"]);
      report.cleanupVerified = ownedBranches(remaining, beforeIds, attemptedNames).length === 0;
      report.sourceStillPresent = remaining.some((branch) => branch.id === sourceId);
      report.preExistingBranchIdsStillPresent = [...beforeIds].every((id) =>
        remaining.some((branch) => branch.id === id),
      );
      if (
        !report.cleanupVerified ||
        !report.sourceStillPresent ||
        !report.preExistingBranchIdsStillPresent
      )
        failed = true;
    } catch {
      report.cleanupVerified = false;
      failed = true;
    }
    report.finishedAt = new Date().toISOString();
    report.totalDurationMs = Date.now() - start;
    if (failed && report.status === "passed")
      report.status = "verification_passed_cleanup_incomplete";
    await checkpoint();
  }
  console.log(
    JSON.stringify({
      status: report.status,
      reportPath,
      totalDurationMs: report.totalDurationMs,
      cleanupVerified: report.cleanupVerified,
    }),
  );
  return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await rehearse(parseOptions(process.argv.slice(2)));
  } catch {
    console.error(
      "Restore rehearsal could not start or save its sanitized report. Check arguments and local report directory.",
    );
    process.exitCode = 1;
  }
}
