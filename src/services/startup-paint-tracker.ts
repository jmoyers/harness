import type { ConversationState } from '../mux/live-mux/conversation-state.ts';

type PerfAttrs = Record<string, boolean | number | string>;

interface StartupSequencerLike {
  snapshot(): {
    firstOutputObserved: boolean;
    firstPaintObserved: boolean;
  };
  markFirstPaintVisible(sessionId: string, glyphCells: number): boolean;
  markHeaderVisible(sessionId: string, visible: boolean): boolean;
  maybeSelectSettleGate(sessionId: string, glyphCells: number): string | null;
}

interface StartupSpanTrackerLike {
  readonly firstPaintTargetSessionId: string | null;
  endFirstPaintSpan(attrs: PerfAttrs): void;
}

interface StartupVisibilityLike {
  visibleGlyphCellCount(conversation: ConversationState): number;
  codexHeaderVisible(conversation: ConversationState): boolean;
}

interface StartupSettledGateLike {
  scheduleProbe(sessionId: string): void;
}

export interface StartupPaintTrackerOptions {
  readonly startupSequencer: StartupSequencerLike;
  readonly startupSpanTracker: StartupSpanTrackerLike;
  readonly startupVisibility: StartupVisibilityLike;
  readonly startupSettledGate: StartupSettledGateLike;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
}

interface StartupRenderFlushInput {
  readonly activeConversation: ConversationState | null;
  readonly activeConversationId: string | null;
  readonly rightFrameVisible: boolean;
  readonly changedRowCount: number;
}

export interface StartupPaintTracker {
  onRenderFlush(input: StartupRenderFlushInput): void;
  onOutputChunk(sessionId: string): void;
}

export function createStartupPaintTracker(options: StartupPaintTrackerOptions): StartupPaintTracker {
  function onRenderFlush(input: StartupRenderFlushInput): void {
    const targetSessionId = options.startupSpanTracker.firstPaintTargetSessionId;
    if (targetSessionId === null) {
      return;
    }
    if (
      input.activeConversation === null ||
      !input.rightFrameVisible ||
      input.activeConversationId !== targetSessionId
    ) {
      return;
    }
    const startupSnapshot = options.startupSequencer.snapshot();
    if (!startupSnapshot.firstOutputObserved) {
      return;
    }

    const glyphCells = options.startupVisibility.visibleGlyphCellCount(input.activeConversation);
    if (
      !startupSnapshot.firstPaintObserved &&
      options.startupSequencer.markFirstPaintVisible(targetSessionId, glyphCells)
    ) {
      options.recordPerfEvent('mux.startup.active-first-visible-paint', {
        sessionId: targetSessionId,
        changedRows: input.changedRowCount,
        glyphCells,
      });
      options.startupSpanTracker.endFirstPaintSpan({
        observed: true,
        changedRows: input.changedRowCount,
        glyphCells,
      });
    }

    if (
      options.startupSequencer.markHeaderVisible(
        targetSessionId,
        options.startupVisibility.codexHeaderVisible(input.activeConversation),
      )
    ) {
      options.recordPerfEvent('mux.startup.active-header-visible', {
        sessionId: targetSessionId,
        glyphCells,
      });
    }
    const selectedGate = options.startupSequencer.maybeSelectSettleGate(targetSessionId, glyphCells);
    if (selectedGate !== null) {
      options.recordPerfEvent('mux.startup.active-settle-gate', {
        sessionId: targetSessionId,
        gate: selectedGate,
        glyphCells,
      });
    }
    options.startupSettledGate.scheduleProbe(targetSessionId);
  }

  function onOutputChunk(sessionId: string): void {
    const targetSessionId = options.startupSpanTracker.firstPaintTargetSessionId;
    if (targetSessionId === null || sessionId !== targetSessionId) {
      return;
    }
    options.startupSettledGate.scheduleProbe(sessionId);
  }

  return {
    onRenderFlush,
    onOutputChunk,
  };
}
