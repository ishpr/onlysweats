import type {
  HealthConnection, HealthDataType, HealthPage, HealthSyncInput,
} from "../../../../shared/health";

export type HealthRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  signal?: AbortSignal;
};
/** A captured session. Implementations must never substitute a later account's token. */
export type HealthTransport = {
  request<T>(path: string, init?: HealthRequest): Promise<T>;
  isCurrent(): boolean;
};
export type HealthNativeReader = {
  isAvailable(): Promise<boolean>;
  requestAuthorization(types: HealthDataType[]): Promise<void>;
  readChanges(input: {
    type: HealthDataType; anchor: string | null; sinceAt: string; limit: number;
  }): Promise<HealthPage>;
};
export type HealthSyncState = {
  phase: "idle" | "loading" | "connecting" | "syncing" | "disconnecting" | "error";
  availability: "unknown" | "available" | "unavailable";
  connection: HealthConnection | null;
  /** HealthKit conceals read permission. This only means its prompt completed. */
  promptCompleted: boolean;
  hasMore: boolean;
  error: string | null;
};
const initialState = (): HealthSyncState => ({
  phase: "idle", availability: "unknown", connection: null,
  promptCompleted: false, hasMore: false, error: null,
});
class Cancelled extends Error {}
class SyncFailure extends Error {}
function status(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error &&
    typeof error.status === "number" ? error.status : undefined;
}
function errorMessage(error: unknown): string {
  if (error instanceof SyncFailure) return error.message;
  switch (status(error)) {
    case 0: return "Can’t reach SamePace. Your next sync will resume from the last saved page.";
    case 401: return "Sign in again to manage your Apple Health connection.";
    case 404: return "Apple Health sync isn’t available for this account yet.";
    case 409: return "Your connection changed. Refresh its status before trying again.";
    case 429: return "Too many sync requests. Try again shortly.";
    default: return "Couldn’t complete Apple Health sync. Try again.";
  }
}

/**
 * Headless, foreground-only sync. Mounting or refreshing never requests permission,
 * creates a connection, or imports records. Only an explicit connect action opts
 * into storing the selected HealthKit records in the member's private account.
 * Cursors live on the server; no health records or anchors are stored locally.
 */
export function createHealthSyncController(deps: {
  ownerId: string;
  transport: HealthTransport;
  native: HealthNativeReader;
  getDeviceId(): Promise<string>;
  maxPages?: number;
  maxConflicts?: number;
}) {
  let state = initialState();
  let epoch = 0;
  let disposed = false;
  type Kind = "loading" | "connecting" | "syncing" | "disconnecting";
  type Job = { kind: Kind; epoch: number; abort: AbortController; promise: Promise<void> };
  let pending: Job | null = null;
  const listeners = new Set<() => void>();
  const maxPages = Math.max(1, Math.min(100, deps.maxPages ?? 20));
  const maxConflicts = Math.max(0, Math.min(10, deps.maxConflicts ?? 3));
  const update = (patch: Partial<HealthSyncState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const current = (version: number) => !disposed && version === epoch && deps.transport.isCurrent();
  const check = (version: number) => { if (!current(version)) throw new Cancelled(); };

  function start(kind: Kind, task: (job: Job) => Promise<void>, abortPrevious = true): Promise<void> {
    if (disposed || !deps.ownerId || !deps.transport.isCurrent()) return Promise.resolve();
    if (abortPrevious) pending?.abort.abort();
    const job: Job = {
      kind, epoch: ++epoch, abort: new AbortController(), promise: Promise.resolve(),
    };
    job.promise = Promise.resolve().then(async () => {
      check(job.epoch);
      await task(job);
      check(job.epoch);
      update({ phase: "idle" });
    }).catch((error: unknown) => {
      if (current(job.epoch) && !(error instanceof Cancelled)) {
        update({ phase: "error", error: errorMessage(error) });
      }
    }).finally(() => {
      if (pending === job) pending = null;
    });
    pending = job;
    update({ phase: kind, error: null });
    return job.promise;
  }
  async function checked<T>(job: Job, promise: Promise<T>): Promise<T> {
    const value = await promise;
    check(job.epoch);
    return value;
  }
  function request<T>(job: Job, path: string, init: HealthRequest = {}): Promise<T> {
    check(job.epoch);
    return checked(job, deps.transport.request<T>(path, { ...init, signal: job.abort.signal }));
  }
  async function available(job: Job): Promise<boolean> {
    const value = await checked(job, deps.native.isAvailable());
    update({ availability: value ? "available" : "unavailable" });
    return value;
  }
  async function fetchConnection(job: Job): Promise<HealthConnection | null> {
    const result = await request<{ connection: HealthConnection | null }>(job, "/health/connection");
    update({ connection: result.connection });
    return result.connection;
  }
  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh(): Promise<void> {
      if (pending) return pending.promise;
      return start("loading", async (job) => {
        await available(job);
        await fetchConnection(job);
      });
    },
    connect(types: HealthDataType[]): Promise<void> {
      const selected = [...new Set(types)];
      if (pending?.kind === "connecting") return pending.promise;
      if (pending?.kind === "disconnecting") {
        return pending.promise.then(() => controller.connect(selected));
      }
      return start("connecting", async (job) => {
        if (!selected.includes("workout")) throw new SyncFailure("Include workouts when choosing data to sync.");
        if (!await available(job)) {
          throw new SyncFailure("Apple Health requires an iPhone build with HealthKit enabled.");
        }
        // Check rollout/session availability before showing a system permission prompt.
        await fetchConnection(job);
        const deviceId = await checked(job, deps.getDeviceId());
        await checked(job, deps.native.requestAuthorization(selected));
        update({ promptCompleted: true });
        const result = await request<{ connection: HealthConnection }>(job, "/health/connection", {
          method: "POST", json: { deviceId, types: selected },
        });
        update({ connection: result.connection, hasMore: false });
      });
    },
    sync(): Promise<void> {
      if (pending) return pending.promise;
      return start("syncing", async (job) => {
        let connection = await fetchConnection(job);
        if (!connection) { update({ hasMore: false }); return; }
        if (!await available(job)) {
          throw new SyncFailure("Apple Health requires an iPhone build with HealthKit enabled.");
        }
        const deviceId = await checked(job, deps.getDeviceId());
        if (connection.deviceId !== deviceId) {
          throw new SyncFailure("This connection belongs to another iPhone. Reconnect to sync from this device.");
        }
        const generation = connection.generation;
        const queue = [...connection.types];
        let conflicts = 0;
        let pages = 0;
        update({ hasMore: false });
        while (queue.length > 0 && pages < maxPages) {
          check(job.epoch);
          const type = queue.shift()!;
          const cursor = connection.cursors[type] ?? { sequence: 0, anchor: null };
          const page = await checked(job, deps.native.readChanges({
            type, anchor: cursor.anchor, sinceAt: connection.sinceAt, limit: 200,
          }));
          // The native page remains transient until the server acknowledges it.
          const input: HealthSyncInput = {
            ...page, type, deviceId, generation, expectedSequence: cursor.sequence,
          };
          try {
            const result = await request<{ connection: HealthConnection }>(job, "/health/sync", {
              method: "POST", json: input,
            });
            if (result.connection.generation !== generation || result.connection.deviceId !== deviceId) {
              throw new SyncFailure("Your connection changed. Refresh its status before trying again.");
            }
            connection = result.connection;
            update({ connection });
            pages += 1;
            if (page.hasMore) queue.push(type);
          } catch (error) {
            check(job.epoch);
            if (status(error) !== 409 || conflicts >= maxConflicts) throw error;
            conflicts += 1;
            const fresh = await fetchConnection(job);
            if (!fresh || fresh.generation !== generation || fresh.deviceId !== deviceId) {
              throw new SyncFailure("Your connection changed. Refresh its status before trying again.");
            }
            connection = fresh;
            queue.unshift(type);
          }
        }
        update({ hasMore: queue.length > 0 });
      });
    },
    disconnect(): Promise<void> {
      if (pending?.kind === "disconnecting") return pending.promise;
      const previous = pending;
      // Supersede immediately so a pending native read cannot upload another page.
      // Let a connect request settle before DELETE: it must not recreate a connection
      // after the deletion. Sync writes are additionally protected by server generation.
      return start("disconnecting", async (job) => {
        if (previous) await checked(job, previous.promise);
        await request<{ ok: true }>(job, "/health/connection", { method: "DELETE" });
        update({ connection: null, promptCompleted: false, hasMore: false });
      }, previous?.kind !== "connecting");
    },
    /** Cancel a mount's work; reusable after React Strict Mode effect cleanup. */
    cancel() {
      epoch += 1;
      pending?.abort.abort();
      pending = null;
      state = initialState();
      for (const listener of listeners) listener();
    },
    dispose() {
      disposed = true;
      controller.cancel();
      listeners.clear();
    },
  };
  return controller;
}
export type HealthSyncController = ReturnType<typeof createHealthSyncController>;
