import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled settlement (Vercel Cron → `vercel.json`). Closes out every booking
 * whose check-in window has shut — no-shows, fees, strikes, credits — and rolls
 * standing slots forward, so none of it waits for someone to open the app. The
 * same tick sends session reminders and delivers any push still owed.
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
  const notify = await import("@/lib/pace/notify.server");
  const { closeDueBlocks } = await import("@/lib/pace/training-blocks.server");
  const sql = await getSql();
  const settled = await settleDue(sql);
  // After settlement, so a block's last session is counted before it closes.
  const closed = await closeDueBlocks(sql);
  // Reminders an hour out and when check-in opens, then push whatever is owed and
  // retire device tokens Apple or Google reported dead.
  const reminders = await notify.enqueueReminders(sql);
  const pushed = await notify.deliverDue(sql);
  const retired = await notify.checkReceipts(sql);
  const { retryAppleRevocations } = await import("@/lib/auth/apple-revoke.server");
  const appleRevocations = await retryAppleRevocations(sql);
  const { recoverPersonaCreations, retryPersonaRedactions } =
    await import("@/lib/pace/verification.server");
  const personaCreations = await recoverPersonaCreations(sql);
  const personaRedactions = await retryPersonaRedactions(sql);
  const { sweepCoordination } = await import("@/lib/agents/coordination.server");
  const coordination = await sweepCoordination(sql);
  const { sweepBilling } = await import("@/lib/billing/worker.server");
  const billing = await sweepBilling(sql);
  const { pruneOperations } = await import("@/lib/operations/service.server");
  await pruneOperations(sql);
  const { pruneConversations } = await import("@/lib/conversation/service.server");
  await pruneConversations(sql);
  return Response.json({
    ok: true,
    settled,
    closed,
    reminders,
    pushed,
    retired,
    appleRevocations,
    personaCreations,
    personaRedactions,
    coordination,
    billing,
  });
}

export const Route = createFileRoute("/api/cron/settle")({
  server: { handlers: { GET: handle } },
});
