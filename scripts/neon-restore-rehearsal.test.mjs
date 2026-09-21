import { test } from "node:test";
import assert from "node:assert/strict";
import { ownedBranches, parseOptions, sanitizeDiagnostic } from "./neon-restore-rehearsal.mjs";

test("restore rehearsal requires explicit execution and never accepts a parent timestamp or implicit default", () => {
  for (const args of [
    [],
    ["--project-id", "project", "--schema-source", "br-preview"],
    ["--execute", "--project-id", "project", "--schema-source", "br-preview@2026-01-01"],
    ["--execute", "--project-id", "project", "--schema-source", "main"],
  ])
    assert.throws(() => parseOptions(args));
  assert.deepEqual(
    parseOptions(["--execute", "--project-id", "project-123", "--schema-source", "br-preview"]),
    { execute: true, "project-id": "project-123", "schema-source": "br-preview" },
  );
});
test("cleanup selects only exact attempted names absent before the run and never a protected/default branch", () => {
  const branches = [
    { id: "old", name: "own-seed" },
    { id: "mine", name: "own-restore" },
    { id: "unrelated", name: "own-restore-similar" },
    { id: "protected", name: "own-restore", protected: true },
    { id: "default", name: "own-seed", default: true },
  ];
  assert.deepEqual(ownedBranches(branches, new Set(["old"]), ["own-seed", "own-restore"]), [
    { id: "mine", name: "own-restore" },
  ]);
});

test("rehearsal errors preserve restrictions while removing connection URLs and credentials", () => {
  assert.equal(
    sanitizeDiagnostic("ERROR: modifying the suspend interval is not permitted on this account"),
    "ERROR: modifying the suspend interval is not permitted on this account",
  );
  const raw =
    "ERROR: postgresql://someone:synthetic-password@ep.example/db bearer synthetic-key api_key=synthetic-api-value " +
    "s".repeat(50);
  const safe = sanitizeDiagnostic(raw);
  for (const sensitive of [
    "synthetic-password",
    "someone",
    "synthetic-key",
    "synthetic-api-value",
    "s".repeat(50),
  ])
    assert.equal(safe.includes(sensitive), false);
  assert.equal(sanitizeDiagnostic("unstructured response body"), "Neon command failed.");
});
