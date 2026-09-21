import type { ApiSession } from "./session-transport.ts";

/** Captured-session side effects; UI registration state is managed separately. */
export function createPushDeviceLifecycle(deps: {
  capture(): Pick<ApiSession, "request" | "isCurrent"> | null;
  readToken(): Promise<string | null>;
  writeToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  timeoutMs?: number;
}) {
  let generation = 0;
  let writes: Promise<unknown> = Promise.resolve();
  let cleanup: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<void>>();
  const candidateTokens = new Set<string>();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = writes.catch(() => undefined).then(work);
    writes = result.catch(() => undefined);
    return result;
  };
  const fence = () => {
    generation++;
    candidateTokens.clear();
  };
  return {
    fence,
    register(getToken: () => Promise<string>, platform: "ios" | "android"): Promise<void> {
      const session = deps.capture();
      if (!session) return Promise.reject(new Error("Sign in before enabling notifications."));
      const captured = generation;
      const priorCleanup = cleanup;
      const controller = new AbortController();
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const current = () => !expired && generation === captured && session.isCurrent();
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("Notification registration timed out. Try again when connected."));
          controller.abort();
        }, deps.timeoutMs ?? 5_000);
      });
      const operation = (async () => {
        const token = await getToken();
        if (!current()) return;
        // A newer same-owner registration must follow any old remote deletion.
        await priorCleanup;
        if (!current()) return;
        // Keep a token whose registration may commit even if its response is lost.
        candidateTokens.add(token);
        await session.request("/devices", {
          method: "POST",
          json: { token, platform },
          signal: controller.signal,
        });
        if (!current()) return;
        await serial(async () => {
          if (current()) await deps.writeToken(token);
        });
      })();
      const result = Promise.race([operation, deadline]).finally(() => {
        expired = true;
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
        pending.delete(result);
      });
      pending.add(result);
      return result;
    },
    logout(unregisterDevice: (token: string) => Promise<void>): Promise<void> {
      const registrations = [...pending];
      const candidates = [...candidateTokens];
      fence();
      // Queue now, before auth can accept another member. New token writes follow this clear.
      const storedToken = serial(async () => {
        const token = await deps.readToken().catch(() => null);
        await deps.clearToken().catch(() => undefined);
        return token;
      });
      const previousCleanup = cleanup;
      const result = (async () => {
        await previousCleanup.catch(() => undefined);
        await Promise.allSettled(registrations);
        const saved = await storedToken;
        const tokens = new Set([...candidates, ...(saved ? [saved] : [])]);
        for (const token of tokens) await unregisterDevice(token).catch(() => undefined);
      })();
      cleanup = result.catch(() => undefined);
      return result;
    },
  };
}
