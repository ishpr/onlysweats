/** Callers enqueue at the moment an auth change begins, before awaiting other cleanup. */
export function createSerialWrites() {
  let queue: Promise<unknown> = Promise.resolve();
  return (write: () => Promise<void>) => {
    const next = queue.catch(() => undefined).then(write);
    queue = next.catch(() => undefined);
    return next;
  };
}
