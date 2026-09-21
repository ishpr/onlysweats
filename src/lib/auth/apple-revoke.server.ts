/**
 * Revoking Sign in with Apple on account deletion (server-only).
 *
 * Apple requires an app that offers account deletion to also revoke the tokens
 * it holds for that person. Signing in with an identity token never gives us
 * one, so right after sign-in the app sends Apple's one-time authorization code;
 * we trade it for a refresh token, keep that encrypted, and revoke it on delete.
 *
 * This needs a "Sign in with Apple" key from the Apple Developer account:
 *
 *   APPLE_TEAM_ID       10-character team id
 *   APPLE_KEY_ID        the key's id
 *   APPLE_PRIVATE_KEY   the .p8 contents (PEM; literal "\n" is accepted)
 *   APPLE_BUNDLE_ID     already set for sign-in
 *
 * Without them everything here is a no-op and sign-in is unaffected.
 */
import type { Sql } from "../db.ts";

const env = (key: string): string | undefined => process.env[key]?.trim() || undefined;
const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString(
    "base64url",
  );

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function appleRevocationConfigured() {
  return Boolean(
    env("APPLE_TEAM_ID") &&
    env("APPLE_KEY_ID") &&
    env("APPLE_PRIVATE_KEY") &&
    env("APPLE_BUNDLE_ID"),
  );
}

/** Apple's "client secret" is a short-lived ES256 JWT signed with the .p8 key. */
async function clientSecret(now: number): Promise<string> {
  const pem = env("APPLE_PRIVATE_KEY")!.replace(/\\n/g, "\n");
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: env("APPLE_KEY_ID") }));
  const body = b64url(
    JSON.stringify({
      iss: env("APPLE_TEAM_ID"),
      iat,
      exp: iat + 300,
      aud: "https://appleid.apple.com",
      sub: env("APPLE_BUNDLE_ID"),
    }),
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

// The refresh token is sealed with a key derived from the auth secret.
async function sealKey() {
  const secret = env("BETTER_AUTH_SECRET");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to store Apple tokens.");
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`apple-token:${secret}`),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await sealKey(),
    new TextEncoder().encode(plain),
  );
  return `${b64url(iv)}.${b64url(new Uint8Array(data))}`;
}

export async function unseal(sealed: string): Promise<string> {
  const [iv, data] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await sealKey(), data);
  return new TextDecoder().decode(plain);
}

/** Trade the one-time authorization code for a refresh token, and keep it sealed. */
export async function storeAppleAuthorization(
  sql: Sql,
  userId: string,
  code: string,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<boolean> {
  if (!appleRevocationConfigured()) return false;
  const send = opts.fetch ?? (globalThis.fetch as Fetch);
  const res = await send("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("APPLE_BUNDLE_ID")!,
      client_secret: await clientSecret(opts.now ?? Date.now()),
      code,
      grant_type: "authorization_code",
    }).toString(),
  });
  const data = (await res.json().catch(() => null)) as { refresh_token?: string } | null;
  if (!res.ok || !data?.refresh_token) {
    console.error("[apple] code exchange failed", res.status);
    return false;
  }
  await sql`
    insert into apple_tokens (profile_id, refresh_token_enc)
    values (${userId}, ${await seal(data.refresh_token)})
    on conflict (profile_id) do update set
      refresh_token_enc = excluded.refresh_token_enc, created_at = now()`;
  return true;
}

const MAX_REVOCATION_ATTEMPTS = 8;
const REVOCATION_LIFETIME = 7 * 24 * 60 * 60_000;
const at = (n: number) => new Date(n).toISOString();
const revocationDelay = (attempt: number) =>
  Math.min(6 * 60 * 60_000, 5 * 60_000 * 2 ** (attempt - 1));

/**
 * Durably transfer the sealed token before deleting its account-owned row. A
 * provider outage does not block account deletion; a database failure does,
 * because losing the only revocable credential would be irreversible.
 */
export async function revokeAppleAccess(
  sql: Sql,
  userId: string,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const jobId = await sql.transaction(async (tx) => {
    const [row] = await tx<{ refresh_token_enc: string }>`
      select refresh_token_enc from apple_tokens where profile_id = ${userId} for update`;
    if (!row) return null;
    const [job] = await tx<{ id: string }>`
      insert into apple_revocation_jobs (id, refresh_token_enc, next_attempt_at, expires_at, created_at)
      values (${`arj_${crypto.randomUUID()}`}, ${row.refresh_token_enc}, ${at(now)},
        ${at(now + REVOCATION_LIFETIME)}, ${at(now)})
      on conflict (refresh_token_enc) do update set refresh_token_enc = excluded.refresh_token_enc
      returning id`;
    await tx`delete from apple_tokens where profile_id = ${userId}`;
    return job.id;
  });
  if (!jobId) return false;
  const result = await retryAppleRevocations(sql, { ...opts, now, jobId });
  return result.revoked > 0;
}

/** Cron drains a bounded queue. No user identity or plaintext token is retained. */
export async function retryAppleRevocations(
  sql: Sql,
  opts: { fetch?: Fetch; now?: number; jobId?: string } = {},
): Promise<{ revoked: number; pending: number; exhausted: number }> {
  const now = opts.now ?? Date.now();
  const send = opts.fetch ?? (globalThis.fetch as Fetch);
  const expired = await sql`
    update apple_revocation_jobs set state = 'failed', refresh_token_enc = null,
      lease_until = null, completed_at = ${at(now)}, last_error = 'RetryWindowExpired'
    where state in ('pending', 'processing') and expires_at <= ${at(now)} returning id`;
  const exhausted = await sql`
    update apple_revocation_jobs set state = 'failed', refresh_token_enc = null,
      lease_until = null, completed_at = ${at(now)}, last_error = 'AttemptsExhausted'
    where state = 'processing' and lease_until <= ${at(now)}
      and attempts >= ${MAX_REVOCATION_ATTEMPTS} returning id`;
  const result = { revoked: 0, pending: 0, exhausted: expired.length + exhausted.length };
  // Missing credentials may be restored during the bounded retention window.
  if (!appleRevocationConfigured()) return result;
  const jobs = await sql<{ id: string; refresh_token_enc: string; attempts: number }>`
    update apple_revocation_jobs set state = 'processing', attempts = attempts + 1,
      lease_until = ${at(now + 5 * 60_000)}
    where id in (
      select id from apple_revocation_jobs where
        ((state = 'pending' and next_attempt_at <= ${at(now)})
          or (state = 'processing' and lease_until <= ${at(now)}))
        and attempts < ${MAX_REVOCATION_ATTEMPTS} and expires_at > ${at(now)}
        and (${opts.jobId ?? null}::text is null or id = ${opts.jobId ?? null})
      order by next_attempt_at limit 10 for update skip locked)
    returning id, refresh_token_enc, attempts`;
  for (const job of jobs) {
    let revoked = false;
    let error = "NetworkOrCredentialsError";
    try {
      const res = await send("https://appleid.apple.com/auth/revoke", {
        method: "POST",
        signal: AbortSignal.timeout(5_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env("APPLE_BUNDLE_ID")!,
          client_secret: await clientSecret(now),
          token: await unseal(job.refresh_token_enc),
          token_type_hint: "refresh_token",
        }).toString(),
      });
      revoked = res.ok;
      error = `HTTP${res.status}`;
    } catch {
      // Credentials and provider response bodies never enter logs/job metadata.
    }
    const finished = revoked || job.attempts >= MAX_REVOCATION_ATTEMPTS;
    await sql`
      update apple_revocation_jobs set state = ${revoked ? "succeeded" : finished ? "failed" : "pending"},
        refresh_token_enc = ${finished ? null : job.refresh_token_enc}, lease_until = null,
        next_attempt_at = ${at(now + revocationDelay(job.attempts))},
        completed_at = ${finished ? at(now) : null}, last_error = ${revoked ? null : error}
      where id = ${job.id} and state = 'processing' and attempts = ${job.attempts}`;
    if (revoked) result.revoked += 1;
    else if (finished) result.exhausted += 1;
    else result.pending += 1;
  }
  return result;
}
