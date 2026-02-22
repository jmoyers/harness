type PerfAttrs = Record<string, boolean | number | string>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface StartupBackgroundResumeOptions {
  readonly enabled: boolean;
  readonly maxWaitMs: number;
  readonly waitForSettled: () => Promise<void>;
  readonly settledObserved: () => boolean;
  readonly queuePersistedConversationsInBackground: (initialActiveId: string | null) => number;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
  readonly setTimeoutFn?: (handler: () => void, ms: number) => TimeoutHandle;
  readonly clearTimeoutFn?: (handle: TimeoutHandle) => void;
}

export interface StartupBackgroundResumeService {
  run(initialActiveId: string | null): Promise<void>;
}

export function createStartupBackgroundResumeService(
  options: StartupBackgroundResumeOptions,
): StartupBackgroundResumeService {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  async function run(initialActiveId: string | null): Promise<void> {
    const sessionId = initialActiveId ?? 'none';
    options.recordPerfEvent('mux.startup.background-start.wait', {
      sessionId,
      maxWaitMs: options.maxWaitMs,
      enabled: options.enabled ? 1 : 0,
    });
    if (!options.enabled) {
      options.recordPerfEvent('mux.startup.background-start.skipped', {
        sessionId,
        reason: 'disabled',
      });
      return;
    }

    let timedOut = false;
    let timeoutHandle: TimeoutHandle | null = null;
    await Promise.race([
      options.waitForSettled(),
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeoutFn(() => {
          timedOut = true;
          resolve();
        }, options.maxWaitMs);
      }),
    ]);
    if (timeoutHandle !== null) {
      clearTimeoutFn(timeoutHandle);
    }

    options.recordPerfEvent('mux.startup.background-start.begin', {
      sessionId,
      timedOut,
      settledObserved: options.settledObserved(),
    });
    const queued = options.queuePersistedConversationsInBackground(initialActiveId);
    options.recordPerfEvent('mux.startup.background-start.queued', {
      sessionId,
      queued,
    });
  }

  return {
    run,
  };
}
