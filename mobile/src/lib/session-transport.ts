export type SessionRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  signal?: AbortSignal;
};

export type ApiSession = {
  request<T>(path: string, init?: SessionRequest): Promise<T>;
  isCurrent(): boolean;
};

/** An async import must never switch accounts midway through uploading a page. */
export function createSessionTransport(deps: {
  token: string;
  version: number;
  currentVersion: () => number;
  send: <T>(token: string, path: string, init: SessionRequest) => Promise<T>;
  stale: () => Error;
}): ApiSession {
  const isCurrent = () => deps.currentVersion() === deps.version;
  return {
    isCurrent,
    async request<T>(path: string, init: SessionRequest = {}): Promise<T> {
      if (!isCurrent() || init.signal?.aborted) throw deps.stale();
      try {
        const result = await deps.send<T>(deps.token, path, init);
        if (!isCurrent() || init.signal?.aborted) throw deps.stale();
        return result;
      } catch (error) {
        if (!isCurrent() || init.signal?.aborted) throw deps.stale();
        throw error;
      }
    },
  };
}
