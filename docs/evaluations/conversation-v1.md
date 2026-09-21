# Private conversation evaluation v1

The 50 cases in `conversation-v1-cases.json` use invented members, workout records, preferences and sessions. They cover tool selection, missing readings, permissions and execution boundaries, ambiguous requests, malicious text in inputs/tool results, and editable preference drafts. The fixture timeline is September 2026. No account, database, HealthKit or real member data is accessed.

The command is **offline by default**:

```sh
node --experimental-strip-types scripts/evaluate-conversation.mjs --dry-run
node --experimental-strip-types --test scripts/evaluate-conversation.test.mjs
```

After cloud-provider setup and approval to spend credits, explicitly run the real configured adapter:

```sh
node --experimental-strip-types scripts/evaluate-conversation.mjs --run --limit 50
```

Supply the existing server-only `ASSISTANT_CHAT_ENABLED=true` and Gateway authentication through the process environment. This command does not load, copy or display credential files. It uses `ASSISTANT_CHAT_MODEL` (or the adapter's default), the production prompts/tool schemas, and the same Gateway privacy options. No alternate mock/fake model CLI mode exists. Tests inject an offline provider only to verify the harness; their passing results are not evidence of model quality.

A live run is sequential, at most 50 cases, at most three model steps per case, and at most 45 seconds per case. The harness limits each case to six tool calls and 12,000 reply characters. It stops after three consecutive provider errors/timeouts. `--limit 1` runs a small smoke evaluation first. No live run has been performed as part of adding this harness.

Results are written to a new file under ignored `artifacts/`, with owner-only file permissions. `--output /absolute/new-report.json` selects a different new file; existing files are never overwritten. The report file is reserved before model calls, then updated after each case so a stopped process leaves its completed results. Exit code 1 means a mechanical failure or a response flagged for review; 2 means a setup/reporting failure. The report records case IDs, latency, observed tool names, missing/unexpected calls, draft mismatches, bounded output hashes, provider failures/timeouts and review flags. It excludes prompts, tool payloads, provider errors, credentials and response text by default. `--include-responses` explicitly includes synthetic response text and tool-call arguments for review, making extra or incorrect draft fields visible. Neither is included by default.

Mechanical checks verify required/allowed tools, review targets, draft field values and policy limits. Text-pattern screening only flags possible invented facts, execution claims or instruction injection. Quotes and negations can match those patterns; a flag is not a semantic verdict. A mechanical pass is **not** an accuracy, safety or groundedness score. Every result remains `qualitativeReview: unreviewed` until a person evaluates the answer against the case and source facts. Also review whether refusals, clarifying questions and medical escalation language are appropriate.

These model evaluations complement the service's deterministic authorization, consent-race, ownership and persistence tests. Synthetic evaluation tools have no ability to book, charge, message, change sharing or save workouts; model cooperation does not grant those permissions in the application.
