/** Best-effort cleanup never holds local logout open, even if a transport ignores abort. */
export async function boundedLogoutCleanup(
  operation: (signal: AbortSignal) => Promise<unknown>,
  timeoutMs = 5000,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve();
        }, timeoutMs);
      }),
    ]);
  } catch {
    /* Local credentials are already fenced; remote cleanup is best effort. */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Only these two cleanup capabilities may keep the old bearer after local logout. */
export function createLogoutCleanup(
  savedToken: string | null,
  send: (
    token: string,
    path: string,
    method: "POST" | "DELETE",
    signal: AbortSignal,
  ) => Promise<unknown>,
  timeoutMs = 5000,
) {
  return {
    revokeSession: () =>
      savedToken
        ? boundedLogoutCleanup(
            (signal) => send(savedToken, "/api/auth/sign-out", "POST", signal),
            timeoutMs,
          )
        : Promise.resolve(),
    unregisterDevice: (pushToken: string) =>
      savedToken && pushToken.length > 0 && pushToken.length <= 512
        ? boundedLogoutCleanup(
            (signal) =>
              send(
                savedToken,
                `/api/v1/devices/${encodeURIComponent(pushToken)}`,
                "DELETE",
                signal,
              ),
            timeoutMs,
          )
        : Promise.resolve(),
  };
}

/** Invoke the local fence synchronously. Never await remote services before it. */
export function localFirstLogout(
  local: () => Promise<void>,
  remote: () => Promise<void>,
  timeoutMs = 25_000,
) {
  const localCompletion = local();
  void boundedLogoutCleanup(() => remote(), timeoutMs);
  return localCompletion;
}

/** Let bounded registration/device deletion finish before invalidating its bearer. */
export async function revokeAfterDeviceCleanup(
  deviceCleanup: Promise<void>,
  closeDeviceCleanup: () => void,
  revokeSession: () => Promise<void>,
  timeoutMs = 15_000,
) {
  // Native keychain calls can hang. At the deadline, fence any not-yet-started
  // deletion before revoking; late work must not reuse the invalidated bearer.
  await boundedLogoutCleanup(() => deviceCleanup, timeoutMs);
  closeDeviceCleanup();
  await revokeSession();
}

export async function cleanupSocialSession(
  provider: { revokeAccess(): Promise<unknown>; signOut(): Promise<unknown> },
  revoke: boolean,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return;
  if (revoke) await provider.revokeAccess();
  if (!isCurrent()) return;
  await provider.signOut();
}

/** A timed-out native SDK call must settle before another call can touch its session. */
export function createExclusiveSocialOperation() {
  let busy = false;
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error("Google is finishing an earlier request. Try again in a moment.");
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
}
