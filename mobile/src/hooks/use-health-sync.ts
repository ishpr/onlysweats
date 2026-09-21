import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as HealthKit from "../../modules/samepace-healthkit";
import type { ApiSession } from "../lib/api";
import { createHealthSyncController } from "../lib/health/controller";
import { getHealthDeviceId } from "../lib/health/device";

/** Pass a memoized captured session, never the mutable global API helper. */
export function useHealthSync({ ownerId, session }: {
  ownerId: string | null;
  session: ApiSession | null;
}) {
  const controller = useMemo(() => createHealthSyncController({
    ownerId: ownerId ?? "",
    transport: session ?? {
      request: async () => { throw new Error("Sign in to use Apple Health sync."); },
      isCurrent: () => false,
    },
    native: HealthKit,
    getDeviceId: getHealthDeviceId,
  }), [ownerId, session]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    void controller.refresh();
    return () => controller.cancel();
  }, [controller]);
  return {
    ...state,
    refresh: controller.refresh,
    connect: controller.connect,
    sync: controller.sync,
    disconnect: controller.disconnect,
  };
}
