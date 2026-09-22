# Persona setup and acceptance

Identity checks use Persona's hosted inquiry flow. SamePace stores the inquiry
reference and result, while Persona receives the submitted identity material.
Keep `VERIFICATION_ENFORCED` off until the selected templates, workflows,
redirects, signed events and deletion behavior have passed provider acceptance.

## Current sandbox setup

The following templates are published shared Persona configuration; template
publication is not isolated to Sandbox. The associated workflows are activated
only in Sandbox. These are setup records; the bounded synthetic lifecycle
acceptance below is separate from hosted verification. Use the template IDs, not their version
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

Both workflows are deactivated in Production. The synthetic failed-inquiry
review path and both manual decisions passed the release acceptance below;
required identity checks still need hosted acceptance.

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

The accountless adapter is deployed to the isolated Preview with migrations
0024/0025 and a durable local binding. The narrow API probe and synthetic
application lifecycle checks passed as recorded below. Production application
credentials have not been configured, and verification enforcement remains off.

## Synthetic Sandbox lifecycle acceptance

On **2026-09-21 UTC**, Preview commit `918bc40` created both tiers for one
disposable synthetic member. Each inquiry had an exact version-1 owner, tier,
template and Sandbox binding, with Persona's Account relationship explicitly
null. No phone number, selfie, ID document, health record or workout was used.

- Member inquiry `inq_AzLHMsDn1vESMT2464YuibHMy5T37b` moved through pending,
  needs-review, declined and approved. Actual signed Persona events updated
  SamePace without calling its verification refresh endpoint.
- Government-ID inquiry `inq_AzLHMsD2xeHrZbKsQ1iuT4bqHGFbEC` used Persona's
  completion simulation. The configured Sandbox workflow approved it and the
  signed events updated SamePace. A subsequent attempt to simulate review from
  that approved state was rejected with HTTP 400; it did not verify revocation.
- Both badges were present before account deletion. Deletion rejected the old
  session, removed the sign-in record, scrubbed the profile and removed its
  verification bindings. The worker redacted both inquiries, confirmed by
  subsequent Persona reads. No fixture creation intent, verification, redaction
  job, health record or fitness record remained.
- Separately, two saved approval snapshots signed by the test harness returned
  `unknown_inquiry` after deletion and did not restore either badge. These
  requests are application replay tests, not Persona-originated deliveries.
- Persona Dashboard then redelivered the genuine saved approvals for both
  tiers. Each second delivery completed with HTTP 200 and `unknown_inquiry`:
  member event `evt_AzLHMsDB6xrAzkx1VQRZmMx82MtYH4` at 04:58:39 UTC and
  government-ID event `evt_AzLHMsDkavMRtpLcnRuCNgwmCxPqcj` at 04:59:39 UTC.
  A database check after both deliveries confirmed the profile remained
  deleted and scrubbed, both badges stayed false, and no sign-in, verification,
  redaction or creation-intent rows returned.
  These verify post-deletion rejection, not active-inquiry deduplication or
  ordering of first-seen events.

Persona's [Sandbox simulation actions](https://docs.withpersona.com/2023-01-05/api-reference/inquiries/perform-simulate-actions)
exercise lifecycle behavior without performing the identity checks. These
results establish provider connectivity, template binding, status mapping and
inquiry cleanup. They do not establish phone ownership, liveness, ID matching,
required-check gating, hosted returns, manual Case decisions, or erasure of all
child resources and Cases.

## Keep sandbox and production separate

### Release acceptance on 2026-09-22 UTC

One new disposable synthetic member was tested against the existing isolated
Preview. Member inquiry `inq_AzLHMsDtUjqwuBJGFR4HQ8a8CdWpSL` used the published
member template with no Account, phone, photo or document. Actual signed Persona
events moved it through pending, needs review, declined and approved. Calling
Persona's documented decline endpoint after approval produced a genuine signed
revocation and removed the member badge. This is lifecycle acceptance, not an
identity check.

Two application-level replay checks then passed while the inquiry was active:
reusing the genuine approval event ID returned `duplicate`, and sending its old
provider snapshot with a previously unseen harness event ID left the newer
decline intact. These requests were signed by the local acceptance harness;
they are not additional Persona-originated webhook deliveries.

Provider reads of previously redacted inquiries exposed a production-relevant
adapter defect: Persona retains `status: approved` after setting `redacted-at`.
Migration `0035_persona_redacted_status.sql` and the adapter now store terminal
`redacted` state, clear that tier's badge, and refuse to restore it from later
approval snapshots. A fresh verification creates a new inquiry. Other verified
tiers remain intact. The signed `inquiry.redacted` event also revokes evidence
when its optional attributes have been filtered out.

The correction was checked against the actual Sandbox provider: the synthetic
member inquiry was approved again and redacted through Persona's API. The
current adapter, using a disposable local database bound to only that inquiry,
read the retained approved status plus `redacted-at`, removed the badge and
ignored a subsequent harness-signed approval snapshot. This verifies actual
provider response handling, not deployment of the correction to the old Preview.
The adapter, Case-cleanup and accountless probe tests passed together: **55 tests,
zero failures**. Private evidence is retained under
`.vercel/launch-acceptance/persona/` in the release worktree.
Independent review then passed a broader ninety-test Persona/deletion/operations
suite and one additional real-PostgreSQL Case-worker concurrency test, all
without failures or skips. The latter holds one worker after its lease claim and
proves a concurrent worker makes no provider call, with exactly one final Case
DELETE and a completed monitoring receipt. These provider responses are fixtures;
the PostgreSQL locking and migration checks use a disposable real database.

The failed-inquiry workflow also created synthetic Case
`case_AzLHMsDXuqqJpAgyx1YVotT2fa6mrv` (`KBCA-1`) for member inquiry
`inq_AzLHMsDyqAQ1a9E1e83ppdiGUEW5Ex`, without personal information or uploaded
material. A dashboard reviewer selected **Declined**; the workflow changed the
inquiry and its actual signed event updated the Preview to declined, with no
member badge. The synthetic account was then deleted. Missing credentials left
its inquiry redaction obligation pending, an injected HTTP 503 left a durable
failed job, and a later scoped retry against Persona redacted the inquiry and
cleared that job. A provider read confirmed the redaction. The Case remained
present with its linked inquiry fields marked Redacted. A separate dashboard
**Redact case** action then produced the Case-level redaction banner and timeline
entry; reloading confirmed the Redact action was gone. Inquiry redaction did not
cascade to the Case.

A second failed-inquiry fixture created Case
`case_AzLHMsDTRRbv7ypqfunuCYhKsrdCkR` (`KBCA-2`) for
`inq_AzLHMsDuBDv5Fm1dPmAMJjmfxE34oQ`. The reviewer selected **Approved**; the
workflow approved that exact inquiry and its signed event enabled the member
badge. Account deletion and inquiry erasure passed the same outage/retry checks.
The reviewer separately redacted this Case in the Sandbox dashboard; reloading
confirmed its explicit Case-level redaction banner at 00:37 UTC. Both known
fixture Cases are now manually redacted. A dedicated Case cleanup key has not
been provisioned, so automatic discovery/redaction acceptance remains pending.
The independent obligation remains queued in the isolated Preview database:
manual erasure of one known Case does not verify the worker's full linked-Case
scan or future rescans.

The government-ID hosted fixture reached US driver-license front capture with
camera or another-device choices. No personal image, camera capture or document
was submitted. After **API-simulated** completion, the hosted page displayed its
completion screen; **Done** navigated to the configured Preview `/verified`
return with the inquiry ID. Vercel deployment protection then required login.
This proves hosted launch and the redirect destination with simulated completion;
it does not prove required-check gating, biometric accuracy or final in-app return.
That synthetic account and both inquiries have since been cleaned up.

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
review workflows link Cases only to the Inquiry. Case retention was observed
directly as described above; it is handled by the separate cleanup worker below.
Do not describe an inquiry redaction acknowledgement as proof that all biometric
data, Cases or child resources have been erased.

### Independent Case cleanup

Migration `0036_persona_case_cleanup.sql` adds an outbox without a member foreign
key or member identifier. Account deletion queues an opaque Inquiry reference
before removing its verification rows. The inquiry worker also queues it before
every provider DELETE, including recovered creates. Successful inquiry erasure
never removes the Case obligation.

Configure these **server-only** values independently per environment:

- `PERSONA_CASE_CLEANUP_API_KEY`: a separate key with only the Case read/redact
  permissions needed by GET `/cases`, GET `/cases/:id` and DELETE `/cases/:id`.
  Keep the existing inquiry-only runtime key unchanged.
- `PERSONA_CASE_TEMPLATE_IDS`: comma-separated exact allowed Case-template IDs
  (one to eight). The verified Sandbox template is **KYC: Basic Case**, key
  `KBCA`, ID `ctmpl_AzLHMsDB8gshfcSRVbyVbQG6H3vsQa`. Confirm Production's selected
  template before configuring its allowlist; never use a wildcard.

Production hosted creation, resume and creation recovery fail closed when these
values are absent, use the same key as the inquiry runtime, or disagree with the
runtime key's production environment. Existing callbacks and deletion obligations
remain processable. Configuration passing is not a substitute for provider
permission and template acceptance.

The worker first reads the exact Inquiry using its inquiry-only key. Every Case
API response must have the same `Persona-Organization-Id` and
`Persona-Environment-Id` headers as that response; a shared key prefix alone
cannot establish the same organization or custom Sandbox. It discovers Cases
using the pinned [List Cases inquiry filter and page cursor](https://docs.withpersona.com/2023-01-05/api-reference/cases/list-all-cases),
requests only redaction and relationship fields, and never persists the provider
payload. The pinned schema supplies `inquiries`, `accounts`, `case-template` and
`links.next`; absent relationships or pagination metadata require review.

Before DELETE, a fresh Case read must show exactly one Inquiry matching the queued
reference, an explicit empty Account relationship, and an allowlisted template.
The lease must still belong to this worker. A second read after DELETE must
positively confirm `redacted-at`; a 404 is not evidence of erasure. Unexpected
bindings, environment headers or invalid pages remain `review_required`, and
provider failures retain the obligation with backoff. See Persona's
[individual Case redaction contract](https://docs.withpersona.com/2023-01-05/api-reference/cases/redact-a-case).

The existing ten-minute settlement cron processes at most two Inquiry jobs and
four Cases per invocation, in pages of at most two, within a twenty-second wall
budget and five-second request timeouts. Pagination resumes from an opaque Case
cursor only after that page's redactions are confirmed. A completed scan becomes
eligible again after twenty-four hours to catch delayed workflow-created Cases.
This is a target rescan cadence, not a guaranteed deletion deadline: outages and
backlog extend it. At this budget, at most 288 Inquiry pages can be serviced per
day; operators must increase scheduling capacity before the backlog exceeds it.

Minimal opaque cleanup receipts have **no automatic expiry** until an accepted
provider workflow/retention maximum permits one. They contain only provider refs,
environment, cursors, timestamps and retry/review state, without identity material.
The admin view exposes pending cleanup, review-required jobs and monitoring
rescans overdue by more than a day. Unknown-environment legacy obligations are
explicitly review-required; establish the original environment with provider
evidence before assigning it and requeueing. Never infer it from the current key
or delete an obligation because that key returns 404. Review unexpected ownership
or Account links in the correct provider environment before any manual erasure.

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
- Confirm required-check failure gates and both member/government-ID hosted
  completion paths; finish the protected Preview return in the signed-in app.
  The actual manual Case decisions above passed using synthetic lifecycle inputs.
- Verify the new dedicated-key Case worker against a new disposable synthetic Case,
  including field selection and Case redaction acknowledgement, then configure
  the accepted production permissions and exact template allowlist.
- Confirm child-resource retention with Persona. Unexpected Accounts remain
  explicit manual review obligations; they must not be silently forgotten.
- Assign moderation and appeal ownership before requiring verification.
- Confirm the selected post-trial plan retains the configured event filters,
  decision workflows and Case features. The saved Sandbox configuration does
  not establish production plan entitlement; Persona documents
  [event filters](https://docs.withpersona.com/webhook-event-filters) as an
  Enterprise feature.

No provider acceptance result is implied by the automated tests.

## Post-trial production configuration

The production Dashboard was inspected on 2026-09-22 UTC and showed an
**Essential trial**, with no paid plan selected. Do not infer paid entitlements
from the trial's available controls. The official feature tables currently list
[Conditional steps](https://help.withpersona.com/articles/36BS5SiFg4jDAPSTC6arD7/),
[Create Case](https://help.withpersona.com/articles/3ly3uUwIUTVih1pkT5dfcE/) and
[Redact Object](https://help.withpersona.com/articles/48Fu5XOdmd1y5v1xvbCkn8/)
as available on Essential. These are the basic workflow operations used here;
this does not establish every selected risk signal's entitlement.

The existing provider-side [webhook event
filters](https://docs.withpersona.com/webhook-event-filters) are documented as an
Enterprise feature. They are a delivery-minimization feature; SamePace separately
requires its own exact inquiry, template, owner and environment binding before
any state change. Before selecting a plan, either confirm the filter entitlement
with Persona or validate a production webhook without those filters and with a
minimal attribute payload. Preserve the template and explicit null Account
relationships needed by the receiver. Do not change the accepted Sandbox
configuration merely to assume it will remain available after trial.

The runtime inquiry-only API key deliberately cannot manage Cases. Inquiry
redaction does not independently redact a Case: Persona's redaction guide lists
Cases among objects that redact only themselves. Production therefore also
needs the dedicated Case cleanup key, exact template allowlist, actual worker
acceptance and an accepted retention/rescan policy described above. Do not broaden
the app's runtime key to administrative permissions as a substitute for this setup.

Until hosted and review acceptance, retention ownership and post-trial
entitlements are resolved, keep production workflows inactive and
`VERIFICATION_ENFORCED=false`. Provision production credentials and the
production signing secret together; the sandbox key must never be promoted.
Subscribe the production webhook to `inquiry.redacted` as well as the existing
status events so provider-side erasure proactively revokes a previously approved
badge. Keep template and Account relationship IDs available to the receiver.
