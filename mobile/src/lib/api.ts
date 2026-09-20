import { API_URL } from "./config";

/** A rule or auth rejection from the server. `message` is user-facing copy. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setApiToken(next: string | null) {
  token = next;
}

/** Called when the server stops honouring the stored token (expired/revoked). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function send(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can’t reach SamePace. Check your connection.");
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const body = data as { error?: string; message?: string } | null;
    throw new ApiError(res.status, body?.error ?? body?.message ?? "Something went wrong.");
  }
  return data as T;
}

/** Call `/api/v1`. Throws `ApiError`; a 401 also signs the user out. */
export async function api<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH"; json?: unknown } = {},
): Promise<T> {
  const res = await send(`/api/v1${path}`, init);
  if (res.status === 401) onUnauthorized?.();
  return parse<T>(res);
}

type AuthResult = { token: string; user: { id: string; name: string; email: string } };

/** Better Auth email endpoints. The bearer token rides the `set-auth-token` header. */
export async function authRequest(
  path: "/sign-in/email" | "/sign-up/email",
  json: { email: string; password: string; name?: string },
): Promise<AuthResult> {
  const res = await send(`/api/auth${path}`, { method: "POST", json });
  const bearer = res.headers.get("set-auth-token");
  const body = await parse<{ user: AuthResult["user"] }>(res);
  if (!bearer) throw new ApiError(500, "Signed in, but no session came back.");
  return { token: bearer, user: body.user };
}

export type AuthConfig = {
  apple: boolean;
  google: { webClientId: string; iosClientId: string | null } | null;
  /** A development convenience — off in production once a provider is configured. */
  password: boolean;
};

/** Which sign-in methods the server offers. The one endpoint that needs no session. */
export const fetchAuthConfig = async () => parse<AuthConfig>(await send("/api/v1/auth-config"));

/** Hand the server an identity token from Apple or Google; it verifies and signs us in. */
export async function socialSignInRequest(
  provider: "apple" | "google",
  idToken: { token: string; nonce?: string; user?: unknown },
): Promise<AuthResult> {
  const res = await send("/api/auth/sign-in/social", {
    method: "POST",
    json: { provider, idToken },
  });
  const bearer = res.headers.get("set-auth-token");
  const body = await parse<{ user: AuthResult["user"] }>(res);
  if (!bearer) throw new ApiError(500, "Signed in, but no session came back.");
  return { token: bearer, user: body.user };
}

export async function signOutRequest() {
  await send("/api/auth/sign-out", { method: "POST", json: {} }).catch(() => undefined);
}
