type StartupSettleGate = 'header' | 'nonempty';

type StartupSequencerPhase =
  | 'inactive'
  | 'waiting-for-output'
  | 'waiting-for-paint'
  | 'waiting-for-header'
  | 'settling'
  | 'settled';

interface StartupSequencerOptions {
  readonly quietMs: number;
  readonly nonemptyFallbackMs: number;
  readonly nowMs?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface StartupSequencerSnapshot {
  readonly targetSessionId: string | null;
  readonly phase: StartupSequencerPhase;
  readonly firstOutputObserved: boolean;
  readonly firstOutputAtMs: number | null;
  readonly firstPaintObserved: boolean;
  readonly headerObserved: boolean;
  readonly settleGate: StartupSettleGate | null;
  readonly settledObserved: boolean;
  readonly settledSignaled: boolean;
}

interface StartupSettledEvent {
  readonly sessionId: string;
  readonly gate: StartupSettleGate;
  readonly quietMs: number;
}

function defaultSetTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(callback, delayMs);
}

function defaultClearTimer(handle: ReturnType<typeof setTimeout>): void {
  clearTimeout(handle);
}

export class StartupSequencer {
  private readonly quietMs: number;
  private readonly nonemptyFallbackMs: number;
  private readonly nowMs: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  private targetSessionId: string | null = null;
  private phase: StartupSequencerPhase = 'inactive';
  private firstOutputObserved = false;
  private firstOutputAtMs: number | null = null;
  private firstPaintObserved = false;
  private headerObserved = false;
  private settleGate: StartupSettleGate | null = null;
  private settledObserved = false;
  private settledSignaled = false;
  private settledTimer: ReturnType<typeof setTimeout> | null = null;
  private settledWait: Promise<void>;
  private resolveSettledWait: (() => void) | null = null;

  constructor(options: StartupSequencerOptions) {
    this.quietMs = Math.max(0, Math.floor(options.quietMs));
    this.nonemptyFallbackMs = Math.max(0, Math.floor(options.nonemptyFallbackMs));
    this.nowMs = options.nowMs ?? Date.now;
    this.setTimer = options.setTimer ?? defaultSetTimer;
    this.clearTimer = options.clearTimer ?? defaultClearTimer;
    this.settledWait = this.createSettledWait();
  }

  waitForSettled(): Promise<void> {
    return this.settledWait;
  }

  setTargetSession(sessionId: string | null): void {
    this.clearSettledTimer();
    this.targetSessionId = sessionId;
    this.phase = sessionId === null ? 'inactive' : 'waiting-for-output';
    this.firstOutputObserved = false;
    this.firstOutputAtMs = null;
    this.firstPaintObserved = false;
    this.headerObserved = false;
    this.settleGate = null;
    this.settledObserved = false;
    this.settledSignaled = false;
    this.settledWait = this.createSettledWait();
  }

  snapshot(): StartupSequencerSnapshot {
    return {
      targetSessionId: this.targetSessionId,
      phase: this.phase,
      firstOutputObserved: this.firstOutputObserved,
      firstOutputAtMs: this.firstOutputAtMs,
      firstPaintObserved: this.firstPaintObserved,
      headerObserved: this.headerObserved,
      settleGate: this.settleGate,
      settledObserved: this.settledObserved,
      settledSignaled: this.settledSignaled
    };
  }

  markFirstOutput(sessionId: string): boolean {
    if (!this.hasTargetSession(sessionId) || this.firstOutputObserved) {
      return false;
    }
    this.firstOutputObserved = true;
    this.firstOutputAtMs = this.nowMs();
    if (!this.settledObserved) {
      this.phase = 'waiting-for-paint';
    }
    return true;
  }

  markFirstPaintVisible(sessionId: string, glyphCells: number): boolean {
    if (
      !this.hasTargetSession(sessionId) ||
      this.firstPaintObserved ||
      !this.firstOutputObserved ||
      glyphCells <= 0
    ) {
      return false;
    }
    this.firstPaintObserved = true;
    if (!this.settledObserved) {
      this.phase = 'waiting-for-header';
    }
    return true;
  }

  markHeaderVisible(sessionId: string, visible: boolean): boolean {
    if (!this.hasTargetSession(sessionId) || !visible || this.headerObserved) {
      return false;
    }
    this.headerObserved = true;
    return true;
  }

  maybeSelectSettleGate(sessionId: string, glyphCells: number): StartupSettleGate | null {
    if (!this.hasTargetSession(sessionId) || this.settleGate !== null) {
      return null;
    }
    if (this.headerObserved) {
      this.settleGate = 'header';
    } else if (
      glyphCells > 0 &&
      this.firstOutputAtMs !== null &&
      this.nowMs() - this.firstOutputAtMs >= this.nonemptyFallbackMs
    ) {
      this.settleGate = 'nonempty';
    }
    if (this.settleGate !== null && !this.settledObserved) {
      this.phase = 'settling';
    }
    return this.settleGate;
  }

  scheduleSettledProbe(
    sessionId: string,
    onSettled: (event: StartupSettledEvent) => void
  ): boolean {
    if (
      !this.hasTargetSession(sessionId) ||
      !this.firstOutputObserved ||
      !this.firstPaintObserved ||
      this.settleGate === null ||
      this.settledObserved
    ) {
      return false;
    }
    if (this.settleGate === 'header') {
      if (this.settledTimer !== null) {
        return false;
      }
    } else {
      this.clearSettledTimer();
    }

    this.settledTimer = this.setTimer(() => {
      this.settledTimer = null;
      if (!this.hasTargetSession(sessionId) || this.settledObserved || this.settleGate === null) {
        return;
      }
      this.settledObserved = true;
      this.phase = 'settled';
      onSettled({
        sessionId,
        gate: this.settleGate,
        quietMs: this.quietMs
      });
      this.signalSettled();
    }, this.quietMs);
    return true;
  }

  clearSettledTimer(): boolean {
    if (this.settledTimer === null) {
      return false;
    }
    this.clearTimer(this.settledTimer);
    this.settledTimer = null;
    return true;
  }

  signalSettled(): boolean {
    if (this.settledSignaled) {
      return false;
    }
    this.settledSignaled = true;
    this.resolveSettledWait?.();
    this.resolveSettledWait = null;
    return true;
  }

  finalize(): void {
    this.clearSettledTimer();
    this.signalSettled();
  }

  private hasTargetSession(sessionId: string): boolean {
    return this.targetSessionId !== null && this.targetSessionId === sessionId;
  }

  private createSettledWait(): Promise<void> {
    let resolveFn: (() => void) | null = null;
    const wait = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    this.resolveSettledWait = resolveFn;
    return wait;
  }
}
