export interface MuxUiStateSnapshot {
  paneWidthPercent: number;
  repositoriesCollapsed: boolean;
  showDebugBar: boolean;
}

interface MuxUiStatePersistenceOptions {
  readonly enabled: boolean;
  readonly initialState: MuxUiStateSnapshot;
  readonly debounceMs: number;
  readonly persistState: (pending: MuxUiStateSnapshot) => MuxUiStateSnapshot;
  readonly applyState: (state: MuxUiStateSnapshot) => void;
  readonly writeStderr: (text: string) => void;
  readonly setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class MuxUiStatePersistence {
  private persistedState: MuxUiStateSnapshot;
  private pendingState: MuxUiStateSnapshot | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly setTimeoutFn: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly options: MuxUiStatePersistenceOptions) {
    this.persistedState = options.initialState;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  queue(nextState: MuxUiStateSnapshot): void {
    if (!this.options.enabled) {
      return;
    }
    this.pendingState = nextState;
    if (this.persistTimer !== null) {
      this.clearTimeoutFn(this.persistTimer);
    }
    this.persistTimer = this.setTimeoutFn(() => {
      this.persistTimer = null;
      this.persistNow();
    }, this.options.debounceMs);
    this.persistTimer.unref?.();
  }

  persistNow(): void {
    if (!this.options.enabled) {
      return;
    }
    if (this.persistTimer !== null) {
      this.clearTimeoutFn(this.persistTimer);
      this.persistTimer = null;
    }
    const pending = this.pendingState;
    if (pending === null) {
      return;
    }
    this.pendingState = null;
    if (this.stateEqual(pending, this.persistedState)) {
      return;
    }
    try {
      const updated = this.options.persistState(pending);
      this.persistedState = updated;
      this.options.applyState(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.writeStderr(`[config] unable to persist mux ui state: ${message}\n`);
    }
  }

  private stateEqual(left: MuxUiStateSnapshot, right: MuxUiStateSnapshot): boolean {
    return (
      left.paneWidthPercent === right.paneWidthPercent &&
      left.repositoriesCollapsed === right.repositoriesCollapsed &&
      left.showDebugBar === right.showDebugBar
    );
  }
}
