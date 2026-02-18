import type { ConversationState } from '../mux/live-mux/conversation-state.ts';

type PerfAttrs = Record<string, boolean | number | string>;

interface StartupSettledProbeEvent {
  readonly sessionId: string;
  readonly gate: string;
  readonly quietMs: number;
}

interface StartupSequencerLike {
  clearSettledTimer(): void;
  signalSettled(): void;
  scheduleSettledProbe(
    sessionId: string,
    onSettled: (event: StartupSettledProbeEvent) => void,
  ): void;
}

interface StartupSpanTrackerLike {
  readonly firstPaintTargetSessionId: string | null;
  endSettledSpan(attrs: PerfAttrs): void;
}

interface StartupSettledGateOptions {
  readonly startupSequencer: StartupSequencerLike;
  readonly startupSpanTracker: StartupSpanTrackerLike;
  readonly getConversation: (sessionId: string) => ConversationState | undefined;
  readonly visibleGlyphCellCount: (conversation: ConversationState) => number;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
}

export class StartupSettledGate {
  constructor(private readonly options: StartupSettledGateOptions) {}

  clearTimer(): void {
    this.options.startupSequencer.clearSettledTimer();
  }

  signalSettled(): void {
    this.options.startupSequencer.signalSettled();
  }

  scheduleProbe(sessionId: string): void {
    this.options.startupSequencer.scheduleSettledProbe(sessionId, (event) => {
      if (this.options.startupSpanTracker.firstPaintTargetSessionId !== event.sessionId) {
        return;
      }
      const conversation = this.options.getConversation(event.sessionId);
      const glyphCells =
        conversation === undefined ? 0 : this.options.visibleGlyphCellCount(conversation);
      this.options.recordPerfEvent('mux.startup.active-settled', {
        sessionId: event.sessionId,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells,
      });
      this.options.startupSpanTracker.endSettledSpan({
        observed: true,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells,
      });
      this.options.startupSequencer.signalSettled();
    });
  }
}
