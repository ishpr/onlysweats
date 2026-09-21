import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { HealthDataType } from "../../../shared/health";
import { syncWorkoutLiveActivity } from "../lib/widgets";
import { visibleWatchSnapshot } from "../lib/health/watch";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as HealthKit from "../../modules/samepace-healthkit";
import type { ApiSession } from "../lib/api";
import { createHealthSyncController } from "../lib/health/controller";
import { getHealthDeviceId } from "../lib/health/device";

type OwnerSession = { ownerId: string | null; session: ApiSession | null };
const HealthSyncContext = createContext<
  (ReturnType<typeof useHealthSyncInternal> & { ownerId: string | null }) | null
>(null);

/** Mount once around the signed-in app so resume/Watch imports work off the settings screen. */
export function HealthSyncBoundary({
  ownerId,
  session,
  children,
}: OwnerSession & { children: ReactNode }) {
  const value = useHealthSyncInternal({ ownerId, session }, true);
  return createElement(HealthSyncContext.Provider, { value: { ...value, ownerId } }, children);
}

/** Settings reuse the boundary's captured session and single sync controller. */
export function useHealthSync(options: OwnerSession) {
  const shared = useContext(HealthSyncContext);
  const match = shared?.ownerId === options.ownerId ? shared : null;
  const local = useHealthSyncInternal(options, !match);
  return match ?? local;
}

function useHealthSyncInternal({ ownerId, session }: OwnerSession, enabled: boolean) {
  const controller = useMemo(
    () =>
      createHealthSyncController({
        ownerId: ownerId ?? "",
        transport: session ?? {
          request: async () => {
            throw new Error("Sign in to use Apple Health sync.");
          },
          isCurrent: () => false,
        },
        native: HealthKit,
        getDeviceId: getHealthDeviceId,
      }),
    [ownerId, session],
  );
  const queryClient = useQueryClient();
  const [watchSnapshot, setWatchSnapshot] = useState<HealthKit.WatchMirrorSnapshot | null>(null);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let running = false;
    let nextAutomaticAt = 0;
    let rerun = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resume = async () => {
      if (!alive || !session?.isCurrent() || AppState.currentState !== "active") return;
      if (running) {
        rerun = true;
        return;
      }
      const remaining = nextAutomaticAt - Date.now();
      if (remaining > 0) {
        clearTimeout(timer);
        timer = setTimeout(() => void resume(), remaining);
        return;
      }
      running = true;
      nextAutomaticAt = Date.now() + 30_000;
      try {
        const revision = await HealthKit.pendingChanges();
        await controller.resumeAutomatic();
        const current = controller.getSnapshot();
        if (alive && session.isCurrent() && current.phase !== "error" && !current.hasMore) {
          await HealthKit.acknowledgeChanges(revision);
        }
        // Continue bounded pages with a break for the UI; errors wait for a new trigger.
        rerun ||=
          current.hasMore &&
          current.connection?.automaticSync === true &&
          current.phase !== "error";
      } catch {
        /* A native notification cannot make account data cross sessions. */
      } finally {
        running = false;
        if (rerun && alive) {
          rerun = false;
          timer = setTimeout(() => void resume(), 1000);
        }
      }
    };
    void controller.refresh().then(() => resume());
    const changes = HealthKit.observeChanges(() => void resume());
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") void resume();
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      changes();
      appState.remove();
      controller.cancel();
      void HealthKit.setObservation([], false).catch(() => undefined);
    };
  }, [controller, enabled, session]);
  useEffect(() => {
    if (enabled && ownerId && session?.isCurrent() && state.phase === "idle") {
      void queryClient.invalidateQueries({ queryKey: ["private-health", ownerId] });
      // Source removals can rotate chat history while this screen stays mounted.
      void queryClient.invalidateQueries({ queryKey: ["private-assistant-chat", ownerId] });
    }
  }, [
    enabled,
    ownerId,
    session,
    queryClient,
    state.phase,
    state.connection?.lastSyncedAt,
    state.connection?.generation,
  ]);
  const observationTypes = state.connection?.types.join(",") ?? "";
  const selectedTypes = useMemo(
    () => (observationTypes ? (observationTypes.split(",") as HealthDataType[]) : []),
    [observationTypes],
  );
  const connectionDeviceId = state.connection?.deviceId;
  const automaticSync = state.connection?.automaticSync === true;
  useEffect(() => {
    if (!enabled || !ownerId || !session?.isCurrent()) return;
    let alive = true;
    let raw: HealthKit.WatchMirrorSnapshot | null = null;
    const update = () => {
      const snapshot =
        session.isCurrent() && alive ? visibleWatchSnapshot(raw, selectedTypes) : null;
      setWatchSnapshot(snapshot);
      syncWorkoutLiveActivity(ownerId, snapshot);
    };
    const remove = HealthKit.observeWatch((snapshot) => {
      raw = snapshot;
      update();
    });
    const tick = setInterval(update, 5000);
    void getHealthDeviceId()
      .then((deviceId) => {
        if (alive && session.isCurrent())
          return HealthKit.setWatchVisible(connectionDeviceId === deviceId);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      remove();
      clearInterval(tick);
      syncWorkoutLiveActivity(ownerId, null);
      void HealthKit.setWatchVisible(false).catch(() => undefined);
    };
  }, [enabled, ownerId, session, selectedTypes, connectionDeviceId]);
  useEffect(() => {
    if (!enabled || !session?.isCurrent()) return;
    let current = true;
    void getHealthDeviceId()
      .then((deviceId) => {
        if (current && session.isCurrent())
          return HealthKit.setObservation(
            selectedTypes,
            automaticSync && connectionDeviceId === deviceId,
          );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled, session, selectedTypes, automaticSync, connectionDeviceId]);
  return {
    ...state,
    watchSnapshot,
    openWatch: HealthKit.openWatch,
    refresh: controller.refresh,
    connect: controller.connect,
    sync: controller.sync,
    disconnect: controller.disconnect,
  };
}
