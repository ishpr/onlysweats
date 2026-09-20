import { createServerFn } from "@tanstack/react-start";
import { siriSystemPrompt, type SiriContext } from "./siri";

export const askSiri = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; ctx: SiriContext }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "unavailable" };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 280,
        temperature: 0.4,
        messages: [
          { role: "system", content: siriSystemPrompt(data.ctx) },
          { role: "user", content: data.prompt.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `xAI ${res.status}` };
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: "empty" };
    return { ok: true as const, text };
  });
