export interface RuntimeShutdownServiceOptions {
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
  readonly clearProjectPaneGitHubReviewRefreshTimer: () => void;
  readonly persistMuxUiStateNow: () => void;
  readonly clearConversationTitleEditTimer: () => void;
  readonly flushTaskComposerPersist: () => void;
  readonly clearRenderScheduled: () => void;
  readonly detachProcessListeners: () => void;
  readonly removeEnvelopeListener: () => void;
  readonly stopWorkspaceObservedEvents: () => void;
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

export async function finalizeRuntimeShutdown(options: RuntimeShutdownServiceOptions): Promise<void> {
  options.screen.clearDirty();
  options.outputLoadSampler.stop();
  options.startupBackgroundProbeService.stop();
  options.clearResizeTimer();
  options.clearPtyResizeTimer();
  options.clearHomePaneBackgroundTimer();
  options.clearProjectPaneGitHubReviewRefreshTimer();
  options.persistMuxUiStateNow();
  options.clearConversationTitleEditTimer();
  options.flushTaskComposerPersist();
  options.clearRenderScheduled();
  options.detachProcessListeners();
  options.removeEnvelopeListener();
  options.stopWorkspaceObservedEvents();
  await options.unsubscribeTaskPlanningEvents();
  await options.closeKeyEventSubscription();
  options.clearRuntimeFatalExitTimer();

  try {
    await options.waitForControlPlaneDrain();
    await options.controlPlaneClient.close();
  } catch {
    // Best-effort shutdown only.
  }

  options.eventPersistence.flush('shutdown');
  const recordingCloseError = await options.recordingService.closeWriter();
  options.store.close();
  options.restoreTerminalState();
  await options.recordingService.finalizeAfterShutdown(recordingCloseError);
  options.startupShutdownService.finalize();
  options.shutdownPerfCore();
}
