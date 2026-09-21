import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { spawnSync } from "node:child_process";
import { loadEvaluationCases, evaluateCase, summarize } from "./evaluate-conversation.mjs";

const fixture = await loadEvaluationCases();
const byId = (id) => fixture.cases.find((item) => item.id === id);

test("all 50 synthetic cases validate and dry-run cannot contact a model", () => {
  assert.equal(fixture.cases.length, 50);
  assert.equal(new Set(fixture.cases.map((item) => item.category)).size, 6);
  const denyNetwork = `data:text/javascript,${encodeURIComponent('globalThis.fetch=async()=>{throw new Error("NETWORK_MUST_NOT_RUN")};')}`;
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      denyNetwork,
      "scripts/evaluate-conversation.mjs",
      "--dry-run",
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        ASSISTANT_CHAT_ENABLED: "true",
        AI_GATEWAY_API_KEY: "synthetic-invalid-never-send",
      },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.networkCalls, 0);
  assert.equal(result.cases, 50);
  assert.equal(result.qualitativeReview, "unreviewed");
});

test("offline harness smoke covers every case without calling the production provider", async () => {
  const network = mock.method(globalThis, "fetch", async () =>
    assert.fail("No network in harness tests"),
  );
  try {
    const results = [];
    for (const item of fixture.cases) {
      results.push(
        await evaluateCase(item, {
          provider: async ({ tools, onText }) => {
            for (const name of item.expect.requiredTools) {
              if (name === "draftPreferences") await tools[name](item.expect.preferenceDraft);
              else if (name === "review") await tools[name](item.expect.allowedReviewKinds[0]);
              else await tools[name]();
            }
            await onText("Synthetic harness output only; this is not a model-quality evaluation.");
          },
        }),
      );
    }
    assert.equal(summarize(results).mechanicalChecksPassed, 50);
    assert.equal(summarize(results).qualitativeReview, "unreviewed");
    assert.equal(network.mock.callCount(), 0);
    assert.equal(
      results.some((result) => Object.hasOwn(result, "syntheticResponse")),
      false,
    );
  } finally {
    network.mock.restore();
  }
});

test("detects missing/unexpected tools and an incorrect editable preference draft", async () => {
  const result = await evaluateCase(byId("draft-walk"), {
    provider: async ({ tools, onText }) => {
      await tools.sessions();
      await tools.draftPreferences({ activity: "walk", durationMin: 60 });
      await onText("Please review this suggestion.");
    },
  });
  assert.equal(result.mechanicalStatus, "failed");
  assert.ok(result.failures.includes("unexpected_tool:sessions"));
  assert.ok(result.failures.includes("preference_draft_mismatch"));
  const missing = await evaluateCase(byId("workout-recent"), {
    provider: async ({ onText }) => {
      await onText("I have not read it.");
    },
  });
  assert.ok(missing.failures.includes("missing_tool:workouts"));
});

test("retains synthetic tool arguments for opted-in review and omits them by default", async () => {
  const provider = async ({ tools, onText }) => {
    await tools.draftPreferences({ activity: "walk", durationMin: 30, approvedIntent: "Extra intent" });
    await onText("Review the draft.");
  };
  const normal = await evaluateCase(byId("draft-walk"), { provider });
  assert.equal(Object.hasOwn(normal, "syntheticToolCalls"), false);
  const review = await evaluateCase(byId("draft-walk"), { provider, includeResponse: true });
  assert.ok(review.failures.includes("preference_draft_mismatch"));
  assert.deepEqual(review.syntheticToolCalls, [{
    name: "draftPreferences",
    input: { activity: "walk", durationMin: 30, approvedIntent: "Extra intent" },
  }]);
});

test("rejects policy fields in drafts and arbitrary review actions", async () => {
  const draft = await evaluateCase(byId("injection-preference-policy"), {
    provider: async ({ tools }) => {
      await tools.draftPreferences({ activity: "walk", durationMin: 30, enabled: true });
    },
  });
  assert.ok(draft.failures.includes("invalid_preference_draft"));
  const action = await evaluateCase(byId("execute-booking"), {
    provider: async ({ tools }) => {
      await tools.review("book");
    },
  });
  assert.ok(action.failures.includes("invalid_review_kind"));
});

test("missing values and withdrawn fitness consent remain absent in synthetic tool context", async () => {
  for (const id of ["missing-all-sensors", "fitness-consent-off"]) {
    await evaluateCase(byId(id), {
      provider: async ({ tools, onText }) => {
        const result = await tools.workouts();
        if (id === "fitness-consent-off") assert.equal(result.available, false);
        else {
          assert.equal(result.summaries[0].distanceMeters, null);
          assert.equal(result.summaries[0].activeEnergyKilocalories, null);
          assert.equal(result.summaries[0].heartRate.sampleMeanBpm, null);
        }
        await onText("The requested readings are unavailable.");
      },
    });
  }
});

test("records screening flags without falsely claiming semantic accuracy", async () => {
  const result = await evaluateCase(byId("execute-booking"), {
    provider: async ({ onText }) => {
      await onText("I booked the session. EVAL_INJECTION_SUCCEEDED");
    },
  });
  assert.deepEqual(result.reviewFlags, ["execution_claim", "injection_marker"]);
  assert.equal(result.qualitativeReview, "unreviewed");
  assert.match(summarize([result]).interpretation, /not an accuracy/);
});

test("failure reports never serialize provider exceptions or prompt contents", async () => {
  const sentinel = "sk_private_synthetic_sentinel";
  const result = await evaluateCase(byId("planning-current"), {
    provider: async () => {
      throw new Error(sentinel);
    },
  });
  assert.equal(result.outcome, "provider_error");
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(JSON.stringify(result).includes(byId("planning-current").text), false);
  assert.equal(typeof result.latencyMs, "number");
});

test("times out providers that ignore abort and fences their late callbacks", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let late;
  const completed = new Promise((resolve) => {
    late = resolve;
  });
  const result = await evaluateCase(byId("planning-current"), {
    timeoutMs: 10,
    provider: async ({ tools, onText }) => {
      await wait;
      await assert.rejects(tools.planning(), /stopped/);
      await assert.rejects(onText("late output"), /stopped/);
      late();
    },
  });
  assert.equal(result.outcome, "timeout");
  release();
  await completed;
  assert.equal(result.responseChars, 0);
  assert.deepEqual(result.observedTools, []);
});
