import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Exercise the actual shell script with a fake CLI. No provider call occurs.
function run(overrides) {
  const root = mkdtempSync(join(tmpdir(), "samepace-env-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    copyFileSync(
      new URL("./setup-vercel-env.sh", import.meta.url),
      join(root, "scripts/setup-vercel-env.sh"),
    );
    writeFileSync(
      join(root, "bin/npx"),
      `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2).filter(arg => arg !== '--yes');
if (args[0] === 'neonctl') {
  console.log(args[2] === process.env.NEON_PRODUCTION_BRANCH ? process.env.TEST_PRODUCTION_URL : process.env.TEST_PREVIEW_URL);
} else if (args[0] === 'vercel' && args[2] === 'add') {
  appendFileSync(process.env.TEST_LOG, JSON.stringify({ key: args[3], target: args[4], value: readFileSync(0, 'utf8') }) + '\\n');
} else if (args[0] === 'vercel' && args[2] === 'ls') {
  console.log('DATABASE_URL BETTER_AUTH_SECRET');
} else { process.exit(2); }
`,
      { mode: 0o755 },
    );
    const result = spawnSync("sh", [join(root, "scripts/setup-vercel-env.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        TEST_LOG: join(root, "calls"),
        NEON_PRODUCTION_BRANCH: "production",
        NEON_PREVIEW_BRANCH: "preview",
        TEST_PRODUCTION_URL: "postgresql://admin:prod-secret@ep-prod-pooler.neon.tech/neondb",
        TEST_PREVIEW_URL: "postgresql://admin:preview-secret@ep-preview-pooler.neon.tech/neondb",
        ...overrides,
      },
    });
    const calls = existsSync(join(root, "calls"))
      ? readFileSync(join(root, "calls"), "utf8").trim().split("\n").map(JSON.parse)
      : [];
    return { ...result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("deployment database isolation", () => {
  it("requires an explicit preview branch before writing provider settings", () => {
    const result = run({ NEON_PREVIEW_BRANCH: "" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
  it("rejects the same named branch", () => {
    const result = run({ NEON_PREVIEW_BRANCH: "production" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
  it("rejects aliases or different credentials for the same database endpoint", () => {
    const result = run({
      TEST_PREVIEW_URL: "postgresql://other:other-secret@ep-prod.neon.tech/another-db",
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
    assert.match(result.stderr, /same database endpoint/);
    assert.doesNotMatch(result.stdout + result.stderr, /prod-secret|other-secret/);
  });
  it("writes distinct database destinations without exposing their values", () => {
    const result = run({});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.calls.map(({ key, target }) => ({ key, target })),
      [
        { key: "DATABASE_URL", target: "production" },
        { key: "DATABASE_URL", target: "preview" },
        { key: "BETTER_AUTH_SECRET", target: "preview" },
      ],
    );
    assert.match(result.calls[0].value, /@ep-prod-pooler/);
    assert.match(result.calls[1].value, /@ep-preview-pooler/);
    assert.doesNotMatch(result.stdout + result.stderr, /prod-secret|preview-secret/);
  });
});
