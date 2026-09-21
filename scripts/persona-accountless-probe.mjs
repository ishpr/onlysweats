/** Sandbox-only, synthetic Persona accountless probe. Never logs provider bodies or credentials. */
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.withpersona.com/api/v1";
const VERSION = "2023-01-05";
const STATE_KIND = "samepace-persona-accountless-probe-v2";
const INQUIRY_ID = /^inq_[a-zA-Z0-9_-]{1,200}$/;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,255}$/;
const REQUIRED_CHECKS = [
  ...["create", "retrieve", "resume"].flatMap((stage) => [
    `${stage}ReferenceCompatible`,
    `${stage}TemplateMatches`,
    `${stage}AccountAbsent`,
    `${stage}UpdateTimeValid`,
  ]),
  "createSessionTokenPresent",
  "resumeSessionTokenPresent",
];
const CHECK_NAMES = [
  ...REQUIRED_CHECKS,
  ...["create", "retrieve", "resume"].map((stage) => `${stage}ReferenceAbsent`),
];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

class ProbeFailure extends Error {
  constructor(stage, status, httpStatus) {
    super("Persona probe did not pass.");
    this.stage = stage;
    this.status = status;
    this.httpStatus = httpStatus;
  }
}

export function parseOptions(argv, env = process.env) {
  const options = { templateId: env.PERSONA_TEMPLATE_MEMBER };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--cleanup-only") options.cleanupOnly = true;
    else if (["--state-file", "--key-file", "--template-id"].includes(arg)) {
      const key = {
        "--state-file": "stateFile",
        "--key-file": "keyFile",
        "--template-id": "templateId",
      }[arg];
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw new ProbeFailure("preflight", "invalid_arguments");
      options[key] = argv[++i];
    } else throw new ProbeFailure("preflight", "invalid_arguments");
  }
  if (
    !options.execute ||
    !/^itmpl_[a-zA-Z0-9_-]{1,200}$/.test(options.templateId ?? "") ||
    !options.stateFile ||
    !isAbsolute(options.stateFile) ||
    (options.keyFile && !isAbsolute(options.keyFile))
  ) {
    throw new ProbeFailure("preflight", "invalid_arguments");
  }
  options.stateFile = resolve(options.stateFile);
  if (options.keyFile && resolve(options.keyFile) === options.stateFile) {
    throw new ProbeFailure("preflight", "invalid_arguments");
  }
  return options;
}

/** Refuse symlinks, other owners, shared permissions, and oversized input. */
async function readPrivate(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      stat.size > 65_536
    ) {
      throw new ProbeFailure("preflight", "private_file_required");
    }
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

export async function readSandboxKey(options, env = process.env) {
  let value = env.PERSONA_API_KEY;
  if (options.keyFile) {
    const raw = (await readPrivate(options.keyFile)).trim();
    // Accept a raw key or one ordinary quoted/unquoted dotenv assignment.
    const assignments = raw
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:export\s+)?PERSONA_API_KEY\s*=/.test(line));
    if (assignments.length > 1) throw new ProbeFailure("preflight", "ambiguous_key_file");
    value =
      assignments.length === 1
        ? assignments[0].replace(/^\s*(?:export\s+)?PERSONA_API_KEY\s*=\s*/, "").trim()
        : raw;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
  }
  const key = value?.trim();
  if (!key || !/^persona_sandbox_[a-zA-Z0-9_-]+$/.test(key)) {
    throw new ProbeFailure("preflight", "sandbox_key_required");
  }
  return key;
}

async function writePrivate(path, value, exclusive = false) {
  const destination = exclusive ? path : join(dirname(path), `.persona-probe-${randomUUID()}.tmp`);
  const file = await open(
    destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(value), "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  if (!exclusive) {
    try {
      await rename(destination, path);
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
  }
}

function validState(state, templateId) {
  return (
    state?.kind === STATE_KIND &&
    state.templateId === templateId &&
    /^[a-f0-9-]{36}$/.test(state.referenceId ?? "") &&
    state.idempotencyKey === `samepace-persona-accountless:${state.referenceId}` &&
    Number.isFinite(Date.parse(state.createdAt)) &&
    (state.inquiryId === null || INQUIRY_ID.test(state.inquiryId)) &&
    Array.isArray(state.unexpectedAccountIds) &&
    state.unexpectedAccountIds.every((id) => SAFE_ID.test(id)) &&
    state.checks &&
    typeof state.checks === "object" &&
    Object.entries(state.checks).every(
      ([name, value]) => CHECK_NAMES.includes(name) && typeof value === "boolean",
    ) &&
    /^[a-f0-9]{64}$/.test(state.keyFingerprint ?? "") &&
    typeof state.cleanupVerified === "boolean" &&
    typeof state.accountCleanupPending === "boolean"
  );
}

async function request(
  key,
  doFetch,
  method,
  path,
  stage,
  body,
  idempotencyKey,
  allowMissing = false,
) {
  let response;
  try {
    response = await doFetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        accept: "application/json",
        "content-type": "application/json",
        "persona-version": VERSION,
        "key-inflection": "kebab",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ProbeFailure(stage, "provider_unreachable");
  }
  if (allowMissing && [404, 410].includes(response.status)) return { missing: true };
  if (!response.ok) {
    const category =
      response.status === 401
        ? "authentication_failed"
        : response.status === 403
          ? "permission_denied"
          : response.status === 404
            ? "resource_unavailable"
            : [409, 422].includes(response.status)
              ? "provider_state_or_request_rejected"
              : "provider_error";
    // Do not read or log provider error bodies: they can contain request data.
    await response.body?.cancel();
    throw new ProbeFailure(stage, category, response.status);
  }
  if (response.status === 204) return { empty: true };
  const reader = response.body?.getReader();
  if (!reader) throw new ProbeFailure(stage, "invalid_provider_response");
  let length = 0;
  const parts = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 512 * 1024) {
        await reader.cancel();
        throw new ProbeFailure(stage, "provider_response_too_large");
      }
      parts.push(part.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    throw new ProbeFailure(stage, "invalid_provider_response");
  }
}

function inspectInquiry(response, state, stage, requireToken) {
  const data = response?.data;
  if (data?.id !== state.inquiryId) throw new ProbeFailure(stage, "inquiry_id_mismatch");
  const account = data.relationships?.account;
  const related = [
    ...(Array.isArray(response.included) ? response.included : []),
    account?.data,
  ].filter(Boolean);
  if (
    (account?.data !== null && account?.data !== undefined) ||
    related.some((resource) => resource.type === "account")
  )
    state.accountCleanupPending = true;
  for (const resource of related) {
    if (
      (resource.type === "account" || resource === account?.data) &&
      SAFE_ID.test(resource.id ?? "")
    ) {
      if (!state.unexpectedAccountIds.includes(resource.id))
        state.unexpectedAccountIds.push(resource.id);
    }
  }
  const reference = data.attributes?.["reference-id"];
  state.checks[`${stage}ReferenceAbsent`] = reference == null;
  state.checks[`${stage}ReferenceCompatible`] =
    reference == null || reference === state.referenceId;
  const template = data.relationships?.["inquiry-template"]?.data;
  state.checks[`${stage}TemplateMatches`] =
    template?.type === "inquiry-template" && template.id === state.templateId;
  const updatedAt = Date.parse(data.attributes?.["updated-at"] ?? "");
  state.checks[`${stage}UpdateTimeValid`] =
    Number.isFinite(updatedAt) && updatedAt <= Date.now() + 5 * 60_000;
  state.checks[`${stage}AccountAbsent`] =
    account?.data === null && !related.some((item) => item.type === "account");
  if (requireToken)
    state.checks[`${stage}SessionTokenPresent`] =
      typeof response.meta?.["session-token"] === "string" &&
      response.meta["session-token"].length > 0;
  if (!state.checks[`${stage}ReferenceCompatible`])
    throw new ProbeFailure(stage, "reference_mismatch");
  if (!state.checks[`${stage}TemplateMatches`])
    throw new ProbeFailure(stage, "template_binding_unproven");
  if (!state.checks[`${stage}UpdateTimeValid`])
    throw new ProbeFailure(stage, "update_time_invalid");
  if (!state.checks[`${stage}AccountAbsent`])
    throw new ProbeFailure(
      stage,
      state.unexpectedAccountIds.length ? "unexpected_account" : "account_absence_indeterminate",
    );
  if (requireToken && !state.checks[`${stage}SessionTokenPresent`])
    throw new ProbeFailure(stage, "session_token_missing");
}

const redacted = (response, inquiryId) =>
  response?.missing === true ||
  (response?.data?.id === inquiryId &&
    typeof response.data.attributes?.["redacted-at"] === "string" &&
    Number.isFinite(Date.parse(response.data.attributes["redacted-at"])));

/** Exported for synthetic tests. No key, session token, or raw response is persisted. */
export async function runProbe(
  options,
  { env = process.env, doFetch = fetch, sleep = pause } = {},
) {
  let lock;
  let state;
  let failure;
  const lockPath = `${options.stateFile}.lock`;
  try {
    // Recheck explicit execution even when called directly instead of through CLI.
    parseOptions(
      [
        "--template-id",
        options.templateId ?? "",
        "--state-file",
        options.stateFile ?? "",
        ...(options.execute ? ["--execute"] : []),
      ],
      {},
    );
    const key = await readSandboxKey(options, env);
    const keyFingerprint = createHash("sha256").update(key).digest("hex");
    try {
      lock = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error?.code === "EEXIST") throw new ProbeFailure("preflight", "probe_busy");
      throw error;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }), "utf8");
    try {
      state = JSON.parse(await readPrivate(options.stateFile));
      if (!validState(state, options.templateId)) {
        state = undefined;
        throw new ProbeFailure("preflight", "invalid_state");
      }
      if (state.keyFingerprint !== keyFingerprint)
        throw new ProbeFailure("preflight", "credentials_changed");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (options.cleanupOnly) throw new ProbeFailure("preflight", "state_required_for_cleanup");
      const referenceId = randomUUID();
      state = {
        kind: STATE_KIND,
        templateId: options.templateId,
        referenceId,
        keyFingerprint,
        idempotencyKey: `samepace-persona-accountless:${referenceId}`,
        createdAt: new Date().toISOString(),
        inquiryId: null,
        unexpectedAccountIds: [],
        accountCleanupPending: false,
        checks: {},
        cleanupVerified: false,
      };
      await writePrivate(options.stateFile, state, true);
    }

    try {
      if (!state.inquiryId) {
        // Persona retains idempotency records for at least 24h. Stay below that
        // boundary when recovering an unknown create: docs.withpersona.com/idempotence.
        if (Date.now() - Date.parse(state.createdAt) > 23 * 3600_000)
          throw new ProbeFailure("create", "creation_reconciliation_required");
        // The request is identical on retry after a lost create response. The
        // persisted UUID/idempotency key exists before any provider mutation.
        const response = await request(
          key,
          doFetch,
          "POST",
          "/inquiries",
          "create",
          {
            data: {
              attributes: {
                "inquiry-template-id": state.templateId,
              },
            },
            meta: { "auto-create-inquiry-session": true, "auto-create-account": false },
          },
          state.idempotencyKey,
        );
        if (!INQUIRY_ID.test(response?.data?.id ?? ""))
          throw new ProbeFailure("create", "inquiry_id_unavailable");
        state.inquiryId = response.data.id;
        await writePrivate(options.stateFile, state);
        inspectInquiry(response, state, "create", true);
        await writePrivate(options.stateFile, state);
      }
      if (!options.cleanupOnly && !state.cleanupVerified) {
        for (const stage of ["retrieve", "resume"]) {
          const response = await request(
            key,
            doFetch,
            stage === "resume" ? "POST" : "GET",
            `/inquiries/${state.inquiryId}${stage === "resume" ? "/resume" : ""}`,
            stage,
          );
          inspectInquiry(response, state, stage, stage === "resume");
          await writePrivate(options.stateFile, state);
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      if (state.inquiryId && !state.cleanupVerified) {
        try {
          await request(
            key,
            doFetch,
            "DELETE",
            `/inquiries/${state.inquiryId}`,
            "redact",
            undefined,
            undefined,
            true,
          );
          for (let attempt = 0; attempt < 4; attempt++) {
            if (attempt) await sleep([250, 750, 1500][attempt - 1]);
            const response = await request(
              key,
              doFetch,
              "GET",
              `/inquiries/${state.inquiryId}`,
              "verify_redaction",
              undefined,
              undefined,
              true,
            );
            if (redacted(response, state.inquiryId)) {
              state.cleanupVerified = true;
              break;
            }
          }
          if (!state.cleanupVerified)
            failure ??= new ProbeFailure("verify_redaction", "redaction_unconfirmed");
        } catch (error) {
          failure ??= error;
        }
      }
      state.cleanupPending = !state.cleanupVerified || state.accountCleanupPending;
      state.lastStatus =
        failure instanceof ProbeFailure ? failure.status : failure ? "local_error" : "passed";
      await writePrivate(options.stateFile, state);
      if (!state.cleanupPending) await unlink(options.stateFile);
    }
  } catch (error) {
    failure ??= error;
  } finally {
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
  const passed =
    !failure &&
    !options.cleanupOnly &&
    REQUIRED_CHECKS.every((name) => state?.checks[name] === true) &&
    state?.cleanupVerified &&
    !state.cleanupPending;
  const summary = {
    status: passed
      ? "passed"
      : state?.cleanupPending
        ? "cleanup_pending"
        : options.cleanupOnly && !failure
          ? "cleaned"
          : "failed",
    checks: Object.fromEntries(
      CHECK_NAMES.filter((name) => typeof state?.checks?.[name] === "boolean").map((name) => [
        name,
        state.checks[name],
      ]),
    ),
    cleanupVerified: state?.cleanupVerified ?? false,
    cleanupPending: state?.cleanupPending ?? false,
    ...(state?.inquiryId ? { inquiryId: state.inquiryId } : {}),
    ...(state?.unexpectedAccountIds?.length
      ? { unexpectedAccountIds: state.unexpectedAccountIds }
      : {}),
    ...(failure
      ? {
          failureStage: failure instanceof ProbeFailure ? failure.stage : "local",
          failureStatus: failure instanceof ProbeFailure ? failure.status : "local_error",
          ...(failure instanceof ProbeFailure && failure.httpStatus
            ? { httpStatus: failure.httpStatus }
            : {}),
        }
      : {}),
  };
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let summary;
  try {
    summary = await runProbe(parseOptions(process.argv.slice(2)));
  } catch (error) {
    summary = {
      status: "failed",
      failureStage: "preflight",
      failureStatus: error instanceof ProbeFailure ? error.status : "local_error",
    };
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = ["passed", "cleaned"].includes(summary.status) ? 0 : 1;
}
