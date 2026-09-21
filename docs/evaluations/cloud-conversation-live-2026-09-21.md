# Funded cloud conversation checks — September 21, 2026

The owner added Vercel AI Gateway credits. SamePace's configured `anthropic/claude-sonnet-5` model then returned the expected synthetic response using linked-project OIDC, `zeroDataRetention: true` and `disallowPromptTraining: true`. The initial probe used 16 input tokens and four output tokens. No virtual model or separate provider key is required; the adapter uses [Gateway's direct provider/model identifier](https://vercel.com/docs/ai-gateway/models-and-providers).

All data below was invented for evaluation. No real member, HealthKit record or production account was used. No purchase was made by the agent. Privacy restrictions were kept throughout, without fallback to a less restrictive route.

## Findings and corrections

The first 50-case run completed every request, but only 42 passed the mechanical tool/argument checks. Replies sometimes confused summarized heart rate with unavailable raw sensor data, offered an exercise-log card for consent changes, or added an unrequested intention to preference drafts. A separate seven-case workout run met its structural expectations but exposed unclear descriptions of review cards, privacy controls and plan saving.

The adapter instructions and tool descriptions now explain that recorded heart-rate summaries require a tool read; preference drafts omit unspecified fields; the three assistant privacy switches are distinct from other app settings; and a plan card opens an editor only when selected. Saving a plan does not record performed activity. Unrecorded sets remain unknown, while recorded actuals and skipped sets retain their status.

| Run                         | Source    | Result                                                                                                                                                                                           |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full conversation rerun     | `7eb5e82` | 50 completed; 49 mechanical passes; zero provider failures/timeouts. The remaining case correctly refused automatic consent but attached an unrelated logging card. Median 4.788 s, p95 6.231 s. |
| Initial workout rerun       | `7eb5e82` | Seven structural passes covering multi-exercise/time drafts, manual permission, targets versus actuals, embedded instructions, history-to-draft and bounded omissions.                           |
| Clarified workout follow-up | `79f55a4` | Seven of seven structural passes, zero provider errors/timeouts. Replies and normalized drafts were inspected against the fixture.                                                               |
| Permission-only regression  | `79f55a4` | Three of three attempts passed with no tool calls and directions to the actual privacy controls.                                                                                                 |

The full rerun retained two text-screening flags: a reply said **not** to push through symptoms, and another quoted a malicious session title while explicitly rejecting its instructions. Inspection found these were textual false positives; they were not removed from the report. Mechanical checks and agent inspection are not a clinical assessment or a general model-quality score. Human member review remains pending.

A final capability-map clarification at `861a6e2` lists the exact switches—Allow cloud chat, Include Apple Health workout summaries, and Include saved plans and manual logs—and limits their purpose to assistant access. Six targeted checks passed, with no provider errors or timeouts: three consent requests, account deletion, A2A approval and a preference-injection request. The consent replies named the actual switches, and deletion/A2A guidance stayed outside chat controls. One preference reply still incorrectly directed discovery settings to chat privacy controls, despite correct draft fields and no permission change. Navigation wording therefore remains a known pilot-quality issue; these checks do not establish uniformly correct navigation advice.

## Actual deployed Preview flow

At `79f55a4`, 17 authenticated HTTP checks passed with three actual model replies and an isolated disposable account:

- Cloud and manual-history consent default off. Enabling cloud alone still withholds manual records and offers no misleading consent card.
- After the separate grant, a plan with three target sets of eight repetitions at 20 kg was distinguished from one actual six-repetition set of unknown load, one skipped set and one unrecorded set.
- Correcting the actual result to seven repetitions cleared derived conversation, rotated the history generation and rejected the old request. A new model reply read seven actual repetitions, not the target of eight.
- Revoking manual-history permission cleared the derived conversation. The synthetic account was deleted and its old session verified invalid.

The earlier provider-disabled backend Preview passed 40 separate HTTP checks. Protected, ignored reports preserve the synthetic responses and exact tool arguments for review; credentials and raw provider errors are excluded. The tracked 50-case harness remains offline unless explicitly invoked with `--run`; `--include-responses` opts into retaining synthetic text and tool arguments.

## Release and remaining acceptance

This release makes cloud chat available through separate member opt-in. Apple Health summaries and manual history remain independently off until chosen. Runtime bounds remain 45 seconds, three model steps, six tools, at most 2,400 output tokens and 50 attempted turns per member per UTC day. These bound usage, not an exact dollar budget.

A representative member pilot must still assess groundedness, omitted/incorrect instructions, navigation guidance, latency, cost, cancellation and actual physical-device flows. The finite synthetic cases do not establish general accuracy, exercise suitability, medical safety or public-launch readiness. Explicit review and deterministic authorization remain required for every saved plan, actual workout and A2A action.
