type SpanAttrs = Record<string, boolean | number | string>;

interface StartupSnapshotLike {
  firstOutputObserved: boolean;
  firstPaintObserved: boolean;
  settledObserved: boolean;
  settleGate: string | null;
}

interface StartupSequencerLike {
  snapshot(): StartupSnapshotLike;
}

interface StartupSpanTrackerLike {
  endStartCommandSpan(attrs: SpanAttrs): void;
  endFirstOutputSpan(attrs: SpanAttrs): void;
  endFirstPaintSpan(attrs: SpanAttrs): void;
  endSettledSpan(attrs: SpanAttrs): void;
}

interface StartupSettledGateLike {
  clearTimer(): void;
  signalSettled(): void;
}

interface StartupShutdownServiceOptions {
  readonly startupSequencer: StartupSequencerLike;
  readonly startupSpanTracker: StartupSpanTrackerLike;
  readonly startupSettledGate: StartupSettledGateLike;
}

export class StartupShutdownService {
  constructor(private readonly options: StartupShutdownServiceOptions) {}

  finalize(): void {
    this.options.startupSpanTracker.endStartCommandSpan({
      observed: false,
    });
    const startupSnapshot = this.options.startupSequencer.snapshot();
    this.options.startupSpanTracker.endFirstOutputSpan({
      observed: startupSnapshot.firstOutputObserved,
    });
    this.options.startupSpanTracker.endFirstPaintSpan({
      observed: startupSnapshot.firstPaintObserved,
    });
    this.options.startupSettledGate.clearTimer();
    this.options.startupSpanTracker.endSettledSpan({
      observed: startupSnapshot.settledObserved,
      gate: startupSnapshot.settleGate ?? 'none',
    });
    this.options.startupSettledGate.signalSettled();
  }
}
