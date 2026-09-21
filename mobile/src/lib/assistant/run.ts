/** One operation at a time; cancellation, deletion and account changes fence every callback. */
export function createAssistantRun(isCurrent: () => boolean) {
  let active: AbortController | null = null;
  let generation = 0;
  return {
    get busy() {
      return active !== null;
    },
    cancel() {
      generation += 1;
      active?.abort();
      active = null;
    },
    async start<T>(
      operation: (signal: AbortSignal, publish: (value: T) => void) => Promise<void>,
      publish: (value: T) => void,
      failed: (error: unknown) => void,
      settled: () => void,
    ) {
      if (active || !isCurrent()) return false;
      const controller = new AbortController();
      const captured = ++generation;
      active = controller;
      const current = () => captured === generation && !controller.signal.aborted && isCurrent();
      try {
        await operation(controller.signal, (value) => {
          if (current()) publish(value);
        });
      } catch (error) {
        if (current()) failed(error);
      } finally {
        if (active === controller) active = null;
        if (current()) settled();
      }
      return true;
    },
  };
}
