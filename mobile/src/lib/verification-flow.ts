import type { ApiSession } from "./session-transport";
import type { StartedVerification, VerificationTier } from "./types";

/** The browser may outlive its screen/account; never refresh using a replacement token. */
export async function beginVerification(args: {
  session: ApiSession;
  tier: VerificationTier;
  signal: AbortSignal;
  onStarted: (started: StartedVerification) => void;
  openBrowser: (url: string) => Promise<unknown>;
}) {
  const { session, signal } = args;
  const current = () => session.isCurrent() && !signal.aborted;
  const started = await session.request<StartedVerification>("/verification", {
    method: "POST",
    json: { tier: args.tier },
    signal,
  });
  if (!current()) return;
  args.onStarted(started);
  if (!started.url) return;
  await args.openBrowser(started.url);
  if (!current()) return;
  await session.request(`/verification/${encodeURIComponent(started.id)}/refresh`, {
    method: "POST",
    signal,
  });
}
