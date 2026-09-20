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
  Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString("base64url");

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function appleRevocationConfigured() {
  return Boolean(
    env("APPLE_TEAM_ID") && env("APPLE_KEY_ID") && env("APPLE_PRIVATE_KEY") && env("APPLE_BUNDLE_ID"),
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
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`apple-token:${secret}`));
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

/**
 * Called just before an account is deleted. Never blocks the deletion: if Apple
 * can't be reached the account still goes, and the failure is logged.
 */
export async function revokeAppleAccess(
  sql: Sql,
  userId: string,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<boolean> {
  const [row] = await sql<{ refresh_token_enc: string }>`
    select refresh_token_enc from apple_tokens where profile_id = ${userId}`;
  if (!row) return false;
  let revoked = false;
  try {
    if (appleRevocationConfigured()) {
      const send = opts.fetch ?? (globalThis.fetch as Fetch);
      const res = await send("https://appleid.apple.com/auth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env("APPLE_BUNDLE_ID")!,
          client_secret: await clientSecret(opts.now ?? Date.now()),
          token: await unseal(row.refresh_token_enc),
          token_type_hint: "refresh_token",
        }).toString(),
      });
      revoked = res.ok;
      if (!res.ok) console.error("[apple] revoke failed", res.status);
    }
  } catch (err) {
    console.error("[apple] revoke failed", err);
  }
  await sql`delete from apple_tokens where profile_id = ${userId}`;
  return revoked;
}
