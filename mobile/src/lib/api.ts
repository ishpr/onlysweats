import { API_URL } from "./config";
import { fetch as streamingFetch } from "expo/fetch";
import { Platform } from "react-native";
import { authRequestPolicy } from "./auth-request-policy";
import { createSessionTransport, type ApiSession, type SessionRequest } from "./session-transport";

export type { ApiSession } from "./session-transport";

/** A rule or auth rejection from the server. `message` is user-facing copy. */
export class ApiError extends Error {
  readonly status: number;
  /** Set on the refusals the app acts on, e.g. `verify_member`. */
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let token: string | null = null;
let sessionVersion = 0;
let onUnauthorized: (() => void) | null = null;

export function setApiToken(next: string | null) {
  sessionVersion += 1;
  token = next;
}

/** Called when the server stops honouring the stored token (expired/revoked). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function send(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  requestToken: string | null = token,
) {
  const authPolicy = path.startsWith("/api/auth/")
    ? authRequestPolicy(API_URL, Platform.OS)
    : undefined;
  const headers: Record<string, string> = {
    accept: "application/json",
    ...authPolicy?.headers,
  };
  if (requestToken) headers.authorization = `Bearer ${requestToken}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(authPolicy?.credentials ? { credentials: authPolicy.credentials } : {}),
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, "Can’t reach SamePace. Check your connection.");
  }
  return res;
}

/** Capture once per mounted member view; old requests cannot adopt a new login. */
export function captureApiSession(): ApiSession | null {
  if (!token) return null;
  const version = sessionVersion;
  return createSessionTransport({
    token,
    version,
    currentVersion: () => sessionVersion,
    stale: () => new ApiError(401, "Your session changed. Open this screen again."),
    send: async <T>(savedToken: string, path: string, init: SessionRequest) => {
      const response = await send(`/api/v1${path}`, init, savedToken);
      if (response.status === 401 && version === sessionVersion && !init.signal?.aborted) {
        onUnauthorized?.();
      }
      return parse<T>(response);
    },
    stream: async (savedToken, path, init, onChunk) => {
      const response = await streamingFetch(`${API_URL}/api/v1${path}`, {
        method: init.method ?? "POST",
        headers: {
          accept: "application/x-ndjson",
          "content-type": "application/json",
          authorization: `Bearer ${savedToken}`,
        },
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
        signal: init.signal,
      });
      if (response.status === 401 && version === sessionVersion && !init.signal?.aborted)
        onUnauthorized?.();
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
          code?: string;
        } | null;
        throw new ApiError(
          response.status,
          friendly(response.status, body?.error ?? body?.message),
          body?.code,
        );
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body)
        throw new ApiError(502, "The assistant response could not be read. Try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          onChunk(decoder.decode(next.value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) onChunk(tail);
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  });
}

/** Transport failures need an action a member can take; rule explanations stay intact. */
const PLUMBING = /^(not found|method not allowed|forbidden|unauthorized|body must be json\.?)$/i;
function friendly(status: number, message?: string): string {
  if (!message || PLUMBING.test(message.trim()) || /^[a-zA-Z_.]+: /.test(message)) {
    if (status === 404) return "That isn’t available any more. Pull down to refresh.";
    if (status === 400) return "Something in that didn’t look right. Check it and try again.";
    if (status === 401) return "Sign in again to continue.";
    if (status === 403) return "You do not have access to that right now.";
    return "Something went wrong on our side. Try again in a moment.";
  }
  return message;
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
    const body = data as { error?: string; message?: string; code?: string } | null;
    throw new ApiError(res.status, friendly(res.status, body?.error ?? body?.message), body?.code);
  }
  return data as T;
}

/** Call `/api/v1`. Throws `ApiError`; a 401 also signs the user out. */
export async function api<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; json?: unknown } = {},
): Promise<T> {
  const res = await send(`/api/v1${path}`, init);
  if (res.status === 401) onUnauthorized?.();
  return parse<T>(res);
}

type AuthResult = { token: string; user: { id: string; name: string; email: string } };

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
  const res = await send(
    "/api/auth/sign-in/social",
    { method: "POST", json: { provider, idToken } },
    null,
  );
  const bearer = res.headers.get("set-auth-token");
  const body = await parse<{ user: AuthResult["user"] }>(res);
  if (!bearer) throw new ApiError(500, "Signed in, but no session came back.");
  return { token: bearer, user: body.user };
}

export async function signOutRequest() {
  await send("/api/auth/sign-out", { method: "POST", json: {} }).catch(() => undefined);
}
