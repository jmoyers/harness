import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { detectMuxGlobalShortcut, resolveMuxShortcutBindings } from '../../../src/mux/input-shortcuts.ts';
import { ControlPlaneOpQueue } from '../../../src/mux/control-plane-op-queue.ts';
import { handleGlobalShortcut } from '../../../src/mux/live-mux/global-shortcut-handlers.ts';
import {
  activateLeftNavTarget,
  cycleLeftNavSelection,
} from '../../../src/mux/live-mux/left-nav-activation.ts';
import {
  GlobalShortcutInput,
  type GlobalShortcutActions,
  type GlobalShortcutState,
} from '../../../packages/harness-ui/src/interaction/global-shortcut-input.ts';
import {
  LeftNavInput,
  type LeftNavActions,
  type LeftNavSelection,
  type LeftNavState,
  type LeftNavStrategies,
} from '../../../packages/harness-ui/src/interaction/left-nav-input.ts';

interface QueuedOp {
  readonly label: string;
  readonly task: () => Promise<void>;
}

interface FastCycleHarness {
  readonly selectedConversationId: () => string | null;
  readonly activeConversationId: () => string;
  readonly activationHistory: () => readonly string[];
  readonly queuedCount: () => number;
  readonly queuedLabels: () => readonly string[];
  runSequence(
    sequence: readonly ('next' | 'previous')[],
    drainMode: 'deferred' | 'immediate',
  ): Promise<void>;
  drainCount(count: number): Promise<void>;
  drain(): Promise<void>;
}

async function flushManualSchedule(queue: Array<() => void>): Promise<void> {
  while (queue.length > 0) {
    const next = queue.shift();
    next?.();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

function createFastCycleHarness(sessionIds: readonly string[]): FastCycleHarness {
  assert.equal(sessionIds.length > 1, true);

  const shortcutBindings = resolveMuxShortcutBindings();
  const queued: QueuedOp[] = [];
  let leftNavSelection: LeftNavSelection = {
    kind: 'conversation',
    sessionId: sessionIds[0]!,
  };
  let activeConversationId = sessionIds[0]!;
  const activationHistory: string[] = [];

  const queueControlPlaneOp = (task: () => Promise<void>, label: string): void => {
    queued.push({ label, task });
  };
  const drainCount = async (count: number): Promise<void> => {
    let remaining = Math.max(0, count);
    while (remaining > 0 && queued.length > 0) {
      remaining -= 1;
      const next = queued.shift();
      await next?.task();
    }
  };
  const drain = async (): Promise<void> => {
    while (queued.length > 0) {
      const next = queued.shift();
      await next?.task();
    }
  };

  const leftNavState: LeftNavState = {
    latestRailRows: () => [] as never,
    currentSelection: () => leftNavSelection,
  };
  const leftNavActions: LeftNavActions = {
    enterHomePane: () => {
      leftNavSelection = { kind: 'home' };
    },
    firstDirectoryForRepositoryGroup: () => null,
    enterProjectPane: (_directoryId) => {},
    setMainPaneProjectMode: () => {},
    selectLeftNavRepository: (_repositoryGroupId) => {},
    selectLeftNavConversation: (sessionId) => {
      leftNavSelection = {
        kind: 'conversation',
        sessionId,
      };
    },
    markDirty: () => {},
    directoriesHas: () => false,
    conversationDirectoryId: () => 'dir-a',
    queueControlPlaneOp,
    activateConversation: async (sessionId) => {
      activeConversationId = sessionId;
      activationHistory.push(sessionId);
    },
    conversationsHas: (sessionId) => sessionIds.includes(sessionId),
  };
  const leftNavStrategies: LeftNavStrategies = {
    visibleTargets: () =>
      sessionIds.map((sessionId) => ({
        kind: 'conversation',
        sessionId,
      })),
    activateTarget: activateLeftNavTarget,
    cycleSelection: cycleLeftNavSelection,
  };

  const leftNavInput = new LeftNavInput(leftNavState, leftNavActions, leftNavStrategies);

  const shortcutState: GlobalShortcutState = {
    mainPaneMode: () => 'conversation',
    activeConversationId: () => activeConversationId,
    conversationsHas: (sessionId) => sessionIds.includes(sessionId),
    activeDirectoryId: () => null,
    directoryExists: () => false,
  };
  const shortcutActions: GlobalShortcutActions = {
    requestStop: () => {},
    resolveDirectoryForAction: () => null,
    openNewThreadPrompt: (_directoryId) => {},
    toggleCommandMenu: () => {},
    openOrCreateCritiqueConversationInDirectory: async (_directoryId) => {},
    toggleGatewayProfile: async () => {},
    toggleGatewayStatusTimeline: async () => {},
    toggleGatewayRenderTrace: async (_conversationId) => {},
    queueControlPlaneOp,
    archiveConversation: async (_sessionId) => {},
    refreshAllConversationTitles: async () => {},
    interruptConversation: async (_sessionId) => {},
    takeoverConversation: async (_sessionId) => {},
    openAddDirectoryPrompt: () => {},
    closeDirectory: async (_directoryId) => {},
    cycleLeftNavSelection: (direction) => {
      leftNavInput.cycleSelection(direction);
    },
  };

  const shortcutInput = new GlobalShortcutInput(shortcutBindings, shortcutState, shortcutActions, {
    detectShortcut: detectMuxGlobalShortcut,
    handleShortcut: handleGlobalShortcut,
  });

  const runSequence = async (
    sequence: readonly ('next' | 'previous')[],
    drainMode: 'deferred' | 'immediate',
  ): Promise<void> => {
    for (const step of sequence) {
      const handled = shortcutInput.handleInput(
        step === 'next' ? Buffer.from([0x0a]) : Buffer.from([0x0b]),
      );
      assert.equal(handled, true);
      if (drainMode === 'immediate') {
        await drain();
      }
    }
  };

  return {
    selectedConversationId: () =>
      leftNavSelection.kind === 'conversation' ? leftNavSelection.sessionId : null,
    activeConversationId: () => activeConversationId,
    activationHistory: () => activationHistory,
    queuedCount: () => queued.length,
    queuedLabels: () => queued.map((entry) => entry.label),
    runSequence,
    drainCount,
    drain,
  };
}

void test('fast ctrl+j/k cycling converges on expected conversation with immediate or deferred activation drain', async () => {
  const sessionIds = ['session-a', 'session-b', 'session-c', 'session-d'] as const;
  const sequence: Array<'next' | 'previous'> = [
    ...Array.from({ length: 60 }, () => 'next' as const),
    ...Array.from({ length: 17 }, () => 'previous' as const),
    ...Array.from({ length: 9 }, () => 'next' as const),
  ];

  let expectedIndex = 0;
  for (const step of sequence) {
    expectedIndex += step === 'next' ? 1 : -1;
    expectedIndex = (expectedIndex + sessionIds.length) % sessionIds.length;
  }
  const expectedFinalSession = sessionIds[expectedIndex]!;

  const deferred = createFastCycleHarness(sessionIds);
  await deferred.runSequence(sequence, 'deferred');
  assert.equal(deferred.selectedConversationId(), expectedFinalSession);
  assert.equal(deferred.activeConversationId(), sessionIds[0]);
  assert.equal(deferred.queuedCount() > 0, true);
  assert.equal(
    deferred
      .queuedLabels()
      .every(
        (label) =>
          label.startsWith('shortcut-activate-next') ||
          label.startsWith('shortcut-activate-previous'),
      ),
    true,
  );
  await deferred.drain();
  assert.equal(deferred.activeConversationId(), expectedFinalSession);

  const immediate = createFastCycleHarness(sessionIds);
  await immediate.runSequence(sequence, 'immediate');
  assert.equal(immediate.selectedConversationId(), expectedFinalSession);
  assert.equal(immediate.activeConversationId(), expectedFinalSession);
  assert.equal(immediate.queuedCount(), 0);
});

void test('fast ctrl+j under project-review contention reproduces stale activation lag seen in session telemetry', async () => {
  const shortcutBindings = resolveMuxShortcutBindings();
  const queued: QueuedOp[] = [];
  const activationHistory: string[] = [];
  const targets: readonly LeftNavSelection[] = [
    { kind: 'project', directoryId: 'dir-a' },
    { kind: 'conversation', sessionId: 'session-a' },
    { kind: 'project', directoryId: 'dir-b' },
    { kind: 'conversation', sessionId: 'session-b' },
  ];

  let leftNavSelection: LeftNavSelection = {
    kind: 'conversation',
    sessionId: 'session-a',
  };
  let activeConversationId = 'session-a';
  let mainPaneMode: 'conversation' | 'project' | 'home' = 'conversation';
  const queueControlPlaneOp = (task: () => Promise<void>, label: string): void => {
    queued.push({ label, task });
  };

  const leftNavInput = new LeftNavInput(
    {
      latestRailRows: () => [] as never,
      currentSelection: () => leftNavSelection,
    },
    {
      enterHomePane: () => {
        mainPaneMode = 'home';
        leftNavSelection = {
          kind: 'home',
        };
      },
      firstDirectoryForRepositoryGroup: () => null,
      enterProjectPane: (directoryId) => {
        mainPaneMode = 'project';
        leftNavSelection = {
          kind: 'project',
          directoryId,
        };
        // Session telemetry shows project review refresh contends in the same interactive queue.
        queueControlPlaneOp(async () => {}, 'project-pane-github-review');
      },
      setMainPaneProjectMode: () => {
        mainPaneMode = 'project';
      },
      selectLeftNavRepository: (_repositoryGroupId) => {},
      selectLeftNavConversation: (sessionId) => {
        leftNavSelection = {
          kind: 'conversation',
          sessionId,
        };
      },
      markDirty: () => {},
      directoriesHas: () => true,
      conversationDirectoryId: (sessionId) =>
        sessionId === 'session-a' ? 'dir-a' : sessionId === 'session-b' ? 'dir-b' : null,
      queueControlPlaneOp,
      activateConversation: async (sessionId) => {
        activeConversationId = sessionId;
        mainPaneMode = 'conversation';
        activationHistory.push(sessionId);
      },
      conversationsHas: (sessionId) => sessionId === 'session-a' || sessionId === 'session-b',
    },
    {
      visibleTargets: () => targets,
      activateTarget: activateLeftNavTarget,
      cycleSelection: cycleLeftNavSelection,
    },
  );

  const globalShortcutInput = new GlobalShortcutInput(
    shortcutBindings,
    {
      mainPaneMode: () => mainPaneMode,
      activeConversationId: () => activeConversationId,
      conversationsHas: (sessionId) => sessionId === 'session-a' || sessionId === 'session-b',
      activeDirectoryId: () => null,
      directoryExists: () => false,
    },
    {
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: (_directoryId) => {},
      toggleCommandMenu: () => {},
      openOrCreateCritiqueConversationInDirectory: async (_directoryId) => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async (_conversationId) => {},
      queueControlPlaneOp,
      archiveConversation: async (_sessionId) => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async (_sessionId) => {},
      takeoverConversation: async (_sessionId) => {},
      openAddDirectoryPrompt: () => {},
      closeDirectory: async (_directoryId) => {},
      cycleLeftNavSelection: (direction) => {
        leftNavInput.cycleSelection(direction);
      },
    },
    {
      detectShortcut: detectMuxGlobalShortcut,
      handleShortcut: handleGlobalShortcut,
    },
  );

  for (let index = 0; index < 40; index += 1) {
    assert.equal(globalShortcutInput.handleInput(Buffer.from([0x0a])), true);
  }

  const shortcutCount = queued.filter((entry) => entry.label === 'shortcut-activate-next').length;
  const reviewCount = queued.filter((entry) => entry.label === 'project-pane-github-review').length;
  assert.equal(shortcutCount, 20);
  assert.equal(reviewCount, 20);
  assert.equal(leftNavSelection.kind, 'conversation');
  assert.equal(leftNavSelection.sessionId, 'session-a');

  // Drain a prefix to model in-flight backlog; active conversation still trails selected.
  for (let index = 0; index < 10; index += 1) {
    const next = queued.shift();
    await next?.task();
  }
  assert.equal(activeConversationId, 'session-b');
  assert.equal(leftNavSelection.kind, 'conversation');
  assert.equal(leftNavSelection.sessionId, 'session-a');

  while (queued.length > 0) {
    const next = queued.shift();
    await next?.task();
  }
  assert.equal(activeConversationId, 'session-a');
  assert.equal(activationHistory.length, 20);
});

void test('fast ctrl+j under project-review contention with latest keyed queue keeps backlog bounded and converges', async () => {
  const shortcutBindings = resolveMuxShortcutBindings();
  const activationHistory: string[] = [];
  const targets: readonly LeftNavSelection[] = [
    { kind: 'project', directoryId: 'dir-a' },
    { kind: 'conversation', sessionId: 'session-a' },
    { kind: 'project', directoryId: 'dir-b' },
    { kind: 'conversation', sessionId: 'session-b' },
  ];
  const scheduled: Array<() => void> = [];
  const opQueue = new ControlPlaneOpQueue({
    schedule: (callback) => {
      scheduled.push(callback);
    },
  });

  let leftNavSelection: LeftNavSelection = {
    kind: 'conversation',
    sessionId: 'session-a',
  };
  let activeConversationId = 'session-a';
  let mainPaneMode: 'conversation' | 'project' | 'home' = 'conversation';
  const queueControlPlaneOp = (task: () => Promise<void>, label: string): void => {
    opQueue.enqueueInteractive(async () => {
      await task();
    }, label);
  };
  const queueLatestControlPlaneOp = (
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label: string,
  ): void => {
    opQueue.enqueueInteractive(task, label, {
      key,
      supersede: 'pending-and-running',
    });
  };

  const leftNavInput = new LeftNavInput(
    {
      latestRailRows: () => [] as never,
      currentSelection: () => leftNavSelection,
    },
    {
      enterHomePane: () => {
        mainPaneMode = 'home';
        leftNavSelection = {
          kind: 'home',
        };
      },
      firstDirectoryForRepositoryGroup: () => null,
      enterProjectPane: (directoryId) => {
        mainPaneMode = 'project';
        leftNavSelection = {
          kind: 'project',
          directoryId,
        };
        queueLatestControlPlaneOp(
          `project-pane-github-review:${directoryId}`,
          async ({ signal }) => {
            await new Promise<void>((resolve) => {
              setImmediate(resolve);
            });
            if (signal.aborted) {
              return;
            }
          },
          'project-pane-github-review',
        );
      },
      setMainPaneProjectMode: () => {
        mainPaneMode = 'project';
      },
      selectLeftNavRepository: (_repositoryGroupId) => {},
      selectLeftNavConversation: (sessionId) => {
        leftNavSelection = {
          kind: 'conversation',
          sessionId,
        };
      },
      markDirty: () => {},
      directoriesHas: () => true,
      conversationDirectoryId: (sessionId) =>
        sessionId === 'session-a' ? 'dir-a' : sessionId === 'session-b' ? 'dir-b' : null,
      queueControlPlaneOp,
      queueLatestControlPlaneOp,
      activateConversation: async (sessionId, options) => {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        if (options?.signal?.aborted === true) {
          return;
        }
        activeConversationId = sessionId;
        mainPaneMode = 'conversation';
        activationHistory.push(sessionId);
      },
      conversationsHas: (sessionId) => sessionId === 'session-a' || sessionId === 'session-b',
    },
    {
      visibleTargets: () => targets,
      activateTarget: activateLeftNavTarget,
      cycleSelection: cycleLeftNavSelection,
    },
  );

  const globalShortcutInput = new GlobalShortcutInput(
    shortcutBindings,
    {
      mainPaneMode: () => mainPaneMode,
      activeConversationId: () => activeConversationId,
      conversationsHas: (sessionId) => sessionId === 'session-a' || sessionId === 'session-b',
      activeDirectoryId: () => null,
      directoryExists: () => false,
    },
    {
      requestStop: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: (_directoryId) => {},
      toggleCommandMenu: () => {},
      openOrCreateCritiqueConversationInDirectory: async (_directoryId) => {},
      toggleGatewayProfile: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async (_conversationId) => {},
      queueControlPlaneOp,
      archiveConversation: async (_sessionId) => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async (_sessionId) => {},
      takeoverConversation: async (_sessionId) => {},
      openAddDirectoryPrompt: () => {},
      closeDirectory: async (_directoryId) => {},
      cycleLeftNavSelection: (direction) => {
        leftNavInput.cycleSelection(direction);
      },
    },
    {
      detectShortcut: detectMuxGlobalShortcut,
      handleShortcut: handleGlobalShortcut,
    },
  );

  for (let index = 0; index < 40; index += 1) {
    assert.equal(globalShortcutInput.handleInput(Buffer.from([0x0a])), true);
  }

  assert.equal(leftNavSelection.kind, 'conversation');
  assert.equal(leftNavSelection.sessionId, 'session-a');
  assert.equal(opQueue.metrics().interactiveQueued <= 3, true);

  await flushManualSchedule(scheduled);
  await opQueue.waitForDrain();
  await flushManualSchedule(scheduled);

  assert.equal(activeConversationId, 'session-a');
  assert.equal(activationHistory.length, 1);
});
