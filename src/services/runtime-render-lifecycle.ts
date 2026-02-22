interface ScreenLike {
  clearDirty(): void;
  isDirty(): boolean;
  markDirty(): void;
}

export interface RuntimeRenderLifecycleOptions {
  readonly screen: ScreenLike;
  readonly render: () => void;
  readonly isShuttingDown: () => boolean;
  readonly setShuttingDown: (next: boolean) => void;
  readonly setStop: (next: boolean) => void;
  readonly restoreTerminalState: () => void;
  readonly formatErrorMessage: (error: unknown) => string;
  readonly writeStderr: (text: string) => void;
  readonly exitProcess: (code: number) => void;
  readonly setImmediateFn?: (callback: () => void) => void;
  readonly setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

const FATAL_EXIT_DELAY_MS = 1200;

export interface RuntimeRenderLifecycle {
  hasFatal(): boolean;
  clearRenderScheduled(): void;
  clearRuntimeFatalExitTimer(): void;
  markDirty(): void;
  scheduleRender(): void;
  handleRuntimeFatal(origin: string, error: unknown): void;
}

export function createRuntimeRenderLifecycle(
  options: RuntimeRenderLifecycleOptions,
): RuntimeRenderLifecycle {
  const setImmediateFn = options.setImmediateFn ?? setImmediate;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let renderScheduled = false;
  let runtimeFatal: { origin: string; error: unknown } | null = null;
  let runtimeFatalExitTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRender = (): void => {
    if (options.isShuttingDown() || renderScheduled) {
      return;
    }
    renderScheduled = true;
    setImmediateFn(() => {
      renderScheduled = false;
      try {
        options.render();
        if (options.screen.isDirty()) {
          scheduleRender();
        }
      } catch (error: unknown) {
        handleRuntimeFatal('render', error);
      }
    });
  };

  const handleRuntimeFatal = (origin: string, error: unknown): void => {
    if (runtimeFatal !== null) {
      return;
    }
    runtimeFatal = {
      origin,
      error,
    };
    options.setShuttingDown(true);
    options.setStop(true);
    options.screen.clearDirty();
    options.writeStderr(`[mux] fatal runtime error (${origin}): ${options.formatErrorMessage(error)}\n`);
    options.restoreTerminalState();
    runtimeFatalExitTimer = setTimeoutFn(() => {
      options.writeStderr('[mux] fatal runtime error forced exit\n');
      options.exitProcess(1);
    }, FATAL_EXIT_DELAY_MS);
    runtimeFatalExitTimer.unref?.();
  };

  return {
    hasFatal: (): boolean => runtimeFatal !== null,
    clearRenderScheduled: (): void => {
      renderScheduled = false;
    },
    clearRuntimeFatalExitTimer: (): void => {
      if (runtimeFatalExitTimer === null) {
        return;
      }
      clearTimeoutFn(runtimeFatalExitTimer);
      runtimeFatalExitTimer = null;
    },
    markDirty: (): void => {
      if (options.isShuttingDown()) {
        return;
      }
      options.screen.markDirty();
      scheduleRender();
    },
    scheduleRender,
    handleRuntimeFatal,
  };
}
