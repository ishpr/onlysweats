import type { WorkoutRun } from "../../../../shared/workout-plans.ts";
import { readStoredWorkoutTimer } from "./timer-record.ts";
import {
  hasPendingRun,
  newOfflineRun,
  OFFLINE_CAPACITY,
  OFFLINE_LEASE,
  readOfflineDocument,
  type OfflineDocument,
  type OfflineRun,
} from "./offline-data.ts";

export function createOfflineWorkoutStore(deps: {
  read(): Promise<unknown>;
  write(value: OfflineDocument): Promise<void>;
  remove(): Promise<void>;
  now(): number;
}) {
  let epoch = 0;
  const runEpochs = new Map<string, number>();
  const runKey = (ownerId: string, runId: string) => JSON.stringify([ownerId, runId]);
  const generation = (ownerId: string, runId: string) => runEpochs.get(runKey(ownerId, runId)) ?? 0;
  let binding: Promise<string | null> = Promise.resolve(null);
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const serial = <T>(fn: () => Promise<T>) => {
    const result = queue.catch(() => undefined).then(fn);
    queue = result.catch(() => undefined);
    return result;
  };
  const persist = async (doc: OfflineDocument) => {
    const verified = readOfflineDocument(doc, doc.binding, deps.now());
    if (!verified)
      throw new Error(
        "These workout fields could not be safely stored. Check your entries and retry.",
      );
    await deps.write(verified);
    return verified;
  };
  const access = <T>(
    current: () => boolean,
    fn: (doc: OfflineDocument | null, key: string) => Promise<T>,
  ) => {
    const captured = epoch;
    const keyPromise = binding;
    return serial(async () => {
      const assert = () => {
        if (!current() || captured !== epoch) throw new Error("Your signed-in account changed.");
      };
      assert();
      const key = await keyPromise;
      assert();
      if (!key) throw new Error("Sign in to use saved workouts.");
      const raw = await deps.read();
      assert();
      const doc = readOfflineDocument(raw, key, deps.now());
      if (
        doc &&
        typeof raw === "object" &&
        raw &&
        "runs" in raw &&
        Array.isArray(raw.runs) &&
        raw.runs.length !== doc.runs.length
      ) {
        await persist(doc);
        assert();
      }
      const result = await fn(doc, key);
      if (!current() || captured !== epoch) {
        await deps.remove();
        throw new Error("Your signed-in account changed.");
      }
      return result;
    });
  };
  return {
    generation,
    /** Binding changes fence writes synchronously, even before keychain IO completes. */
    bind(next: Promise<string | null>) {
      epoch++;
      binding = next;
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    purge() {
      epoch++;
      return serial(async () => {
        await deps.remove();
        notify();
      });
    },
    clear() {
      epoch++;
      binding = Promise.resolve(null);
      return serial(async () => {
        await deps.remove();
        notify();
      });
    },
    owner(current: () => boolean) {
      return access(current, async (doc) =>
        doc && doc.verifiedAt + OFFLINE_LEASE > deps.now() ? doc.ownerId : null,
      );
    },
    verifyOwner(ownerId: string, current: () => boolean) {
      return access(current, async (doc, key) => {
        await persist({
          schema: 1,
          binding: key,
          ownerId,
          verifiedAt: deps.now(),
          runs: doc?.ownerId === ownerId ? doc.runs : [],
        });
        notify();
      });
    },
    list(ownerId: string, current: () => boolean) {
      return access(current, async (doc) =>
        doc?.ownerId === ownerId && doc.verifiedAt + OFFLINE_LEASE > deps.now() ? doc.runs : [],
      );
    },
    remember(
      ownerId: string,
      run: WorkoutRun,
      current: () => boolean,
      expectedGeneration = generation(ownerId, run.id),
    ) {
      return access(current, async (doc) => {
        if (generation(ownerId, run.id) !== expectedGeneration)
          throw new Error("This device copy was removed while the request was running.");
        if (!doc || doc.ownerId !== ownerId)
          throw new Error("Verify your account online before saving a workout on this device.");
        const existing = doc.runs.find((entry) => entry.base.id === run.id);
        // A lost response must retry its exact mutation ID before any revision comparison.
        let entry = existing;
        if (!entry) {
          if (doc.runs.length >= OFFLINE_CAPACITY) {
            const clean = doc.runs
              .filter((item) => !hasPendingRun(item) && !item.active && !item.timer)
              .sort((a, b) => a.updatedAt - b.updatedAt)[0];
            if (!clean)
              throw new Error(
                "Ten workouts have saved edits or timers. Sync or discard one before saving another for offline use.",
              );
            doc.runs = doc.runs.filter((item) => item !== clean);
          }
          entry = newOfflineRun(run, deps.now());
        } else if (!hasPendingRun(entry) && !entry.active && run.revision >= entry.base.revision) {
          entry = {
            ...newOfflineRun(run, deps.now()),
            timer: readStoredWorkoutTimer(entry.timer, run, null),
          };
        } else if (!entry.pending && run.revision > entry.base.revision) {
          entry = { ...entry, conflict: run };
        }
        entry = { ...entry, readBlocked: false };
        doc.runs = [...doc.runs.filter((item) => item.base.id !== run.id), entry];
        const saved = await persist(doc);
        notify();
        return saved.runs.find((item) => item.base.id === run.id)!;
      });
    },
    update(
      ownerId: string,
      runId: string,
      current: () => boolean,
      change: (entry: OfflineRun) => OfflineRun,
    ) {
      return access(current, async (doc) => {
        if (!doc || doc.ownerId !== ownerId || doc.verifiedAt + OFFLINE_LEASE <= deps.now())
          throw new Error("Connect to verify your account before continuing this workout.");
        const old = doc.runs.find((entry) => entry.base.id === runId);
        if (!old)
          throw new Error("This workout is no longer saved on this device. Open it online again.");
        const entry = { ...change(old), updatedAt: deps.now() };
        doc.runs = doc.runs.map((item) => (item === old ? entry : item));
        const saved = await persist(doc);
        notify();
        return saved.runs.find((item) => item.base.id === runId)!;
      });
    },
    remove(ownerId: string, runId: string, current: () => boolean) {
      runEpochs.set(runKey(ownerId, runId), generation(ownerId, runId) + 1);
      return access(current, async (doc) => {
        if (doc?.ownerId !== ownerId) return;
        doc.runs = doc.runs.filter((item) => item.base.id !== runId);
        await persist(doc);
        notify();
      });
    },
  };
}
