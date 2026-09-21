# Persona setup and acceptance

Identity checks use Persona's hosted inquiry flow. SamePace stores the inquiry
reference and result, while Persona receives the submitted identity material.
Keep `VERIFICATION_ENFORCED` off until the selected templates, workflows,
redirects, signed events and deletion behavior have passed provider acceptance.

## Current sandbox setup

The following templates are published in Persona Sandbox. These are setup
records, not evidence that a hosted verification or provider acceptance test has
passed. Use the template IDs, not their version IDs, in application configuration.

| Purpose                  | Template ID                            | Published version ID                    |
| ------------------------ | -------------------------------------- | --------------------------------------- |
| Member: phone and selfie | `itmpl_AzLHMsDodgCwTKmzM3guMefByKBPSs` | `itmplv_AzLHMsDFsjNw4w89G5Fd9pmZ3Uo4Vt` |
| Government ID and selfie | `itmpl_AzLHMsDYwLmYXyoRRBF2Cee5mJuR4K` | `itmplv_AzLHMsDJgpxTBEVzsAJpyaGVg8QDB6` |

Both templates select **No Account**, have no reachable Account-copy action, and
block client-side inquiry creation. Their allowed domain is exactly
`samepace-git-codex-backlog-completion-servesys-labs.vercel.app`. Their return URL
is `https://samepace-git-codex-backlog-completion-servesys-labs.vercel.app/verified`,
without reference or status fields in the URL.

The member route runs phone OTP followed by selfie verification. It bypasses the
government-ID route, does not require comparison to an ID portrait, and requires
selfie liveness. The government-ID template retains the default ID verification,
selfie liveness and ID-portrait comparison checks. These configured checks still
need actual sandbox pass/fail and completion-path acceptance.

The completed-inquiry decision workflow is published **in Sandbox only**:

- Workflow: `wfl_AzLHMsDEmiEGKUUdLkhgj6iCAquWw9`.
- Published version: `wfv_AzLHMsDTRv1SPKR6GUB1fZWBGR6Say`.
- Scope: only the two exact template IDs listed above.
- Tor use, high selfie risk or high behavior risk sends the inquiry to
  `needs_review` and creates a Case containing the Inquiry only.
- Otherwise, the workflow approves the completed inquiry.

Before accepting that approval path, prove that the templates cannot reach
completion without all their required checks. A published workflow and a
completed hosted flow are not, by themselves, evidence of successful identity
verification.

The failed-inquiry review workflow is also published **in Sandbox only**:

- Workflow: `wfl_AzLHMsD1H7hubtYvrGyKE576hNco3y`.
- Published version: `wfv_AzLHMsDofpRAafWg2z5NSSqcy7D3i6`.
- Scope: only the same two exact template IDs listed above.
- It marks a failed inquiry for review and opens a Case linked only to the
  Inquiry; the Account relationship has been removed.
- It waits for a manual Case decision, then approves or declines the inquiry.

Both workflows are deactivated in Production. Their published configuration
still requires sandbox acceptance, including the failed-inquiry review path and
both possible manual decisions.

API-key creation is awaiting the user's Persona dashboard reauthentication. The
accountless API probe has **not run**, and the separate
`meta.auto-create-account=false` adapter patch has **not been applied**. The
template's No Account choice does not establish API behavior; see the accountless
acceptance section below. Production Persona configuration and verification
enforcement remain off.

## Keep sandbox and production separate

Use sandbox credentials only in local development or an isolated Vercel preview.
Preview deployments must use their own database and webhook secret. Setting
`NODE_ENV=production` is normal in a Vercel preview, so `VERCEL_ENV=preview` is the
explicit exception that allows sandbox keys. `VERCEL_ENV=production` always
requires the documented `persona_production_` prefix, rejecting sandbox,
placeholder and unrecognized keys; a production Node deployment without the
explicit preview environment does the same. This covers
new inquiries, resumes, refreshes, signed webhook updates and provider redaction
requests. A configured but rejected sandbox key does not fall back to the
development approval endpoint, and queued redactions remain pending.

The development approval endpoint stays disabled when either `NODE_ENV` or
`VERCEL_ENV` is `production`, even in a Vercel preview. Use actual sandbox
inquiries to test that environment. Do not copy sandbox verification rows or
approved profile badges into the production database.

Production activation requires a production key, production templates and its
own webhook secret. A local fake-provider test proves the application's guard;
it does not prove a real identity check or approval workflow.
Persona documents distinct `persona_sandbox_` and `persona_production_` key
prefixes in its [API-key guide](https://docs.withpersona.com/api-keys).

The guard checks the configured API key. It does not remove existing simulated
approvals or certify that a webhook secret belongs to the same environment as
that key. Rotate the full provider configuration together, and never promote
sandbox rows into production. Persona's documented event body has no
authoritative environment field for the receiver to validate.

## Accountless setup is not accepted yet

The current adapter still omits `meta.auto-create-account`, which defaults to
`true` in Persona's [versioned inquiry creation schema](https://docs.withpersona.com/2023-01-05/api-reference/inquiries/create-an-inquiry).
Removing Account-copy workflow steps or setting the template's Account option
does not establish that API-created inquiries avoid automatic Accounts.

Before applying `meta.auto-create-account: false`, use a disposable sandbox
inquiry to prove that the existing `data.attributes.reference-id` survives and
that no parent Account exists. The app requires that reference on refresh and
webhook updates. Persona documents the old field as deprecated; its replacement
`meta.auto-create-account-reference-id` requires Account creation, so it cannot
be substituted in an accountless request. A fake-provider test can check the
outgoing flag but cannot prove this provider behavior.

If the probe fails, add durable Account redaction and preserve the Account ID
before activation. Inquiry redaction does not redact its parent Account, as
explained in [Persona's redaction guide](https://help.withpersona.com/articles/48Fu5XOdmd1y5v1xvbCkn8/).

## Run the disposable accountless probe

The script is prepared; its synthetic tests are not provider acceptance. Run it
only after the operator authorizes the sandbox key and published member
template. It refuses production keys and never starts a browser or submits a
phone number, photo or document. The only member reference is a fresh UUID.

The key can be in the process's `PERSONA_API_KEY` environment variable or a
private file containing the raw key or a `PERSONA_API_KEY=...` assignment. Files
must belong to the current user, deny group/other access, and not be symlinks.
Do not put a key in command-line arguments. The state-file directory must exist;
use a new, private location outside the repository.

```sh
node scripts/persona-accountless-probe.mjs --execute \
  --template-id itmpl_AzLHMsDodgCwTKmzM3guMefByKBPSs \
  --key-file /private/path/persona.env \
  --state-file /private/tmp/samepace-persona-probe-UNIQUE.json
```

The probe sends top-level `meta.auto-create-account=false` together with the
existing `data.attributes.reference-id`, using API version `2023-01-05` and
kebab-case responses. It creates, retrieves and resumes one inquiry, requiring
the exact UUID reference and an explicit `relationships.account.data=null` in
each response. An omitted relationship is inconclusive, not proof that no
Account exists. Create and resume must return a session token; the script only
records whether it is present. It then redacts the inquiry and reads it back
with bounded retries, requiring `redacted-at` or a missing-resource response.
Persona may redact child resources asynchronously, so this confirms the inquiry
redaction acknowledgement, not independent erasure of every child.

Only a `passed` result, all checks `true`, `cleanupVerified:true`, and
`cleanupPending:false` satisfy this narrow accountless compatibility probe.
An authentication, permission, template, resume-state or validation error does
not establish that accountless reference binding is unsupported. Full hosted
verification and webhook acceptance remain separate.

Before creation, the script persists the synthetic reference, idempotency key,
template ID and a one-way credential fingerprint in a `0600` state file. It
never stores the key, session tokens or provider payloads. Successful cleanup
removes that state. A lost create response or failed redaction retains it;
rerun with the same state path, key and template. Add `--cleanup-only` to retry
cleanup without repeating retrieve/resume checks. If creation returned no ID,
cleanup-only may replay the exact original idempotent create to recover its ID;
it refuses that replay after 23 hours and requires operator reconciliation.
This stays below Persona's documented [minimum 24-hour idempotency retention](https://docs.withpersona.com/idempotence).

Unexpected Account references remain in the private state for operator cleanup
even after inquiry redaction. The script never deletes an Account because it
cannot prove that a returned Account belongs exclusively to this probe. It uses
a sibling `.lock` file to prevent simultaneous runs. If the process is killed,
confirm the recorded process has stopped before removing only that lock and
resuming. Do not remove pending state until the provider resources are reconciled.

## Provider acceptance still required

- Confirm the member template performs phone verification and selfie liveness,
  and the government-ID template performs the approved document/selfie checks.
- Confirm template workflow decisions map to approved, declined and needs-review
  inquiries. Completing a hosted flow alone never grants a badge.
- Exercise hosted return, server refresh, signed webhook delivery, duplicate
  events and review reversals against the isolated preview environment.
- Verify member-reference binding and deletion with the actual provider. The
  existing deletion queue redacts inquiries; automatic Persona Account creation
  must not leave a separate copy of identity material outside that obligation.
- Verify that missing credentials and provider failures leave redaction jobs
  pending, and that later retries finish them.
- Assign moderation and appeal ownership before requiring verification.

No provider acceptance result is implied by the automated tests.
