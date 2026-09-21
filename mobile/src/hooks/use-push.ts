import { useSyncExternalStore } from "react";

import { enablePush, getPushState, subscribePush, syncPush } from "@/lib/push";

/** Permission and actual delivery registration share a single, honest state. */
export function usePush() {
  const state = useSyncExternalStore(subscribePush, getPushState, getPushState);
  return {
    ...state,
    busy: state.registration === "registering",
    enable: enablePush,
    retry: syncPush,
  };
}
