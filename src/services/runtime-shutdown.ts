interface RuntimeShutdownServiceOptions {
  readonly screen: {
    clearDirty: () => void;
  };
  readonly outputLoadSampler: {
    stop: () => void;
  };
  readonly startupBackgroundProbeService: {
    stop: () => void;
  };
  readonly clearResizeTimer: () => void;
  readonly clearPtyResizeTimer: () => void;
  readonly clearHomePaneBackgroundTimer: () => void;
  readonly persistMuxUiStateNow: () => void;
  readonly clearConversationTitleEditTimer: () => void;
  readonly flushTaskComposerPersist: () => void;
  readonly clearRenderScheduled: () => void;
  readonly detachProcessListeners: () => void;
  readonly removeEnvelopeListener: () => void;
  readonly unsubscribeTaskPlanningEvents: () => Promise<void>;
  readonly closeKeyEventSubscription: () => Promise<void>;
  readonly clearRuntimeFatalExitTimer: () => void;
  readonly waitForControlPlaneDrain: () => Promise<void>;
  readonly controlPlaneClient: {
    close: () => Promise<void>;
  };
  readonly eventPersistence: {
    flush: (reason: 'timer' | 'immediate' | 'shutdown') => void;
  };
  readonly recordingService: {
    closeWriter: () => Promise<unknown>;
    finalizeAfterShutdown: (recordingCloseError: unknown) => Promise<void>;
  };
  readonly store: {
    close: () => void;
  };
  readonly restoreTerminalState: () => void;
  readonly startupShutdownService: {
    finalize: () => void;
  };
  readonly shutdownPerfCore: () => void;
}

export class RuntimeShutdownService {
  constructor(private readonly options: RuntimeShutdownServiceOptions) {}

  async finalize(): Promise<void> {
    this.options.screen.clearDirty();
    this.options.outputLoadSampler.stop();
    this.options.startupBackgroundProbeService.stop();
    this.options.clearResizeTimer();
    this.options.clearPtyResizeTimer();
    this.options.clearHomePaneBackgroundTimer();
    this.options.persistMuxUiStateNow();
    this.options.clearConversationTitleEditTimer();
    this.options.flushTaskComposerPersist();
    this.options.clearRenderScheduled();
    this.options.detachProcessListeners();
    this.options.removeEnvelopeListener();
    await this.options.unsubscribeTaskPlanningEvents();
    await this.options.closeKeyEventSubscription();
    this.options.clearRuntimeFatalExitTimer();

    try {
      await this.options.waitForControlPlaneDrain();
      await this.options.controlPlaneClient.close();
    } catch {
      // Best-effort shutdown only.
    }

    this.options.eventPersistence.flush('shutdown');
    const recordingCloseError = await this.options.recordingService.closeWriter();
    this.options.store.close();
    this.options.restoreTerminalState();
    await this.options.recordingService.finalizeAfterShutdown(recordingCloseError);
    this.options.startupShutdownService.finalize();
    this.options.shutdownPerfCore();
  }
}
