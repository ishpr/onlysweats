import { readRecovery, type WorkoutRecovery } from "./recovery-data.ts";

export function createWorkoutRecoveryStore(storage: {
  available: () => Promise<boolean>;
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  const runEpochs = new Map<string, number>();
  const key = (ownerId: string, runId: string) => JSON.stringify([ownerId, runId]);
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(operation);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    save(value: WorkoutRecovery, isCurrent: () => boolean) {
      const captured = epoch;
      const runKey = key(value.ownerId, value.runId);
      const capturedRun = runEpochs.get(runKey) ?? 0;
      const current = () =>
        isCurrent() && captured === epoch && capturedRun === (runEpochs.get(runKey) ?? 0);
      return serialize(async () => {
        if (!current() || !(await storage.available()) || !current()) return false;
        await storage.write(JSON.stringify(value));
        if (!current()) {
          await storage.remove();
          return false;
        }
        return true;
      });
    },
    load(ownerId: string, runId: string, isCurrent: () => boolean) {
      const captured = epoch;
      return serialize(async () => {
        if (!isCurrent() || captured !== epoch || !(await storage.available())) return null;
        const raw = await storage.read();
        if (!raw || raw.length > 16_000 || !isCurrent() || captured !== epoch) return null;
        try {
          return readRecovery(JSON.parse(raw), ownerId, runId);
        } catch {
          return null;
        }
      });
    },
    clear(ownerId?: string, runId?: string) {
      if (ownerId && runId) {
        const runKey = key(ownerId, runId);
        runEpochs.set(runKey, (runEpochs.get(runKey) ?? 0) + 1);
      } else {
        epoch += 1;
        runEpochs.clear();
      }
      return serialize(async () => {
        if (!(await storage.available())) return;
        if (ownerId && runId) {
          const raw = await storage.read();
          if (!raw) return;
          try {
            const value = JSON.parse(raw) as Partial<WorkoutRecovery>;
            if (value.ownerId !== ownerId || value.runId !== runId) return;
          } catch {
            return;
          }
        }
        await storage.remove();
      });
    },
  };
}
