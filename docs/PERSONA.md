# Persona setup and acceptance

Identity checks use Persona's hosted inquiry flow. SamePace stores the inquiry
reference and result, while Persona receives the submitted identity material.
Keep `VERIFICATION_ENFORCED` off until the selected templates, workflows,
redirects, signed events and deletion behavior have passed provider acceptance.

## Current sandbox setup

The following templates are published shared Persona configuration; template
publication is not isolated to Sandbox. The associated workflows are activated
only in Sandbox. These are setup records, not evidence that a hosted verification
or provider acceptance test has passed. Use the template IDs, not their version
IDs, in application configuration.

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
selfie liveness and ID-portrait comparison checks.

Read-only dashboard inspection confirmed these **Required** settings in the
published versions. They describe configuration, not verification results.

| Template      | Check                       | Required |
| ------------- | --------------------------- | -------- |
| Member        | `selfie_liveness_detection` | `1`      |
| Member        | `selfie_id_comparison`      | `0`      |
| Government ID | `selfie_liveness_detection` | `1`      |
| Government ID | `selfie_id_comparison`      | `1`      |
| Government ID | `id_selfie_comparison`      | `1`      |

These checks still need actual sandbox pass/fail and completion-path acceptance.

The completed-inquiry decision workflow is published and **activated only in
Sandbox**:

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

The failed-inquiry review workflow is also published and **activated only in
Sandbox**:

- Workflow: `wfl_AzLHMsD1H7hubtYvrGyKE576hNco3y`.
- Published version: `wfv_AzLHMsDofpRAafWg2z5NSSqcy7D3i6`.
- Scope: only the same two exact template IDs listed above.
- It marks a failed inquiry for review and opens a Case linked only to the
  Inquiry; the Account relationship has been removed.
- It waits for a manual Case decision, then approves or declines the inquiry.

Both workflows are deactivated in Production. Their published configuration
still requires sandbox acceptance, including the failed-inquiry review path and
both possible manual decisions.

Sandbox key `api_AzLHMsDGu9YuHAMi6HdGHPpY7N2GoS` is created. Reloading its saved
settings confirmed only **Access all inquiries** and **Create inquiries** are
enabled; other permissions, including template read/write, are off. API version
is `2023-01-05`. The key and signing secret are stored privately and are never
included in this document or client code.

Webhook `wbh_AzLHMsDHzhj3dfUUqAvkriebVDdeqp` is enabled for the approved protected
Preview endpoint, using version `2023-01-05`, kebab-case payloads and nine inquiry
events. Its saved event filter allows only the two exact template IDs above.
Retain the inquiry's `inquiry-template` and `account` relationship IDs/nulls;
the adapter fails closed if those relationships are missing. Included identity
resources are unnecessary.

The narrow live Sandbox API probe passed as recorded below. This branch now
implements the accountless adapter with a durable local binding; the earlier
metadata-only patch was insufficient and is superseded. Deployment and full
application lifecycle acceptance remain separate. Production application
credentials have not been configured, and verification enforcement remains off.

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

Production activation requires a production key, reviewed template settings and
workflow activation for Production, and its own webhook secret. A local
fake-provider test proves the application's guard; it does not prove a real
identity check or approval workflow.
Persona documents distinct `persona_sandbox_` and `persona_production_` key
prefixes in its [API-key guide](https://docs.withpersona.com/api-keys).

The guard checks the configured API key. It does not remove existing simulated
approvals or certify that a webhook secret belongs to the same environment as
that key. Rotate the full provider configuration together, and never promote
sandbox rows into production. Persona's documented event body has no
authoritative environment field for the receiver to validate.

## Accountless binding and provider evidence

The adapter explicitly sends `meta.auto-create-account=false` and omits the
deprecated member `reference-id`. Without the explicit flag, Account creation
defaults to true in Persona's [versioned inquiry creation schema](https://docs.withpersona.com/2023-01-05/api-reference/inquiries/create-an-inquiry).
The template's No Account setting alone is not the API contract. Its replacement
`meta.auto-create-account-reference-id` requires Account creation and is not used.

New verification rows use binding version `1`: the server-created inquiry ID is
uniquely associated with the signed-in member, tier, requested template and key
environment. Create, resume, refresh and signed webhook processing require that
exact binding, the Dynamic Flow `inquiry-template` relationship, and explicit
`account.data=null`. A missing provider reference is allowed only for these new
rows; any supplied non-null mismatch is rejected. Legacy version `0` rows remain
reference-strict. Unknown environments are never inferred from whichever key is
currently configured, for either badge updates or deletion acknowledgements.

Three disposable member-template inquiries were tested on **2026-09-21 UTC**:

| Inquiry                              | Request and observed result                                                                                                                                                                                                                                             | Cleanup                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `inq_AzLHMsDtK2RgHNoEYo2dQVRT5YC4Pv` | Initial accountless request supplied a synthetic reference. Create returned explicit no Account and a session token, but did not echo that reference. The original reference-equality probe failed and stopped before retrieve/resume.                                  | Inquiry redaction confirmed; no pending cleanup. |
| `inq_AzLHMsDjRYDLwjjMrRDUsUGhv2Trgq` | Expanded probe accepted an absent reference while requiring the exact template, no Account, valid update timestamps and session tokens. Create, retrieve and resume passed.                                                                                             | Inquiry redaction confirmed; no pending cleanup. |
| `inq_AzLHMsDNZdkKRoopWG2ogypieqMA1v` | Probe used the adapter's final request body: template only, Account creation disabled, no member reference. Create, retrieve and resume returned the exact template, explicit no Account, absent reference and valid timestamps; create/resume returned session tokens. | Inquiry redaction confirmed; no pending cleanup. |

The probe retained no key, session token or provider payload. Its temporary
recovery files were removed after successful cleanup. These results establish
the narrow API contract and inquiry redaction acknowledgement. They do not prove
phone/selfie checks, government-ID outcomes, signed event delivery, review Case
retention, or erasure of all child resources.

## Durable creation and cleanup

An opaque creation intent is committed before contacting Persona. It stores the
requested template and environment, binding version and stable idempotency key.
The exact replay body contains no member identifier. The returned inquiry ID is
committed before the binding callback, so a later database rollback cannot erase
the cleanup identity. No hosted URL is returned before the member binding commits.

Account deletion cancels unresolved intents and scrubs their member/tier
association. Known inquiries enter the redaction queue; a dispatched create with
an unknown result can be replayed with the exact same key/body and then redacted.
Leases fence stale workers. Unknown creates are not replayed after 23 hours;
they remain `review_required` for operator reconciliation rather than risking a
second inquiry after idempotency expiry. Known-ID recovery uses that ID.

The admin operating view shows pending Persona creations and creations needing
review alongside redaction jobs. Operators must inspect `review_required`
records, resolve unknown creates through the correct Persona environment, and
confirm cleanup before removing an obligation. Null-environment legacy
redaction jobs stay pending until positive provider evidence establishes the
environment; a not-found response from the currently configured key is not proof.

An unexpected Account is rejected and its opaque ID retained for manual review,
including if it appears after initial binding. The inquiry is queued for
redaction, but the app never blindly deletes the Account. Inquiry redaction does
not redact a parent Account, as explained in [Persona's redaction guide](https://help.withpersona.com/articles/48Fu5XOdmd1y5v1xvbCkn8/).
The runtime key has no Account or Case management permissions. Both configured
review workflows link Cases only to the Inquiry, but Case retention and deletion
still require actual provider acceptance. Do not describe an inquiry redaction
acknowledgement as proof that all biometric data, Cases or child resources have
been erased.

## Run the disposable accountless probe

The script's synthetic tests do not replace the provider evidence above. Run it
only with an operator-authorized sandbox key and published member
template. It refuses production keys and never starts a browser or submits a
phone number, photo or document. A fresh UUID identifies the probe operation;
no member identifier is sent to Persona.

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

The probe sends top-level `meta.auto-create-account=false` and the template ID,
without a member reference, using API version `2023-01-05` and
kebab-case responses. It creates, retrieves and resumes one inquiry, requiring
the same inquiry ID, exact Dynamic Flow template and explicit
`relationships.account.data=null` in each response. References may be absent;
any supplied reference must match the private probe UUID. An omitted relationship
is inconclusive, not proof that no
Account exists. Create and resume must return a session token; the script only
records whether it is present. It then redacts the inquiry and reads it back
with bounded retries, requiring `redacted-at` or a missing-resource response.
Persona may redact child resources asynchronously, so this confirms the inquiry
redaction acknowledgement, not independent erasure of every child.

Only a `passed` result, all required checks `true`, `cleanupVerified:true`, and
`cleanupPending:false` satisfy this narrow accountless compatibility probe.
The `ReferenceAbsent` flags describe availability rather than a required outcome.
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
- Verify the durable member/inquiry/template binding through actual signed
  events and app refresh for both templates. The narrow API probe above is only
  the first part of lifecycle acceptance.
- Exercise a real review Case and account deletion, then confirm inquiry, child
  resource and Case retention behavior with Persona. Unexpected Accounts remain
  explicit manual review obligations; they must not be silently forgotten.
- Verify that missing credentials and provider failures leave redaction jobs
  pending, and that later retries finish them.
- Assign moderation and appeal ownership before requiring verification.

No provider acceptance result is implied by the automated tests.
