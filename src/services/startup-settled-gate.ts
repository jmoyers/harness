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

export interface StartupSettledGateOptions {
  readonly startupSequencer: StartupSequencerLike;
  readonly startupSpanTracker: StartupSpanTrackerLike;
  readonly getConversation: (sessionId: string) => ConversationState | undefined;
  readonly visibleGlyphCellCount: (conversation: ConversationState) => number;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
}

export interface StartupSettledGate {
  clearTimer(): void;
  signalSettled(): void;
  scheduleProbe(sessionId: string): void;
}

export function createStartupSettledGate(options: StartupSettledGateOptions): StartupSettledGate {
  function clearTimer(): void {
    options.startupSequencer.clearSettledTimer();
  }

  function signalSettled(): void {
    options.startupSequencer.signalSettled();
  }

  function scheduleProbe(sessionId: string): void {
    options.startupSequencer.scheduleSettledProbe(sessionId, (event) => {
      if (options.startupSpanTracker.firstPaintTargetSessionId !== event.sessionId) {
        return;
      }
      const conversation = options.getConversation(event.sessionId);
      const glyphCells = conversation === undefined ? 0 : options.visibleGlyphCellCount(conversation);
      options.recordPerfEvent('mux.startup.active-settled', {
        sessionId: event.sessionId,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells,
      });
      options.startupSpanTracker.endSettledSpan({
        observed: true,
        gate: event.gate,
        quietMs: event.quietMs,
        glyphCells,
      });
      options.startupSequencer.signalSettled();
    });
  }

  return {
    clearTimer,
    signalSettled,
    scheduleProbe,
  };
}
