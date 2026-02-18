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

interface StartupPaintTrackerOptions {
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

export class StartupPaintTracker {
  constructor(private readonly options: StartupPaintTrackerOptions) {}

  onRenderFlush(input: StartupRenderFlushInput): void {
    const targetSessionId = this.options.startupSpanTracker.firstPaintTargetSessionId;
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
    const startupSnapshot = this.options.startupSequencer.snapshot();
    if (!startupSnapshot.firstOutputObserved) {
      return;
    }

    const glyphCells = this.options.startupVisibility.visibleGlyphCellCount(input.activeConversation);
    if (
      !startupSnapshot.firstPaintObserved &&
      this.options.startupSequencer.markFirstPaintVisible(targetSessionId, glyphCells)
    ) {
      this.options.recordPerfEvent('mux.startup.active-first-visible-paint', {
        sessionId: targetSessionId,
        changedRows: input.changedRowCount,
        glyphCells,
      });
      this.options.startupSpanTracker.endFirstPaintSpan({
        observed: true,
        changedRows: input.changedRowCount,
        glyphCells,
      });
    }

    if (
      this.options.startupSequencer.markHeaderVisible(
        targetSessionId,
        this.options.startupVisibility.codexHeaderVisible(input.activeConversation),
      )
    ) {
      this.options.recordPerfEvent('mux.startup.active-header-visible', {
        sessionId: targetSessionId,
        glyphCells,
      });
    }
    const selectedGate = this.options.startupSequencer.maybeSelectSettleGate(
      targetSessionId,
      glyphCells,
    );
    if (selectedGate !== null) {
      this.options.recordPerfEvent('mux.startup.active-settle-gate', {
        sessionId: targetSessionId,
        gate: selectedGate,
        glyphCells,
      });
    }
    this.options.startupSettledGate.scheduleProbe(targetSessionId);
  }

  onOutputChunk(sessionId: string): void {
    const targetSessionId = this.options.startupSpanTracker.firstPaintTargetSessionId;
    if (targetSessionId === null || sessionId !== targetSessionId) {
      return;
    }
    this.options.startupSettledGate.scheduleProbe(sessionId);
  }
}
