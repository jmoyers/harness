import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeShutdownService } from '../src/services/runtime-shutdown.ts';

interface BuildResult {
  readonly calls: string[];
  readonly finalizeRecordingArgs: unknown[];
  readonly service: RuntimeShutdownService;
}

function buildService(options?: {
  closeControlPlaneClient?: (calls: string[]) => Promise<void>;
  closeRecordingWriter?: (calls: string[]) => Promise<unknown>;
}): BuildResult {
  const calls: string[] = [];
  const finalizeRecordingArgs: unknown[] = [];
  const service = new RuntimeShutdownService({
    screen: {
      clearDirty: () => {
        calls.push('clearScreenDirty');
      },
    },
    outputLoadSampler: {
      stop: () => {
        calls.push('stopOutputLoadSampler');
      },
    },
    startupBackgroundProbeService: {
      stop: () => {
        calls.push('stopStartupBackgroundProbe');
      },
    },
    clearResizeTimer: () => {
      calls.push('clearResizeTimer');
    },
    clearPtyResizeTimer: () => {
      calls.push('clearPtyResizeTimer');
    },
    clearHomePaneBackgroundTimer: () => {
      calls.push('clearHomePaneBackgroundTimer');
    },
    clearProjectPaneGitHubReviewRefreshTimer: () => {
      calls.push('clearProjectPaneGitHubReviewRefreshTimer');
    },
    persistMuxUiStateNow: () => {
      calls.push('persistMuxUiStateNow');
    },
    clearConversationTitleEditTimer: () => {
      calls.push('clearConversationTitleEditTimer');
    },
    flushTaskComposerPersist: () => {
      calls.push('flushTaskComposerPersist');
    },
    clearRenderScheduled: () => {
      calls.push('clearRenderScheduled');
    },
    detachProcessListeners: () => {
      calls.push('detachProcessListeners');
    },
    removeEnvelopeListener: () => {
      calls.push('removeEnvelopeListener');
    },
    unsubscribeTaskPlanningEvents: async () => {
      calls.push('unsubscribeTaskPlanningEvents');
    },
    closeKeyEventSubscription: async () => {
      calls.push('closeKeyEventSubscription');
    },
    clearRuntimeFatalExitTimer: () => {
      calls.push('clearRuntimeFatalExitTimer');
    },
    waitForControlPlaneDrain: async () => {
      calls.push('waitForControlPlaneDrain');
    },
    controlPlaneClient: {
      close: async () => {
        if (options?.closeControlPlaneClient !== undefined) {
          await options.closeControlPlaneClient(calls);
          return;
        }
        calls.push('closeControlPlaneClient');
      },
    },
    eventPersistence: {
      flush: () => {
        calls.push('flushEventPersistence');
      },
    },
    recordingService: {
      closeWriter: async () => {
        if (options?.closeRecordingWriter !== undefined) {
          return await options.closeRecordingWriter(calls);
        }
        calls.push('closeRecordingWriter');
        return null;
      },
      finalizeAfterShutdown: async (error) => {
        calls.push('finalizeRecordingAfterShutdown');
        finalizeRecordingArgs.push(error);
      },
    },
    store: {
      close: () => {
        calls.push('closeStore');
      },
    },
    restoreTerminalState: () => {
      calls.push('restoreTerminalState');
    },
    startupShutdownService: {
      finalize: () => {
        calls.push('finalizeStartupShutdown');
      },
    },
    shutdownPerfCore: () => {
      calls.push('shutdownPerfCore');
    },
  });
  return {
    calls,
    finalizeRecordingArgs,
    service,
  };
}

void test('runtime shutdown service finalizes dependencies in order and forwards recording close error', async () => {
  const recordingCloseError = new Error('recording-close-failed');
  const fixture = buildService({
    closeRecordingWriter: async (calls) => {
      calls.push('closeRecordingWriter');
      return recordingCloseError;
    },
  });

  await fixture.service.finalize();

  assert.deepEqual(fixture.calls, [
    'clearScreenDirty',
    'stopOutputLoadSampler',
    'stopStartupBackgroundProbe',
    'clearResizeTimer',
    'clearPtyResizeTimer',
    'clearHomePaneBackgroundTimer',
    'clearProjectPaneGitHubReviewRefreshTimer',
    'persistMuxUiStateNow',
    'clearConversationTitleEditTimer',
    'flushTaskComposerPersist',
    'clearRenderScheduled',
    'detachProcessListeners',
    'removeEnvelopeListener',
    'unsubscribeTaskPlanningEvents',
    'closeKeyEventSubscription',
    'clearRuntimeFatalExitTimer',
    'waitForControlPlaneDrain',
    'closeControlPlaneClient',
    'flushEventPersistence',
    'closeRecordingWriter',
    'closeStore',
    'restoreTerminalState',
    'finalizeRecordingAfterShutdown',
    'finalizeStartupShutdown',
    'shutdownPerfCore',
  ]);
  assert.deepEqual(fixture.finalizeRecordingArgs, [recordingCloseError]);
});

void test('runtime shutdown service tolerates control-plane close failures and still completes teardown', async () => {
  const fixture = buildService({
    closeControlPlaneClient: async (calls) => {
      calls.push('closeControlPlaneClient');
      throw new Error('close failed');
    },
  });

  await fixture.service.finalize();

  assert.deepEqual(fixture.calls, [
    'clearScreenDirty',
    'stopOutputLoadSampler',
    'stopStartupBackgroundProbe',
    'clearResizeTimer',
    'clearPtyResizeTimer',
    'clearHomePaneBackgroundTimer',
    'clearProjectPaneGitHubReviewRefreshTimer',
    'persistMuxUiStateNow',
    'clearConversationTitleEditTimer',
    'flushTaskComposerPersist',
    'clearRenderScheduled',
    'detachProcessListeners',
    'removeEnvelopeListener',
    'unsubscribeTaskPlanningEvents',
    'closeKeyEventSubscription',
    'clearRuntimeFatalExitTimer',
    'waitForControlPlaneDrain',
    'closeControlPlaneClient',
    'flushEventPersistence',
    'closeRecordingWriter',
    'closeStore',
    'restoreTerminalState',
    'finalizeRecordingAfterShutdown',
    'finalizeStartupShutdown',
    'shutdownPerfCore',
  ]);
  assert.deepEqual(fixture.finalizeRecordingArgs, [null]);
});
