import { createFileRoute } from "@tanstack/react-router";

/**
 * Persona's webhook: how an identity check came out. Authenticated by its
 * signature alone (`PERSONA_WEBHOOK_SECRET`) — there is no member session here.
 * The signature is over the exact bytes, so the body is read as text, never
 * re-serialised. Without a secret configured every call is refused.
 */
async function handle({ request }: { request: Request }) {
  const rawBody = await request.text();
  const { getSql } = await import("@/lib/db");
  const { handlePersonaWebhook } = await import("@/lib/pace/verification.server");
  const result = await handlePersonaWebhook(
    await getSql(),
    rawBody,
    request.headers.get("persona-signature"),
  );
  return Response.json(
    { ok: result.status === 200, outcome: result.outcome },
    { status: result.status },
  );
}

export const Route = createFileRoute("/api/webhooks/persona")({
  server: { handlers: { POST: handle } },
});
