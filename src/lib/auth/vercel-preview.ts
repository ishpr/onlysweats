/** Vercel's system URL variables contain hostnames, without a scheme. Only
 * exact deployment-provided names are trusted; never accept a shared wildcard.
 * https://vercel.com/docs/environment-variables/system-environment-variables */
function deploymentHost(value: string | undefined): string | undefined {
  const host = value?.trim().toLowerCase();
  if (!host || host.length > 253) return undefined;
  // DNS names only: no credentials, scheme, path, port, wildcard, IP literal,
  // numeric address shorthand, or local-development hostnames.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))
    return undefined;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return undefined;
  return host;
}

export function vercelPreviewAuth(env: {
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
}): { allowedHosts: string[]; trustedOrigins: string[]; fallback: string | undefined } {
  if (env.VERCEL_ENV !== "preview")
    return { allowedHosts: [], trustedOrigins: [], fallback: undefined };
  const allowedHosts = [...new Set(
    [deploymentHost(env.VERCEL_URL), deploymentHost(env.VERCEL_BRANCH_URL)]
      .filter((host): host is string => Boolean(host)),
  )];
  const trustedOrigins = allowedHosts.map((host) => `https://${host}`);
  // The canonical deployment is first. Its exact branch URL is a safe fallback
  // when only that system variable is available.
  return { allowedHosts, trustedOrigins, fallback: trustedOrigins[0] };
}
