/**
 * Lets a chat keep owning its message box (its text, its send and stop) while the
 * screen pins that box to the bottom. The chat renders `<ComposerPortal>`; the screen
 * renders `<ComposerDock>`. With no dock on screen the box simply renders in place.
 */
import { useIsFocused, useRoute } from "expo-router";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { createComposerStore } from "./composer-store";

const composers = createComposerStore<ReactNode>();

export function ComposerPortal({ children }: { children: ReactNode }) {
  const { key: route } = useRoute();
  const focused = useIsFocused();
  const [owner] = useState(() => Symbol("composer"));
  const docked = useSyncExternalStore(
    composers.subscribe,
    () => composers.hasDock(route),
    () => false,
  );
  // Background polling must never publish a hidden screen's composer.
  useEffect(() => {
    if (focused && docked) composers.publish(route, owner, children);
  });
  // Only this portal's publication is cleared on blur, detach, or unmount.
  useEffect(
    () => () => composers.release(route, owner),
    [route, owner, focused, docked],
  );
  return !focused || docked ? null : children;
}

/** The box the current chat handed over, or `null`. Registers the caller as the dock. */
export function useDockedComposer(): ReactNode {
  const { key: route } = useRoute();
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    return composers.registerDock(route);
  }, [route, focused]);
  return useSyncExternalStore(
    composers.subscribe,
    () => (focused ? composers.read(route) : null),
    () => null,
  );
}
