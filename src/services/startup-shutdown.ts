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

export interface StartupShutdownServiceOptions {
  readonly startupSequencer: StartupSequencerLike;
  readonly startupSpanTracker: StartupSpanTrackerLike;
  readonly startupSettledGate: StartupSettledGateLike;
}

export function finalizeStartupShutdown(options: StartupShutdownServiceOptions): void {
  options.startupSpanTracker.endStartCommandSpan({
    observed: false,
  });
  const startupSnapshot = options.startupSequencer.snapshot();
  options.startupSpanTracker.endFirstOutputSpan({
    observed: startupSnapshot.firstOutputObserved,
  });
  options.startupSpanTracker.endFirstPaintSpan({
    observed: startupSnapshot.firstPaintObserved,
  });
  options.startupSettledGate.clearTimer();
  options.startupSpanTracker.endSettledSpan({
    observed: startupSnapshot.settledObserved,
    gate: startupSnapshot.settleGate ?? 'none',
  });
  options.startupSettledGate.signalSettled();
}
