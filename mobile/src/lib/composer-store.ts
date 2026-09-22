/** Each route owns its dock; releasing an old portal cannot erase a newer one. */
export function createComposerStore<T>() {
  const routes = new Map<
    string,
    { docks: Set<symbol>; portal?: { owner: symbol; node: T } }
  >();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hasDock(route: string) {
      return (routes.get(route)?.docks.size ?? 0) > 0;
    },
    read(route: string): T | null {
      return routes.get(route)?.portal?.node ?? null;
    },
    registerDock(route: string) {
      const owner = Symbol("dock");
      const entry = routes.get(route) ?? { docks: new Set<symbol>() };
      entry.docks.add(owner);
      routes.set(route, entry);
      emit();
      return () => {
        const current = routes.get(route);
        if (!current?.docks.delete(owner)) return;
        if (current.docks.size === 0) routes.delete(route);
        emit();
      };
    },
    publish(route: string, owner: symbol, node: T) {
      const entry = routes.get(route);
      if (!entry || entry.docks.size === 0) return;
      if (entry.portal?.owner === owner && entry.portal.node === node) return;
      entry.portal = { owner, node };
      emit();
    },
    release(route: string, owner: symbol) {
      const entry = routes.get(route);
      if (entry?.portal?.owner !== owner) return;
      delete entry.portal;
      emit();
    },
  };
}
