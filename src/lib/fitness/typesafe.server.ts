import { z } from "zod";
import type { FitnessChoiceAnswer } from "../../../shared/fitness.ts";
import { EXERCISE_QUESTION_VERSION, FITNESS_MODEL, WORKOUT_QUESTION_VERSION, type FitnessQuestions } from "./questions.ts";

export const TYPESAFE_TIMEOUT_MS = 5000;
const MAX_REQUEST_BYTES = 24_000;
const MAX_RESPONSE_BYTES = 64_000;
const probability = z.number().min(0).max(1);
const responseSchema = z.strictObject({
  model: z.literal(FITNESS_MODEL),
  answers: z.record(z.string(), z.strictObject({ type: z.literal("choice"), choice: z.string().max(100),
    probabilities: z.record(z.string(), probability), confidence: probability })),
  usage: z.strictObject({ input_tokens: z.number().int().min(0).max(1_000_000), output_tokens: z.number().int().min(0).max(1_000_000) }),
});
export type ProviderResult = { model: string; answers: Record<string, FitnessChoiceAnswer>; usage: { inputTokens: number; outputTokens: number }; latencyMs: number };
export type FitnessProvider = (state: object, questions: FitnessQuestions) => Promise<ProviderResult | null>;
export type ProviderMetric = { outcome: "success" | "unavailable"; model: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null };
export function inferenceAvailable(): boolean { return process.env.JEV_ENABLED === "true" && Boolean(process.env.TYPESAFE_API_KEY?.trim()); }
export function validateProviderResponse(input: unknown, questions: FitnessQuestions): Omit<ProviderResult, "latencyMs"> {
  const parsed = responseSchema.parse(input);
  const expectedIds = Object.keys(questions).sort();
  if (JSON.stringify(Object.keys(parsed.answers).sort()) !== JSON.stringify(expectedIds)) throw new Error("Invalid answer set");
  for (const id of expectedIds) {
    const answer = parsed.answers[id];
    const options = Object.keys(questions[id].criteria).sort();
    if (!Object.hasOwn(questions[id].criteria, answer.choice) || JSON.stringify(Object.keys(answer.probabilities).sort()) !== JSON.stringify(options)) throw new Error("Invalid answer options");
    const probabilities = Object.values(answer.probabilities);
    if (Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) > 0.015 || probabilities.some((value) => value > answer.probabilities[answer.choice] + 0.00001)) throw new Error("Invalid answer distribution");
  }
  return { model: parsed.model, answers: parsed.answers, usage: { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens } };
}
async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("Response too large");
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(joined));
}
/** Fixed server-only destination. No body logs, automatic retries, dynamic
 * endpoints, identity fields or SDK debug logging. Failure always falls back. */
export function createTypeSafeProvider(options: {
  apiKey: string; fetch?: typeof fetch; timeoutMs?: number; onMetric?: (metric: ProviderMetric) => void;
}): FitnessProvider {
  return async (state, questions) => {
    const started = performance.now();
    const abort = new AbortController();
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? TYPESAFE_TIMEOUT_MS, TYPESAFE_TIMEOUT_MS));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: ProviderResult | null = null;
    try {
      const body = JSON.stringify({ state, questions, model: FITNESS_MODEL });
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return null;
      const operation = async () => {
        const response = await (options.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
          method: "POST", headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
          body, signal: abort.signal, redirect: "error",
        });
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
        return validateProviderResponse(await boundedResponse(response), questions);
      };
      const deadline = new Promise<null>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve(null); }, timeoutMs); });
      const response = await Promise.race([operation(), deadline]);
      if (response) result = { ...response, latencyMs: Math.round(performance.now() - started) };
      return result;
    } catch { return null; }
    finally {
      if (timer) clearTimeout(timer);
      // This optional sink receives bounded operational metadata only. A sink
      // failure must not break the manual logging path or disclose request data.
      try { options.onMetric?.({ outcome: result ? "success" : "unavailable", model: FITNESS_MODEL,
        latencyMs: Math.round(performance.now() - started), inputTokens: result?.usage.inputTokens ?? null, outputTokens: result?.usage.outputTokens ?? null }); } catch { /* no request/response bodies are logged */ }
    }
  };
}
export const productionProvider: FitnessProvider = (state, questions) => {
  if (!inferenceAvailable()) return Promise.resolve(null);
  const questionVersion = Object.hasOwn(questions, "interpretation") ? WORKOUT_QUESTION_VERSION : EXERCISE_QUESTION_VERSION;
  return createTypeSafeProvider({ apiKey: process.env.TYPESAFE_API_KEY!, onMetric: (metric) => {
    console.info(JSON.stringify({ event: "fitness.inference", questionVersion, ...metric }));
  } })(state, questions);
};
