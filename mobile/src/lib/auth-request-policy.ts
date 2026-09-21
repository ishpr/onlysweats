/**
 * Native sign-in uses identity tokens and sign-out uses our stored bearer token.
 * iOS can otherwise attach cookies from an earlier request without the browser's
 * Origin header, which Better Auth correctly rejects as a possible CSRF request.
 * Keep the server's checks intact and identify the configured API origin. Browsers
 * must continue supplying their own Origin and normal cookie policy.
 */
export function authRequestPolicy(
  apiUrl: string,
  platform: string,
): { headers: Record<string, string>; credentials?: "omit" } {
  if (platform === "web") return { headers: {} };
  return {
    headers: { origin: new URL(apiUrl).origin },
    credentials: "omit",
  };
}
