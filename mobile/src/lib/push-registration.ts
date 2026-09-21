export type PushStatus = "granted" | "denied" | "undetermined" | "unavailable";
export type PushState = {
  status: PushStatus | null;
  registration: "idle" | "registering" | "registered" | "failed";
  error: string | null;
};

const initial: PushState = { status: null, registration: "idle", error: null };

/** One shared registration attempt and result for launch, foreground and retry. */
export function createPushRegistration(device: {
  permission: (request: boolean) => Promise<PushStatus>;
  register: () => Promise<void>;
}) {
  let state = initial;
  let pending: Promise<void> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const update = (next: PushState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync(request = false): Promise<void> {
      if (pending) return pending;
      const current = generation;
      update({ ...state, registration: "registering", error: null });
      pending = (async () => {
        try {
          const status = await device.permission(request);
          if (current !== generation) return;
          update({
            status,
            registration: status === "granted" ? "registering" : "idle",
            error: null,
          });
          if (status !== "granted") return;
          await device.register();
          if (current === generation) update({ status, registration: "registered", error: null });
        } catch (error) {
          if (current === generation) {
            update({
              ...state,
              registration: "failed",
              error:
                error instanceof Error ? error.message : "Couldn’t register this phone. Try again.",
            });
          }
        } finally {
          if (current === generation) pending = null;
        }
      })();
      return pending;
    },
    finishPending: () => pending ?? Promise.resolve(),
    reset() {
      generation += 1;
      pending = null;
      update(initial);
    },
  };
}
