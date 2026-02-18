type PerfAttrs = Record<string, boolean | number | string>;

interface StartupSequencerLike {
  snapshot(): {
    firstOutputObserved: boolean;
  };
  markFirstOutput(sessionId: string): boolean;
}

interface StartupSpanTrackerLike {
  readonly firstPaintTargetSessionId: string | null;
  endFirstOutputSpan(attrs: PerfAttrs): void;
}

interface StartupOutputTrackerOptions {
  readonly startupSequencer: StartupSequencerLike;
  readonly startupSpanTracker: StartupSpanTrackerLike;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
}

export class StartupOutputTracker {
  private readonly sessionFirstOutputObserved = new Set<string>();

  constructor(private readonly options: StartupOutputTrackerOptions) {}

  onOutputChunk(sessionId: string, bytes: number): void {
    if (!this.sessionFirstOutputObserved.has(sessionId)) {
      this.sessionFirstOutputObserved.add(sessionId);
      this.options.recordPerfEvent('mux.session.first-output', {
        sessionId,
        bytes,
      });
    }

    const targetSessionId = this.options.startupSpanTracker.firstPaintTargetSessionId;
    if (targetSessionId === null || sessionId !== targetSessionId) {
      return;
    }
    if (this.options.startupSequencer.snapshot().firstOutputObserved) {
      return;
    }
    if (!this.options.startupSequencer.markFirstOutput(sessionId)) {
      return;
    }
    this.options.recordPerfEvent('mux.startup.active-first-output', {
      sessionId,
      bytes,
    });
    this.options.startupSpanTracker.endFirstOutputSpan({
      observed: true,
      bytes,
    });
  }
}
