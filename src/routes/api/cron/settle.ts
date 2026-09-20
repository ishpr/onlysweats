import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled settlement (Vercel Cron → `vercel.json`). Closes out every booking
 * whose check-in window has shut — no-shows, fees, strikes, credits — and rolls
 * standing slots forward, so none of it waits for someone to open the app.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that env var is set.
 * Without the secret configured this endpoint refuses everyone (fail closed).
 */
async function handle({ request }: { request: Request }) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { getSql } = await import("@/lib/db");
  const { settleDue } = await import("@/lib/pace/service.server");
  const settled = await settleDue(await getSql());
  return Response.json({ ok: true, settled });
}

export const Route = createFileRoute("/api/cron/settle")({
  server: { handlers: { GET: handle } },
});
