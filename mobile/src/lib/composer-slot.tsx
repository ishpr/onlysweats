/**
 * Lets a chat keep owning its message box (its text, its send and stop) while the
 * screen pins that box to the bottom. The chat renders `<ComposerPortal>`; the screen
 * renders `<ComposerDock>`. With no dock on screen the box simply renders in place.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

let node: ReactNode = null;
let docks = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function ComposerPortal({ children }: { children: ReactNode }) {
  const docked = useSyncExternalStore(
    subscribe,
    () => docks > 0,
    () => false,
  );
  // Every render hands the dock the latest box. Only the dock listens, so this never loops.
  useEffect(() => {
    if (!docked) return;
    node = children;
    emit();
  });
  useEffect(
    () => () => {
      node = null;
      emit();
    },
    [],
  );
  return docked ? null : children;
}

/** The box the current chat handed over, or `null`. Registers the caller as the dock. */
export function useDockedComposer(): ReactNode {
  useEffect(() => {
    docks += 1;
    emit();
    return () => {
      docks -= 1;
      node = null;
      emit();
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => node,
    () => null,
  );
}
