# Neon recovery rehearsal — 2026-09-21

**Passed:** a real Neon point-in-time branch restored two synthetic canaries to their original values after one was changed and one deleted. The [successful machine-readable report](neon-restore-2026-09-21-1dfbf62b.json) records the checks and cleanup. The reusable [runner and runbook](../RESTORE-REHEARSAL.md) describe the bounded procedure.

The run began at 03:27:48 UTC in project `broad-tree-20089008`, using a schema-only copy of the preview branch. All 43 public application tables were verified empty before writing either canary. The recovery target was the server timestamp `2026-09-21T03:27:58.677880Z`, captured after the original inserts committed. The restored branch contained both original markers; its member and health-record counts were zero.

| Observation                                           | Result                |
| ----------------------------------------------------- | --------------------- |
| Restore request through verified canaries             | 2.738 seconds         |
| Synthetic changes committed through verified canaries | 3.804 seconds         |
| Complete run, including setup and cleanup             | 20.588 seconds        |
| Original canaries recovered                           | 2 of 2                |
| Temporary branches deleted and absence verified       | 2 of 2                |
| Existing branches still present                       | Both main and preview |

The temporary restored child `br-wandering-feather-au4iqij1` was deleted before its seed `br-bitter-feather-auzaf18e`. The runner verified every pre-existing branch ID still existed. It did not write to main or preview, modify their endpoints, change history retention or the account plan, or persist credentials.

Seven preceding attempts failed before recovery verification. Their reports are retained as diagnostic history, and each confirms cleanup. The fixes addressed CLI 5.0.0's unsupported `branch@timestamp` create syntax, Neon's restriction on children of expiring branches, CLI handling of expiry removal, and this account's rejection of an explicitly configured compute suspend interval. In particular, [the final failed attempt](neon-restore-2026-09-21-b7dcb0e9.json) records the sanitized provider restriction. The successful request used explicit `parent_id` and `parent_timestamp`, temporarily removed only the synthetic seed's expiry, and left compute suspend timing at the account default.

This proves recovery of committed synthetic rows from a recent point in time on the current provider. It does **not** establish a production RTO/RPO, production-volume recovery, application traffic failover, restoration of external provider state, or recovery beyond the existing history window. The current six-hour retention policy was unchanged and still needs an explicit product/operations decision.
