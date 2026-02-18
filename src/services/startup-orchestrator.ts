import type { ConversationState } from '../mux/live-mux/conversation-state.ts';
import { StartupSequencer } from '../mux/startup-sequencer.ts';
import { StartupBackgroundProbeService } from './startup-background-probe.ts';
import { StartupBackgroundResumeService } from './startup-background-resume.ts';
import { StartupOutputTracker } from './startup-output-tracker.ts';
import { StartupPaintTracker } from './startup-paint-tracker.ts';
import { StartupSettledGate } from './startup-settled-gate.ts';
import { StartupShutdownService } from './startup-shutdown.ts';
import { StartupSpanTracker } from './startup-span-tracker.ts';
import { StartupVisibility } from './startup-visibility.ts';

type PerfAttrs = Record<string, boolean | number | string>;

interface PerfSpanLike {
  end(attrs?: PerfAttrs): void;
}

interface StartupOrchestratorOptions {
  readonly startupSettleQuietMs: number;
  readonly startupSettleNonemptyFallbackMs: number;
  readonly backgroundWaitMaxMs: number;
  readonly backgroundProbeEnabled: boolean;
  readonly backgroundResumeEnabled: boolean;
  readonly startPerfSpan: (name: string, attrs?: PerfAttrs) => PerfSpanLike;
  readonly startupSpan: PerfSpanLike;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
  readonly getConversation: (sessionId: string) => ConversationState | undefined;
  readonly isShuttingDown: () => boolean;
  readonly refreshProcessUsage: (reason: 'startup' | 'interval') => void | Promise<void>;
  readonly queuePersistedConversationsInBackground: (initialActiveId: string | null) => number;
  readonly hydrateStartupState: (afterCursor: number | null) => Promise<void>;
  readonly activateConversation: (sessionId: string) => Promise<void>;
  readonly conversationCount: () => number;
}

interface StartupRenderFlushInput {
  readonly activeConversation: ConversationState | null;
  readonly activeConversationId: string | null;
  readonly rightFrameVisible: boolean;
  readonly changedRowCount: number;
}

export class StartupOrchestrator {
  private readonly startupSequencer: StartupSequencer;
  private readonly startupSpanTracker: StartupSpanTracker;
  private readonly startupOutputTracker: StartupOutputTracker;
  private readonly startupPaintTracker: StartupPaintTracker;
  private readonly startupBackgroundProbeService: StartupBackgroundProbeService;
  private readonly startupBackgroundResumeService: StartupBackgroundResumeService;
  private readonly startupShutdownService: StartupShutdownService;

  constructor(private readonly options: StartupOrchestratorOptions) {
    this.startupSequencer = new StartupSequencer({
      quietMs: options.startupSettleQuietMs,
      nonemptyFallbackMs: options.startupSettleNonemptyFallbackMs,
    });
    this.startupSpanTracker = new StartupSpanTracker(
      options.startPerfSpan,
      options.startupSettleQuietMs,
    );
    const startupVisibility = new StartupVisibility();
    const startupSettledGate = new StartupSettledGate({
      startupSequencer: this.startupSequencer,
      startupSpanTracker: this.startupSpanTracker,
      getConversation: options.getConversation,
      visibleGlyphCellCount: (conversation) => startupVisibility.visibleGlyphCellCount(conversation),
      recordPerfEvent: options.recordPerfEvent,
    });
    this.startupOutputTracker = new StartupOutputTracker({
      startupSequencer: this.startupSequencer,
      startupSpanTracker: this.startupSpanTracker,
      recordPerfEvent: options.recordPerfEvent,
    });
    this.startupPaintTracker = new StartupPaintTracker({
      startupSequencer: this.startupSequencer,
      startupSpanTracker: this.startupSpanTracker,
      startupVisibility,
      startupSettledGate,
      recordPerfEvent: options.recordPerfEvent,
    });
    this.startupBackgroundProbeService = new StartupBackgroundProbeService({
      enabled: options.backgroundProbeEnabled,
      maxWaitMs: options.backgroundWaitMaxMs,
      isShuttingDown: options.isShuttingDown,
      waitForSettled: () => this.startupSequencer.waitForSettled(),
      settledObserved: () => this.startupSequencer.snapshot().settledObserved,
      refreshProcessUsage: options.refreshProcessUsage,
      recordPerfEvent: options.recordPerfEvent,
    });
    this.startupBackgroundResumeService = new StartupBackgroundResumeService({
      enabled: options.backgroundResumeEnabled,
      maxWaitMs: options.backgroundWaitMaxMs,
      waitForSettled: () => this.startupSequencer.waitForSettled(),
      settledObserved: () => this.startupSequencer.snapshot().settledObserved,
      queuePersistedConversationsInBackground: options.queuePersistedConversationsInBackground,
      recordPerfEvent: options.recordPerfEvent,
    });
    this.startupShutdownService = new StartupShutdownService({
      startupSequencer: this.startupSequencer,
      startupSpanTracker: this.startupSpanTracker,
      startupSettledGate,
    });
  }

  get firstPaintTargetSessionId(): string | null {
    return this.startupSpanTracker.firstPaintTargetSessionId;
  }

  endStartCommandSpan(attrs: PerfAttrs): void {
    this.startupSpanTracker.endStartCommandSpan(attrs);
  }

  onOutputChunk(sessionId: string, bytes: number): void {
    this.startupOutputTracker.onOutputChunk(sessionId, bytes);
  }

  onPaintOutputChunk(sessionId: string): void {
    this.startupPaintTracker.onOutputChunk(sessionId);
  }

  onRenderFlush(input: StartupRenderFlushInput): void {
    this.startupPaintTracker.onRenderFlush(input);
  }

  startBackgroundProbe(): void {
    this.startupBackgroundProbeService.recordWaitPhase();
    void this.startupBackgroundProbeService.startWhenSettled();
  }

  stop(): void {
    this.startupBackgroundProbeService.stop();
  }

  async hydrateStartupState(afterCursor: number | null): Promise<void> {
    await this.options.hydrateStartupState(afterCursor);
  }

  async activateInitialConversation(initialActiveId: string | null): Promise<void> {
    this.startupSequencer.setTargetSession(initialActiveId);
    if (initialActiveId === null) {
      return;
    }
    this.startupSpanTracker.beginForSession(initialActiveId);
    const initialActivateSpan = this.options.startPerfSpan('mux.startup.activate-initial', {
      initialActiveId,
    });
    await this.options.activateConversation(initialActiveId);
    initialActivateSpan.end();
  }

  finalizeStartup(initialActiveId: string | null): void {
    const conversationCount = this.options.conversationCount();
    this.options.startupSpan.end({
      conversations: conversationCount,
    });
    this.options.recordPerfEvent('mux.startup.ready', {
      conversations: conversationCount,
    });
    void this.startupBackgroundResumeService.run(initialActiveId);
  }

  finalize(): void {
    this.startupShutdownService.finalize();
  }
}
