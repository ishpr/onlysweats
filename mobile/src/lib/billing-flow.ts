import type { ApiSession } from "./session-transport";

/** Checkout completion is only a return signal; signed server state decides payment. */
export async function openHostedBilling(args: {
  session: ApiSession;
  path: string;
  input: { requestId: string; termsHash?: string };
  signal: AbortSignal;
  openBrowser: (url: string) => Promise<unknown>;
}) {
  const result = await args.session.request<{ url: string }>(args.path, {
    method: "POST",
    json: args.input,
    signal: args.signal,
  });
  if (!args.session.isCurrent() || args.signal.aborted) return;
  const url = new URL(result.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
  ) {
    throw new Error("The payment page could not be opened. Please refresh and try again.");
  }
  await args.openBrowser(url.href);
  if (!args.session.isCurrent() || args.signal.aborted) return;
  await args.session.request("/billing/refresh", { method: "POST", json: {}, signal: args.signal });
}
