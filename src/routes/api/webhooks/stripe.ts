import { createFileRoute } from "@tanstack/react-router";
import { boundedText } from "@/lib/bounded-body.server";

async function handle({ request }: { request: Request }) {
  const raw = await boundedText(request, 262_144);
  if (raw === null) return Response.json({ error: "Request too large" }, { status: 413 });
  const { getSql } = await import("@/lib/db");
  const { handleStripeWebhook } = await import("@/lib/billing/worker.server");
  try {
    const result = await handleStripeWebhook(
      await getSql(),
      raw,
      request.headers.get("stripe-signature"),
    );
    return Response.json({ outcome: result.outcome }, { status: result.status });
  } catch {
    // Ask Stripe to retry; never log its raw body or payment/customer details.
    return Response.json({ error: "Webhook persistence unavailable" }, { status: 503 });
  }
}
export const Route = createFileRoute("/api/webhooks/stripe")({
  server: { handlers: { POST: handle } },
});
