# Local workout-plan authoring smoke evaluation

Date: September 21, 2026. Execution: Apple's on-device Foundation Models on this Mac, using the application's fresh-session plan generator and 30-second coordinator deadline. No member input, health records, API keys, or cloud model requests were used. This is a small development smoke evaluation, not an accuracy or exercise-suitability benchmark.

The reproducible opt-in harness is `mobile/modules/samepace-intelligence/tests/run-plan-evaluation.sh --run OUTPUT.jsonl`. It contains four fixed synthetic requests and writes private results to a new file. Routine native checks do not run model inference.

## Defects found and corrected

An initial bodyweight example represented a plank as zero repetitions with no duration, while its text described a timed hold. Runtime validation rejected the whole draft. The internal model schema now requires a target unit and positive target amount; code emits exactly one repetitions or duration field. Missing and zero-rep placeholders cannot become valid planned sets.

A walking example supplied minute values in a seconds field. The model now selects `repetitions`, `seconds`, or `minutes` and an amount in that unit. Code converts minutes to seconds. Native regression checks exercise a 25-minute target becoming 1,500 seconds and a 20-second hold remaining a duration with no repetitions. The cloud authoring tool uses the same explicit-unit approach.

## Latest observed examples

| Fixed synthetic request                                   | Observed result                                                                                                  | Mac elapsed time |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| Short beginner bodyweight workout                         | Three editable exercises; repetitions and a timed plank had valid typed targets                                  | 4.09 s           |
| Dumbbell workout for two friends                          | Four editable exercises, set targets and movement instructions                                                   | 3.30 s           |
| Easy walk with warm-up and cool-down                      | Minute targets converted correctly, but the warm-up appeared in overall instructions instead of its own exercise | 2.44 s           |
| Knee-injury rehabilitation with medical safety assessment | Declined as `plan_not_applicable`; no plan returned                                                              | 5.12 s           |

These are individual observed samples, not stable latency figures or evidence that all future requests satisfy their constraints. Generation is nondeterministic. The timed example still demonstrates a planning-quality limitation: the structured exercises totaled 25 minutes and the instructions separately added a five-minute warm-up. The editor must remain an explicit review step, and no generated step counts as completed activity. Equipment suitability, movement cues, requested duration, and whether all phases appear in the exercise list still need member review. We did not evaluate injury safety, exercise effectiveness, or personalized suitability.

## Boundaries verified separately

- Strict shared and native draft validators enforce field shapes, positive targets, text limits, 12 exercises, 20 sets per exercise, and 120 sets total.
- Code assigns unique UUIDs and expands suggested set counts. No external load, measurement, actual result, completion time, sharing permission, or saved state is generated.
- A missing or older native build offers manual entry. Local generation has no automatic cloud fallback.
- Cancellation before dispatch returns no draft. Backgrounding, sign-out, and caller cancellation retain the existing native/JavaScript cancellation paths.
- SDK compilation, parser tests, and signed-binary checks are distinct from actual model evaluation and physical iPhone acceptance.

Before broader rollout, evaluate representative member-approved prompts across languages, equipment, timed and repetition-based workouts, contradictory constraints, refusal boundaries, cancellation, and actual physical devices. Record request fulfillment and necessary edits rather than treating typed output as correctness.

References: [Apple guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation), [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one), and [TypeSafe function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling). Jev remains the separate semantic judgment layer; this generative authoring path does not call it.
