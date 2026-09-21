/** Only these externally shared destinations can survive authentication. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const INVITE = /^[A-Za-z0-9_-]{4,64}$/;
export const INVALID_INVITE_PATH = "/invite/_";

export function validInviteCode(value: unknown): string | null {
  return typeof value === "string" && INVITE.test(value) ? value : null;
}

export function inviteStage(code: unknown, signedIn: boolean | null) {
  if (!validInviteCode(code)) return "invalid";
  if (signedIn === null) return "loading";
  return signedIn ? "resolve" : "sign-in";
}

/** Canonical local route, with only documented query fields retained. */
export function appLinkTarget(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2048 || /[\\\s]/.test(input)) return null;
  let path: string;
  let query: URLSearchParams;
  try {
    const url = new URL(input, "https://samepace.app");
    if (url.username || url.password || url.port) return null;
    if (url.protocol === "samepace:") {
      path = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
    } else if (url.protocol === "https:" && url.hostname === "samepace.app") {
      path = url.pathname;
    } else return null;
    query = url.searchParams;
  } catch {
    return null;
  }
  const segments = path.split("/");
  if (segments[1] === "invite" && segments.length === 3 && validInviteCode(segments[2])) {
    return `/invite/${segments[2]}`;
  }
  if (
    ["session", "training-block"].includes(segments[1]) &&
    segments.length === 3 &&
    ID.test(segments[2])
  ) {
    const invite = query.getAll("invite");
    return path + (invite.length === 1 && validInviteCode(invite[0]) ? `?invite=${invite[0]}` : "");
  }
  if (path === "/verified") return path;
  if (path === "/billing-return") {
    const ids = query.getAll("session_id");
    return (
      path +
      (ids.length === 1 && /^cs_[A-Za-z0-9_]{1,252}$/.test(ids[0]) ? `?session_id=${ids[0]}` : "")
    );
  }
  return null;
}

/** Expo calls this for both a cold launch and a link received while open. */
export function nativeAppLink(path: string): string {
  const target = appLinkTarget(path);
  if (target?.startsWith("/invite/")) return target;
  if (target) return `/open?target=${encodeURIComponent(target)}`;
  if (/^(?:samepace:|https?:|\/invite(?:\/|$))/.test(path)) {
    return /invite/.test(path) ? INVALID_INVITE_PATH : "/";
  }
  // Expo's development-client and Google sign-in callbacks keep their own handlers.
  return path;
}
