import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOptions, readSandboxKey, runProbe } from "./persona-accountless-probe.mjs";

const KEY = "persona_sandbox_synthetic_test_only";
const TOKEN = "synthetic_session_token_never_print";
const folders = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "samepace-persona-probe-test-"));
  folders.push(folder);
  return {
    folder,
    options: {
      execute: true,
      templateId: "itmpl_synthetic",
      stateFile: join(folder, "state.json"),
    },
  };
}
function fakeProvider({
  wrongReference = false,
  echoReference = false,
  wrongTemplate = false,
  omitTemplate = false,
  account = null,
  omitAccount = false,
  lostCreate = false,
  deleteFailure = false,
  resumeStatus,
} = {}) {
  const calls = [];
  let reference;
  let idempotency;
  let redacted = false;
  let lost = lostCreate;
  const config = { deleteFailure };
  const response = (stage) =>
    new Response(
      JSON.stringify({
        data: {
          id: "inq_synthetic",
          type: "inquiry",
          attributes: {
            "reference-id": wrongReference
              ? "different-synthetic-reference"
              : echoReference
                ? reference
                : null,
            "updated-at": new Date().toISOString(),
            "redacted-at": redacted ? new Date().toISOString() : null,
            status: "created",
            "unneeded-private-field": "synthetic-private-payload-never-print",
          },
          relationships: {
            ...(omitAccount ? {} : { account: { data: account } }),
            ...(omitTemplate
              ? {}
              : {
                  "inquiry-template": {
                    data: {
                      type: "inquiry-template",
                      id: wrongTemplate ? "itmpl_wrong" : "itmpl_synthetic",
                    },
                  },
                }),
          },
        },
        meta: stage === "retrieve" ? {} : { "session-token": TOKEN },
      }),
      { headers: { "content-type": "application/json" } },
    );
  const doFetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://api.withpersona.com/api/v1/inquiries"));
    assert.equal(init.headers.authorization, `Bearer ${KEY}`);
    assert.equal(init.headers["persona-version"], "2023-01-05");
    assert.equal(init.headers["key-inflection"], "kebab");
    assert.equal(init.redirect, "error");
    calls.push({
      method: init.method,
      url,
      idempotency: init.headers["Idempotency-Key"],
      body: init.body,
    });
    if (String(url).endsWith("/inquiries")) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.meta, {
        "auto-create-inquiry-session": true,
        "auto-create-account": false,
      });
      assert.deepEqual(Object.keys(body.data.attributes), ["inquiry-template-id"]);
      reference ??= init.headers["Idempotency-Key"].split(":").at(-1);
      assert.match(reference, /^[a-f0-9-]{36}$/);
      idempotency ??= init.headers["Idempotency-Key"];
      assert.equal(idempotency, init.headers["Idempotency-Key"]);
      if (lost) {
        lost = false;
        throw new Error(`simulated lost response ${TOKEN}`);
      }
      return response("create");
    }
    if (init.method === "DELETE") {
      if (config.deleteFailure) return new Response(`secret ${KEY}`, { status: 503 });
      redacted = true;
      return response("redact");
    }
    if (String(url).endsWith("/resume")) {
      if (resumeStatus) return new Response(`secret ${TOKEN}`, { status: resumeStatus });
      return response("resume");
    }
    return response("retrieve");
  };
  return { calls, config, doFetch };
}
const run = (options, provider) =>
  runProbe(options, {
    env: { PERSONA_API_KEY: KEY },
    doFetch: provider.doFetch,
    sleep: async () => {},
  });

test("requires explicit execution, template ID, absolute state path and a sandbox key", async () => {
  assert.throws(() =>
    parseOptions(["--template-id", "itmpl_x", "--state-file", "/tmp/state.json"], {}),
  );
  assert.throws(() =>
    parseOptions(["--execute", "--template-id", "itmpl_x", "--state-file", "relative.json"], {}),
  );
  assert.throws(() =>
    parseOptions(
      ["--execute", "--template-id", "itmplv_wrong", "--state-file", "/tmp/state.json"],
      {},
    ),
  );
  const { options } = await fixture();
  let requests = 0;
  const result = await runProbe(options, {
    env: { PERSONA_API_KEY: "persona_production_synthetic" },
    doFetch: async () => {
      requests++;
    },
  });
  assert.equal(result.failureStatus, "sandbox_key_required");
  assert.equal(requests, 0);
  assert.equal(JSON.stringify(result).includes("persona_production_synthetic"), false);
});

test("reads only a protected non-symlink key file without requiring shell export", async () => {
  const { folder } = await fixture();
  const path = join(folder, "key.env");
  await writeFile(path, `OTHER_SECRET=unrelated\nPERSONA_API_KEY='${KEY}'\n`, { mode: 0o600 });
  assert.equal(await readSandboxKey({ keyFile: path }, {}), KEY);
  const shared = join(folder, "shared.key");
  await writeFile(shared, KEY, { mode: 0o644 });
  await assert.rejects(readSandboxKey({ keyFile: shared }, {}));
  const link = join(folder, "link.key");
  await symlink(path, link);
  await assert.rejects(readSandboxKey({ keyFile: link }, {}));
});

test("proves accountless reference binding on create/retrieve/resume and verifies redaction", async () => {
  const { options } = await fixture();
  const provider = fakeProvider();
  const result = await run(options, provider);
  assert.equal(result.status, "passed");
  assert.equal(
    Object.values(result.checks).every((value) => value === true),
    true,
  );
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.cleanupPending, false);
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    ["POST", "GET", "POST", "DELETE", "GET"],
  );
  await assert.rejects(readFile(options.stateFile), { code: "ENOENT" });
  await assert.rejects(readFile(`${options.stateFile}.lock`), { code: "ENOENT" });
  for (const secret of [KEY, TOKEN, "synthetic-private-payload-never-print"])
    assert.equal(JSON.stringify(result).includes(secret), false);
});

test("a binding mismatch still redacts the known inquiry and never reports acceptance", async () => {
  const { options } = await fixture();
  const provider = fakeProvider({ wrongReference: true });
  const result = await run(options, provider);
  assert.equal(result.status, "failed");
  assert.equal(result.failureStatus, "reference_mismatch");
  assert.equal(result.checks.createReferenceCompatible, false);
  assert.equal(result.cleanupVerified, true);
  assert.equal(
    provider.calls.some((call) => call.method === "DELETE"),
    true,
  );
});

test("a supplied reference must match even when absent references are supported", async () => {
  const { options } = await fixture();
  const result = await run(options, fakeProvider({ echoReference: true }));
  assert.equal(result.status, "passed");
  assert.equal(result.checks.createReferenceAbsent, false);
  assert.equal(result.checks.resumeReferenceCompatible, true);
});

test("wrong or omitted Dynamic Flow template binding is rejected and cleaned", async () => {
  for (const config of [{ wrongTemplate: true }, { omitTemplate: true }]) {
    const { options } = await fixture();
    const result = await run(options, fakeProvider(config));
    assert.equal(result.failureStatus, "template_binding_unproven");
    assert.equal(result.cleanupVerified, true);
  }
});

test("missing Account relationship is indeterminate, never proof of Account absence", async () => {
  const { options } = await fixture();
  const result = await run(options, fakeProvider({ omitAccount: true }));
  assert.equal(result.status, "failed");
  assert.equal(result.failureStatus, "account_absence_indeterminate");
  assert.equal(result.cleanupVerified, true);
});

test("unexpected parent Account is retained for reconciliation, never automatically deleted", async () => {
  const { options } = await fixture();
  const provider = fakeProvider({ account: { type: "account", id: "act_synthetic" } });
  const result = await run(options, provider);
  assert.equal(result.status, "cleanup_pending");
  assert.equal(result.failureStatus, "unexpected_account");
  assert.equal(result.cleanupVerified, true);
  assert.deepEqual(result.unexpectedAccountIds, ["act_synthetic"]);
  assert.equal(
    provider.calls.some((call) => String(call.url).includes("/accounts")),
    false,
  );
  const saved = JSON.parse(await readFile(options.stateFile, "utf8"));
  assert.deepEqual(saved.unexpectedAccountIds, ["act_synthetic"]);
  assert.equal((await stat(options.stateFile)).mode & 0o777, 0o600);
});

test("failed redaction retains private cleanup state and cleanup-only retries the original inquiry", async () => {
  const { options } = await fixture();
  const provider = fakeProvider({ deleteFailure: true });
  const first = await run(options, provider);
  assert.equal(first.status, "cleanup_pending");
  assert.equal(first.failureStage, "redact");
  const saved = await readFile(options.stateFile, "utf8");
  assert.equal((await stat(options.stateFile)).mode & 0o777, 0o600);
  for (const secret of [KEY, TOKEN]) {
    assert.equal(saved.includes(secret), false);
    assert.equal(JSON.stringify(first).includes(secret), false);
  }
  const requests = provider.calls.length;
  provider.config.deleteFailure = false;
  const second = await run({ ...options, cleanupOnly: true }, provider);
  assert.equal(second.status, "cleaned");
  assert.deepEqual(
    provider.calls.slice(requests).map((call) => call.method),
    ["DELETE", "GET"],
  );
  await assert.rejects(readFile(options.stateFile), { code: "ENOENT" });
});

test("lost create response preserves the exact operation for idempotent recovery", async () => {
  const { options } = await fixture();
  const provider = fakeProvider({ lostCreate: true });
  const first = await run(options, provider);
  assert.equal(first.status, "cleanup_pending");
  assert.equal(first.failureStage, "create");
  const state = JSON.parse(await readFile(options.stateFile, "utf8"));
  assert.equal(state.inquiryId, null);
  const second = await run(options, provider);
  assert.equal(second.status, "passed");
  assert.equal(provider.calls[0].idempotency, provider.calls[1].idempotency);
  assert.equal(provider.calls[0].body, provider.calls[1].body);
});

test("provider state errors are inconclusive and cleanup still runs", async () => {
  const { options } = await fixture();
  const result = await run(options, fakeProvider({ resumeStatus: 422 }));
  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "resume");
  assert.equal(result.failureStatus, "provider_state_or_request_rejected");
  assert.equal(result.httpStatus, 422);
  assert.equal(result.checks.retrieveReferenceCompatible, true);
  assert.equal(result.cleanupVerified, true);
});

test("a different credential cannot reconcile state from the original environment", async () => {
  const { options } = await fixture();
  const provider = fakeProvider({ lostCreate: true });
  await run(options, provider);
  const requests = provider.calls.length;
  const result = await runProbe(options, {
    env: { PERSONA_API_KEY: "persona_sandbox_different" },
    doFetch: provider.doFetch,
  });
  assert.equal(result.failureStatus, "credentials_changed");
  assert.equal(provider.calls.length, requests);
  assert.equal((await stat(options.stateFile)).mode & 0o777, 0o600);
});

test("an old unknown create requires reconciliation and never risks a second inquiry", async () => {
  const { options } = await fixture();
  const provider = fakeProvider({ lostCreate: true });
  await run(options, provider);
  const state = JSON.parse(await readFile(options.stateFile, "utf8"));
  state.createdAt = new Date(Date.now() - 24 * 3600_000).toISOString();
  await writeFile(options.stateFile, JSON.stringify(state));
  const requests = provider.calls.length;
  const result = await run({ ...options, cleanupOnly: true }, provider);
  assert.equal(result.status, "cleanup_pending");
  assert.equal(result.failureStatus, "creation_reconciliation_required");
  assert.equal(provider.calls.length, requests);
});

test("an existing process lock prevents provider requests and is not automatically removed", async () => {
  const { options } = await fixture();
  const provider = fakeProvider();
  await writeFile(`${options.stateFile}.lock`, JSON.stringify({ pid: process.pid }), {
    mode: 0o600,
  });
  const result = await run(options, provider);
  assert.equal(result.failureStatus, "probe_busy");
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(JSON.parse(await readFile(`${options.stateFile}.lock`, "utf8")), {
    pid: process.pid,
  });
});
