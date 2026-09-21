# Synthetic Neon restore rehearsal

The [2026-09-21 rehearsal](evaluations/neon-restore-2026-09-21.md) passed with verified canary recovery and deletion of both temporary branches. Its observed timings apply only to the small synthetic exercise; retention policy and production recovery targets remain separate decisions.

Run this only when authorized to create two temporary computes in the selected Neon project. The script uses an existing authenticated Neon CLI session and the project's current history window. It does not change retention, pricing plans, application environment variables, or existing branch endpoints.

```sh
node scripts/neon-restore-rehearsal.mjs --execute \
  --project-id PROJECT_ID \
  --schema-source PREVIEW_BRANCH_ID
```

The runner pins CLI version 5.0.0 and requires a branch ID, an explicit project, and `--execute`. It copies **schema only** from that branch, using a 0.25 CU compute and a 24-hour expiry. It verifies every public application table is empty before writing two synthetic canaries. It records a server timestamp and WAL location after the insert commits, changes one canary, and deletes the other. A separate temporary branch must recover both original values at the recorded timestamp.

CLI 5.0.0 `branches create --parent` accepts a branch or a timestamp separately, but does not parse `branch@timestamp`. A bare timestamp would refer to the project's default branch and is unsuitable for this isolated exercise. The script instead uses the CLI's authenticated API passthrough to supply `parent_id` and `parent_timestamp` together, naming only the temporary synthetic branch. The compute request leaves suspend timing at the account default; explicitly setting it is rejected on the current account. These fields are documented by the [create-branch API](https://api-docs.neon.tech/reference/createprojectbranch).

All CLI output is captured in memory. Connection URLs are passed directly to the PostgreSQL client, never printed, persisted, or placed in command arguments. Raw database responses are suppressed. A single CLI error line may be retained after removing URLs, authorization values, credential fields, and token-shaped values. The report contains branch identifiers, zero row counts, synthetic canaries, recovery coordinates, timing, and cleanup results. It contains no credentials or member records.

A sanitized report is checkpointed before branch creation and before removing seed expiry, so branch names/IDs remain available even if the process is interrupted. Cleanup runs even after failure. It identifies only exact, randomized names attempted during that run, excludes all pre-existing/default/protected branches, deletes the restore child before its synthetic parent, then checks both are absent and all pre-existing branch IDs remain. A failed command can still create a branch, so cleanup also reconciles a create whose response was lost. Neon [forbids children of expiring branches](https://neon.com/docs/guides/branch-expiration#restrictions), so the runner temporarily clears expiry on its own synthetic seed immediately before creating the restore child. The child keeps its 24-hour expiry. With CLI 5.0.0, removing expiry requires omitting `--expires-at`; the documentation example using the literal `null` is rejected by that version. If deleting the seed fails after removing the child, the runner reapplies the seed expiry and records the failure. If the process is forcibly terminated while the seed has no expiry, use the reported temporary branch IDs to remove the child and then the seed; never delete an existing branch. Expiry does not replace verification of deletion.

Review the generated `docs/evaluations/neon-restore-<date>-<run>.json` report. A complete pass requires:

- `status: passed`, original canaries restored, and zero restored auth/health records.
- `cleanupVerified`, `sourceStillPresent`, and `preExistingBranchIdsStillPresent` all true.
- Every entry in `cleanup` has `deleted: true`.

`restoreRequestToVerificationMs` measures the restore-branch request, obtaining its connection, and verifying canaries. `mutationToVerificationMs` starts after the destructive synthetic changes commit. These are observations from a tiny synthetic database, not a production RTO commitment. This exercise does not test application traffic failover, production-volume recovery, external provider state, or recovery older than the project's configured history window. The existing six-hour history policy still requires a product/operations retention decision; this runner never changes it.

Official references: [CLI branches](https://neon.com/docs/reference/cli-branches), [schema-only branches](https://neon.com/docs/guides/branching-schema-only), and [connection strings](https://neon.com/docs/reference/cli-connection-string). Read current help before changing the pinned version.
