import type { WorkoutRun } from "../../../../shared/workout-plans.ts";
import type { ApiSession, SessionRequest } from "../session-transport.ts";
import { acknowledgeUpload, hasPendingRun, prepareUpload } from "./offline-data.ts";
import type { createOfflineWorkoutStore } from "./offline-store.ts";

type Store = Pick<
  ReturnType<typeof createOfflineWorkoutStore>,
  "list" | "update" | "remember" | "remove" | "generation"
>;
type Session = Pick<ApiSession, "request" | "isCurrent">;

export class OfflineWorkoutRequestError extends Error {
  readonly code: "timeout" | "cancelled" | "session_changed" | "superseded" | "invalid_response";
  constructor(code: OfflineWorkoutRequestError["code"], message: string) {
    super(message);
    this.name = "OfflineWorkoutRequestError";
    this.code = code;
  }
}

/** Real queue orchestration, with injected transport/storage for race and failure tests. */
export function createOfflineWorkoutSync(deps: {
  store: Store;
  mutationId(): string;
  status(error: unknown): number | undefined;
  isRun(value: unknown): value is WorkoutRun;
  requestTimeoutMs?: number;
}) {
  const uploading = new Map<string, { session: Session; promise: Promise<void> }>();
  const reads = new Map<string, number>();
  const keyOf = (ownerId: string, runId: string) => `${ownerId}:${runId}`;
  const nextRead = (key: string) => {
    const next = (reads.get(key) ?? 0) + 1;
    reads.set(key, next);
    return next;
  };
  const assertCurrent = (session: Session) => {
    if (!session.isCurrent())
      throw new OfflineWorkoutRequestError("session_changed", "Your signed-in account changed.");
  };
  const requestData = async <T>(
    session: Session,
    path: string,
    init: SessionRequest = {},
    signal?: AbortSignal,
  ): Promise<T> => {
    assertCurrent(session);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => {
        reject(new OfflineWorkoutRequestError("cancelled", "Workout refresh stopped."));
        controller.abort();
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      timeout = setTimeout(() => {
        reject(
          new OfflineWorkoutRequestError(
            "timeout",
            "The connection timed out. Saved changes are retained and retry with the same request ID.",
          ),
        );
        controller.abort();
      }, deps.requestTimeoutMs ?? 15_000);
    });
    try {
      if (signal?.aborted) return await stopped;
      // Racing the deadline also releases a caller if a transport ignores abort.
      const value = await Promise.race([
        session.request<T>(path, { ...init, signal: controller.signal }),
        stopped,
      ]);
      assertCurrent(session);
      if (signal?.aborted) return await stopped;
      return value;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      controller.abort();
    }
  };
  const request = async (
    session: Session,
    runId: string,
    init: SessionRequest = {},
    signal?: AbortSignal,
  ): Promise<WorkoutRun> => {
    const value = await requestData<unknown>(session, `/fitness/runs/${runId}`, init, signal);
    if (
      !value ||
      typeof value !== "object" ||
      !("run" in value) ||
      !deps.isRun(value.run) ||
      value.run.id !== runId
    )
      throw new OfflineWorkoutRequestError(
        "invalid_response",
        "The saved workout response could not be read. Refresh before continuing.",
      );
    return value.run;
  };

  /** A successful live read is the only operation that restores denied cached reads. */
  const refresh = async (
    ownerId: string,
    runId: string,
    session: Session,
    signal?: AbortSignal,
  ): Promise<WorkoutRun> => {
    assertCurrent(session);
    const key = keyOf(ownerId, runId);
    const generation = deps.store.generation(ownerId, runId);
    const read = nextRead(key);
    let run: WorkoutRun;
    try {
      run = await request(session, runId, {}, signal);
    } catch (error) {
      assertCurrent(session);
      if (deps.store.generation(ownerId, runId) !== generation)
        throw new OfflineWorkoutRequestError(
          "superseded",
          "This saved device copy was removed during the request.",
        );
      const status = deps.status(error);
      if (status === 404 || status === 410) {
        nextRead(key); // An earlier successful response cannot resurrect a deletion.
        await deps.store.remove(ownerId, runId, session.isCurrent);
      } else if (status === 403) {
        nextRead(key); // Earlier reads cannot undo a later access denial.
        await deps.store
          .update(ownerId, runId, session.isCurrent, (entry) => ({
            ...entry,
            readBlocked: true,
            blocked: true,
          }))
          .catch(() => undefined); // There may not be a device copy yet.
      }
      throw error;
    }
    if (reads.get(key) !== read)
      throw new OfflineWorkoutRequestError(
        "superseded",
        "A newer workout check replaced this response.",
      );
    assertCurrent(session);
    await deps.store.remember(ownerId, run, session.isCurrent, generation);
    return run;
  };

  const performSync = async (ownerId: string, runId: string, session: Session, retry: boolean) => {
    assertCurrent(session);
    const generation = deps.store.generation(ownerId, runId);
    const currentRun = () => {
      assertCurrent(session);
      if (deps.store.generation(ownerId, runId) !== generation)
        throw new OfflineWorkoutRequestError(
          "superseded",
          "This saved device copy was removed during sync.",
        );
    };
    if (retry) {
      const entry = (await deps.store.list(ownerId, session.isCurrent)).find(
        (item) => item.base.id === runId,
      );
      if (!entry) return;
      if (entry.readBlocked) await refresh(ownerId, runId, session);
      currentRun();
      await deps.store.update(ownerId, runId, session.isCurrent, (current) => ({
        ...current,
        blocked: false,
      }));
    }
    for (let step = 0; step < 4; step++) {
      currentRun();
      const before = (await deps.store.list(ownerId, session.isCurrent)).find(
        (item) => item.base.id === runId,
      );
      if (
        !before ||
        before.conflict ||
        before.blocked ||
        before.readBlocked ||
        !hasPendingRun(before)
      )
        return;
      const entry = await deps.store.update(ownerId, runId, session.isCurrent, (current) =>
        current.readBlocked ? current : prepareUpload(current, deps.mutationId()),
      );
      const pending = entry.pending;
      if (!pending || entry.readBlocked || entry.blocked || entry.conflict) return;
      currentRun();
      let saved: WorkoutRun;
      try {
        saved = await request(session, runId, {
          method: "PUT",
          json: { ...pending.payload, mutationId: pending.mutationId },
        });
      } catch (error) {
        currentRun();
        const status = deps.status(error);
        if (status === 404 || status === 410) {
          nextRead(keyOf(ownerId, runId));
          await deps.store.remove(ownerId, runId, session.isCurrent);
        } else if (status === 403 || status === 409) {
          await deps.store.update(ownerId, runId, session.isCurrent, (current) =>
            current.pending?.mutationId === pending.mutationId
              ? { ...current, blocked: true }
              : current,
          );
          // Use the same bounded refresh/denial/deletion handling for this nested read.
          const latest = await refresh(ownerId, runId, session);
          currentRun();
          await deps.store.update(ownerId, runId, session.isCurrent, (current) =>
            current.pending?.mutationId === pending.mutationId
              ? { ...current, conflict: latest, blocked: true }
              : current,
          );
        }
        throw error;
      }
      currentRun();
      if (saved.revision !== pending.payload.expectedRevision + 1)
        throw new OfflineWorkoutRequestError(
          "invalid_response",
          "The saved workout revision could not be confirmed. Retry to check the same request.",
        );
      await deps.store.update(ownerId, runId, session.isCurrent, (current) =>
        acknowledgeUpload(current, pending.mutationId, saved),
      );
    }
  };

  return {
    request<T>(session: Session, path: string, init: SessionRequest = {}): Promise<T> {
      return requestData<T>(session, path, init, init.signal);
    },
    refresh,
    sync(ownerId: string, runId: string, session: Session, retry = false): Promise<void> {
      const key = keyOf(ownerId, runId);
      const active = uploading.get(key);
      if (active?.session.isCurrent() && session.isCurrent()) return active.promise;
      const promise = performSync(ownerId, runId, session, retry).finally(() => {
        if (uploading.get(key)?.promise === promise) uploading.delete(key);
      });
      uploading.set(key, { session, promise });
      return promise;
    },
  };
}
