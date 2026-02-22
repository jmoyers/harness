import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { resolveDirectoryForAction } from '../../../../src/mux/live-mux/directory-resolution.ts';
import { handleHomePaneDragRelease } from '../../../../src/mux/live-mux/home-pane-drop.ts';
import { handleProjectPaneActionClick } from '../../../../src/mux/live-mux/project-pane-pointer.ts';
import { requestStop } from '../../../../src/mux/live-mux/runtime-shutdown.ts';
import { refreshProcessUsageSnapshots } from '../../../../src/mux/live-mux/process-usage.ts';
import { handleHomePaneActionClick } from '../../../../src/mux/live-mux/home-pane-actions.ts';
import { routeInputTokensForConversation } from '../../../../src/mux/live-mux/input-forwarding.ts';
import { dismissModalOnOutsideClick } from '../../../../src/mux/live-mux/modal-pointer.ts';
import { RailPointerInput } from '../../../../packages/harness-ui/src/interaction/rail-pointer-input.ts';
import { leftNavTargetKey, visibleLeftNavTargets } from '../../../../src/mux/live-mux/left-nav.ts';
import {
  actionAtWorkspaceRailCell,
  conversationIdAtWorkspaceRailRow,
  kindAtWorkspaceRailRow,
  projectIdAtWorkspaceRailRow,
  repositoryIdAtWorkspaceRailRow,
  type buildWorkspaceRailViewRows,
} from '../../../../src/mux/workspace-rail-model.ts';

type RailRows = ReturnType<typeof buildWorkspaceRailViewRows>;

interface HandleLeftRailPointerClickOptions {
  clickEligible: boolean;
  rows: RailRows;
  paneRows: number;
  leftCols: number;
  pointerRow: number;
  pointerCol: number;
  hasConversationTitleEdit: boolean;
  conversationTitleEditConversationId: string | null;
  stopConversationTitleEdit: () => void;
  hasSelection: boolean;
  clearSelection: () => void;
  handleAction: (context: {
    selectedConversationId: string | null;
    selectedProjectId: string | null;
    selectedRepositoryId: string | null;
    selectedAction: string | null;
    supportsConversationTitleEditClick: boolean;
  }) => boolean;
  handleConversation: (context: {
    selectedConversationId: string | null;
    selectedProjectId: string | null;
    selectedRepositoryId: string | null;
    selectedAction: string | null;
    supportsConversationTitleEditClick: boolean;
  }) => void;
}

function handleLeftRailPointerClick(options: HandleLeftRailPointerClickOptions): boolean {
  const pointerInput = new RailPointerInput(
    {
      resolveHit: (rowIndex, colIndex, railCols) => {
        const selectedConversationId = conversationIdAtWorkspaceRailRow(options.rows, rowIndex);
        const selectedProjectId = projectIdAtWorkspaceRailRow(options.rows, rowIndex);
        const selectedRepositoryId = repositoryIdAtWorkspaceRailRow(options.rows, rowIndex);
        const selectedAction = actionAtWorkspaceRailCell(
          options.rows,
          rowIndex,
          colIndex,
          railCols,
        );
        const selectedRowKind = kindAtWorkspaceRailRow(options.rows, rowIndex);
        return {
          selectedConversationId,
          selectedProjectId,
          selectedRepositoryId,
          selectedAction,
          supportsConversationTitleEditClick:
            selectedRowKind === 'conversation-title' || selectedRowKind === 'conversation-body',
        };
      },
    },
    {
      dispatchHit: (context) => {
        if (options.handleAction(context)) {
          return true;
        }
        options.handleConversation(context);
        return true;
      },
    },
    {
      hasActiveEdit: () => options.hasConversationTitleEdit,
      shouldKeepActiveEdit: (context) =>
        context.selectedConversationId === options.conversationTitleEditConversationId &&
        context.supportsConversationTitleEditClick,
      stopActiveEdit: options.stopConversationTitleEdit,
    },
    {
      hasSelection: () => options.hasSelection,
      clearSelection: options.clearSelection,
    },
  );
  return pointerInput.handlePointerClick({
    clickEligible: options.clickEligible,
    paneRows: options.paneRows,
    leftCols: options.leftCols,
    pointerRow: options.pointerRow,
    pointerCol: options.pointerCol,
  });
}

void test('resolveDirectoryForAction honors project mode, conversation mapping, and fallback directory', () => {
  const conversations = new Map([
    [
      'session-a',
      {
        directoryId: 'dir-a',
      },
    ],
    [
      'session-null',
      {
        directoryId: null,
      },
    ],
  ]);
  assert.equal(
    resolveDirectoryForAction({
      mainPaneMode: 'project',
      activeDirectoryId: 'dir-a',
      activeConversationId: 'session-a',
      conversations,
      directoriesHas: (directoryId) => directoryId === 'dir-a',
    }),
    'dir-a',
  );
  assert.equal(
    resolveDirectoryForAction({
      mainPaneMode: 'project',
      activeDirectoryId: 'dir-missing',
      activeConversationId: 'session-a',
      conversations,
      directoriesHas: () => false,
    }),
    null,
  );
  assert.equal(
    resolveDirectoryForAction({
      mainPaneMode: 'conversation',
      activeDirectoryId: 'dir-fallback',
      activeConversationId: 'session-a',
      conversations,
      directoriesHas: (directoryId) => directoryId === 'dir-a' || directoryId === 'dir-fallback',
    }),
    'dir-a',
  );
  assert.equal(
    resolveDirectoryForAction({
      mainPaneMode: 'conversation',
      activeDirectoryId: 'dir-fallback',
      activeConversationId: 'session-null',
      conversations,
      directoriesHas: (directoryId) => directoryId === 'dir-fallback',
    }),
    'dir-fallback',
  );
  assert.equal(
    resolveDirectoryForAction({
      mainPaneMode: 'conversation',
      activeDirectoryId: null,
      activeConversationId: 'session-a',
      conversations,
      directoriesHas: () => false,
    }),
    null,
  );
  assert.equal(
    resolveDirectoryForAction({
      mainPaneMode: 'home',
      activeDirectoryId: null,
      activeConversationId: 'missing',
      conversations,
      directoriesHas: () => true,
    }),
    null,
  );
});

void test('handleHomePaneDragRelease handles task/repository reorder and early exits', () => {
  const calls: string[] = [];
  assert.equal(
    handleHomePaneDragRelease({
      homePaneDragState: null,
      isMouseRelease: true,
      mainPaneMode: 'home',
      target: 'right',
      rowIndex: 1,
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => null,
      reorderTaskByDrop: () => {
        calls.push('reorderTaskByDrop');
      },
      reorderRepositoryByDrop: () => {
        calls.push('reorderRepositoryByDrop');
      },
      setHomePaneDragState: () => {
        calls.push('setHomePaneDragState');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(calls.length, 0);

  assert.equal(
    handleHomePaneDragRelease({
      homePaneDragState: {
        kind: 'task',
        itemId: 'task-a',
        startedRowIndex: 0,
        latestRowIndex: 1,
        hasDragged: true,
      },
      isMouseRelease: true,
      mainPaneMode: 'home',
      target: 'right',
      rowIndex: 4,
      taskIdAtRow: () => 'task-b',
      repositoryIdAtRow: () => null,
      reorderTaskByDrop: (dragged, target) => {
        calls.push(`task:${dragged}->${target}`);
      },
      reorderRepositoryByDrop: () => {
        calls.push('reorderRepositoryByDrop');
      },
      setHomePaneDragState: () => {
        calls.push('setHomePaneDragState');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.deepEqual(calls, ['setHomePaneDragState', 'task:task-a->task-b', 'markDirty']);

  calls.length = 0;
  assert.equal(
    handleHomePaneDragRelease({
      homePaneDragState: {
        kind: 'repository',
        itemId: 'repo-a',
        startedRowIndex: 0,
        latestRowIndex: 1,
        hasDragged: true,
      },
      isMouseRelease: true,
      mainPaneMode: 'home',
      target: 'right',
      rowIndex: 2,
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => 'repo-b',
      reorderTaskByDrop: () => {
        calls.push('reorderTaskByDrop');
      },
      reorderRepositoryByDrop: (dragged, target) => {
        calls.push(`repo:${dragged}->${target}`);
      },
      setHomePaneDragState: () => {
        calls.push('setHomePaneDragState');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.deepEqual(calls, ['setHomePaneDragState', 'repo:repo-a->repo-b', 'markDirty']);

  calls.length = 0;
  assert.equal(
    handleHomePaneDragRelease({
      homePaneDragState: {
        kind: 'task',
        itemId: 'task-a',
        startedRowIndex: 0,
        latestRowIndex: 1,
        hasDragged: false,
      },
      isMouseRelease: true,
      mainPaneMode: 'project',
      target: 'left',
      rowIndex: 0,
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => null,
      reorderTaskByDrop: () => {
        calls.push('reorderTaskByDrop');
      },
      reorderRepositoryByDrop: () => {
        calls.push('reorderRepositoryByDrop');
      },
      setHomePaneDragState: () => {
        calls.push('setHomePaneDragState');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.deepEqual(calls, ['setHomePaneDragState', 'markDirty']);
});

void test('handleProjectPaneActionClick routes new-thread and close actions', () => {
  const calls: string[] = [];
  assert.equal(
    handleProjectPaneActionClick({
      clickEligible: false,
      snapshot: {
        directoryId: 'dir-a',
      },
      rightCols: 100,
      paneRows: 20,
      projectPaneScrollTop: 0,
      rowIndex: 1,
      projectPaneActionAtRow: () => 'conversation.new',
      openNewThreadPrompt: () => {
        calls.push('openNewThreadPrompt');
      },
      queueCloseDirectory: () => {
        calls.push('queueCloseDirectory');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(
    handleProjectPaneActionClick({
      clickEligible: true,
      snapshot: {
        directoryId: 'dir-a',
      },
      rightCols: 100,
      paneRows: 20,
      projectPaneScrollTop: 0,
      rowIndex: 1,
      projectPaneActionAtRow: () => 'conversation.new',
      openNewThreadPrompt: (directoryId) => {
        calls.push(`openNewThreadPrompt:${directoryId}`);
      },
      queueCloseDirectory: (directoryId) => {
        calls.push(`queueCloseDirectory:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handleProjectPaneActionClick({
      clickEligible: true,
      snapshot: {
        directoryId: 'dir-a',
      },
      rightCols: 100,
      paneRows: 20,
      projectPaneScrollTop: 0,
      rowIndex: 1,
      projectPaneActionAtRow: () => 'project.close',
      openNewThreadPrompt: (directoryId) => {
        calls.push(`openNewThreadPrompt:${directoryId}`);
      },
      queueCloseDirectory: (directoryId) => {
        calls.push(`queueCloseDirectory:${directoryId}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handleProjectPaneActionClick({
      clickEligible: true,
      snapshot: {
        directoryId: 'dir-a',
      },
      rightCols: 100,
      paneRows: 20,
      projectPaneScrollTop: 0,
      rowIndex: 1,
      projectPaneActionAtRow: () => null,
      openNewThreadPrompt: () => {
        calls.push('openNewThreadPrompt');
      },
      queueCloseDirectory: () => {
        calls.push('queueCloseDirectory');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(
    handleProjectPaneActionClick({
      clickEligible: true,
      snapshot: {
        directoryId: 'dir-a',
      },
      rightCols: 100,
      paneRows: 20,
      projectPaneScrollTop: 0,
      rowIndex: 1,
      projectPaneActionAtRow: () => 'project.github.toggle:github/open-threads',
      openNewThreadPrompt: () => {
        calls.push('openNewThreadPrompt');
      },
      queueCloseDirectory: () => {
        calls.push('queueCloseDirectory');
      },
      handleProjectPaneAction: (action, directoryId) => {
        calls.push(`handleProjectPaneAction:${action}:${directoryId}`);
        return true;
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    true,
  );
  assert.equal(
    handleProjectPaneActionClick({
      clickEligible: true,
      snapshot: {
        directoryId: 'dir-a',
      },
      rightCols: 100,
      paneRows: 20,
      projectPaneScrollTop: 0,
      rowIndex: 1,
      projectPaneActionAtRow: () => 'project.github.toggle:github/resolved-threads',
      openNewThreadPrompt: () => {
        calls.push('openNewThreadPrompt');
      },
      queueCloseDirectory: () => {
        calls.push('queueCloseDirectory');
      },
      handleProjectPaneAction: (action, directoryId) => {
        calls.push(`handleProjectPaneAction:${action}:${directoryId}`);
        return false;
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.deepEqual(calls, [
    'openNewThreadPrompt:dir-a',
    'markDirty',
    'queueCloseDirectory:dir-a',
    'markDirty',
    'handleProjectPaneAction:project.github.toggle:github/open-threads:dir-a',
    'markDirty',
    'handleProjectPaneAction:project.github.toggle:github/resolved-threads:dir-a',
  ]);
});

void test('requestStop flushes buffers and optionally queues best-effort live session shutdown', async () => {
  const calls: string[] = [];
  assert.equal(
    requestStop({
      stop: true,
      hasConversationTitleEdit: false,
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      activeTaskEditorTaskId: null,
      autosaveTaskIds: [],
      flushTaskComposerPersist: () => {
        calls.push('flushTaskComposerPersist');
      },
      closeLiveSessionsOnClientStop: false,
      orderedConversationIds: [],
      conversations: new Map(),
      queueControlPlaneOp: () => {
        calls.push('queueControlPlaneOp');
      },
      sendSignal: () => {
        calls.push('sendSignal');
      },
      closeSession: async () => {
        calls.push('closeSession');
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setStop: () => {
        calls.push('setStop');
      },
    }),
    false,
  );
  assert.equal(calls.length, 0);

  let queuedTask: (() => Promise<void>) | null = null;
  const conversations = new Map([
    ['session-live', { live: true }],
    ['session-dead', { live: false }],
    ['session-missing', { live: true }],
  ]);
  assert.equal(
    requestStop({
      stop: false,
      hasConversationTitleEdit: true,
      stopConversationTitleEdit: () => {
        calls.push('stopConversationTitleEdit');
      },
      activeTaskEditorTaskId: 'task-active',
      autosaveTaskIds: ['task-a', 'task-b'],
      flushTaskComposerPersist: (taskId) => {
        calls.push(`flush:${taskId}`);
      },
      closeLiveSessionsOnClientStop: true,
      orderedConversationIds: ['session-live', 'session-dead', 'session-missing'],
      conversations,
      queueControlPlaneOp: (task, label) => {
        calls.push(`queueControlPlaneOp:${label}`);
        queuedTask = task;
      },
      sendSignal: (sessionId, signal) => {
        calls.push(`signal:${sessionId}:${signal}`);
      },
      closeSession: async (sessionId) => {
        calls.push(`closeSession:${sessionId}`);
        if (sessionId === 'session-live') {
          throw new Error('best effort');
        }
      },
      markDirty: () => {
        calls.push('markDirty');
      },
      setStop: (next) => {
        calls.push(`setStop:${String(next)}`);
      },
    }),
    true,
  );
  await (
    queuedTask ??
    (async () => {
      assert.fail('expected queued shutdown task');
    })
  )();
  assert.deepEqual(calls, [
    'stopConversationTitleEdit',
    'flush:task-active',
    'flush:task-a',
    'flush:task-b',
    'setStop:true',
    'queueControlPlaneOp:shutdown-close-live-sessions',
    'markDirty',
    'signal:session-live:interrupt',
    'signal:session-live:terminate',
    'closeSession:session-live',
    'signal:session-missing:interrupt',
    'signal:session-missing:terminate',
    'closeSession:session-missing',
  ]);
});

void test('refreshProcessUsageSnapshots updates changed sessions and trims stale entries', async () => {
  const processUsageBySessionId = new Map<string, number>([
    ['session-old', 1],
    ['session-stale', 99],
  ]);
  const firstResult = await refreshProcessUsageSnapshots({
    conversations: new Map([
      ['session-old', { processId: 7 }],
      ['session-new', { processId: 8 }],
    ]),
    processUsageBySessionId,
    readProcessUsageSample: async (processId) => (processId ?? 0) * 10,
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: (left, right) => left === right,
  });
  assert.deepEqual(firstResult, {
    samples: 2,
    changed: true,
  });
  assert.deepEqual([...processUsageBySessionId.entries()].sort(), [
    ['session-new', 80],
    ['session-old', 70],
  ]);

  const secondResult = await refreshProcessUsageSnapshots({
    conversations: new Map([
      ['session-old', { processId: 7 }],
      ['session-new', { processId: 8 }],
    ]),
    processUsageBySessionId,
    readProcessUsageSample: async (processId) => (processId ?? 0) * 10,
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: (left, right) => left === right,
  });
  assert.deepEqual(secondResult, {
    samples: 2,
    changed: false,
  });
});

void test('handleHomePaneActionClick applies all action branches and no-op ids', () => {
  const calls: string[] = [];
  assert.equal(
    handleHomePaneActionClick({
      action: null,
      rowIndex: 0,
      clearTaskEditClickState: () => {
        calls.push('clearTaskEditClickState');
      },
      clearRepositoryEditClickState: () => {
        calls.push('clearRepositoryEditClickState');
      },
      clearHomePaneDragState: () => {
        calls.push('clearHomePaneDragState');
      },
      getTaskRepositoryDropdownOpen: () => false,
      setTaskRepositoryDropdownOpen: (open) => {
        calls.push(`setTaskRepositoryDropdownOpen:${String(open)}`);
      },
      taskIdAtRow: () => null,
      repositoryIdAtRow: () => null,
      selectTaskById: (taskId) => {
        calls.push(`selectTaskById:${taskId}`);
      },
      selectRepositoryById: (repositoryId) => {
        calls.push(`selectRepositoryById:${repositoryId}`);
      },
      runTaskPaneAction: (action) => {
        calls.push(`runTaskPaneAction:${action}`);
      },
      markDirty: () => {
        calls.push('markDirty');
      },
    }),
    false,
  );
  assert.equal(calls.length, 0);

  const actionCases: Array<{
    action: string;
    rowIndex: number;
    taskId: string | null;
    repositoryId: string | null;
  }> = [
    { action: 'repository.dropdown.toggle', rowIndex: 0, taskId: null, repositoryId: null },
    { action: 'repository.select', rowIndex: 1, taskId: null, repositoryId: 'repo-a' },
    { action: 'repository.select', rowIndex: 2, taskId: null, repositoryId: null },
    { action: 'task.focus', rowIndex: 3, taskId: 'task-focus', repositoryId: null },
    { action: 'task.focus', rowIndex: 4, taskId: null, repositoryId: null },
    { action: 'task.status.ready', rowIndex: 5, taskId: 'task-ready', repositoryId: null },
    { action: 'task.status.draft', rowIndex: 6, taskId: 'task-draft', repositoryId: null },
    { action: 'task.status.complete', rowIndex: 7, taskId: 'task-complete', repositoryId: null },
    { action: 'unknown-action', rowIndex: 8, taskId: null, repositoryId: null },
  ];
  for (const actionCase of actionCases) {
    assert.equal(
      handleHomePaneActionClick({
        action: actionCase.action,
        rowIndex: actionCase.rowIndex,
        clearTaskEditClickState: () => {
          calls.push('clearTaskEditClickState');
        },
        clearRepositoryEditClickState: () => {
          calls.push('clearRepositoryEditClickState');
        },
        clearHomePaneDragState: () => {
          calls.push('clearHomePaneDragState');
        },
        getTaskRepositoryDropdownOpen: () => false,
        setTaskRepositoryDropdownOpen: (open) => {
          calls.push(`setTaskRepositoryDropdownOpen:${String(open)}`);
        },
        taskIdAtRow: () => actionCase.taskId,
        repositoryIdAtRow: () => actionCase.repositoryId,
        selectTaskById: (taskId) => {
          calls.push(`selectTaskById:${taskId}`);
        },
        selectRepositoryById: (repositoryId) => {
          calls.push(`selectRepositoryById:${repositoryId}`);
        },
        runTaskPaneAction: (action) => {
          calls.push(`runTaskPaneAction:${action}`);
        },
        markDirty: () => {
          calls.push('markDirty');
        },
      }),
      true,
    );
  }
  assert.equal(calls.includes('setTaskRepositoryDropdownOpen:true'), true);
  assert.equal(calls.includes('selectRepositoryById:repo-a'), true);
  assert.equal(calls.includes('selectTaskById:task-focus'), true);
  assert.equal(calls.includes('runTaskPaneAction:task.ready'), true);
  assert.equal(calls.includes('runTaskPaneAction:task.draft'), true);
  assert.equal(calls.includes('runTaskPaneAction:task.complete'), true);
});

void test('routeInputTokensForConversation forwards keyboard input and accumulates wheel scroll on right pane', () => {
  const routedConversation = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'passthrough',
        text: 'echo hello\n',
      },
      {
        kind: 'passthrough',
        text: '',
      },
      {
        kind: 'mouse',
        event: {
          col: 15,
          row: 3,
          code: 64,
          final: 'M',
        },
      },
      {
        kind: 'mouse',
        event: {
          col: 2,
          row: 3,
          code: 64,
          final: 'M',
        },
      },
      {
        kind: 'mouse',
        event: {
          col: 15,
          row: 3,
          code: 0,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) =>
      Buffer.from(input.toString('utf8').toUpperCase(), 'utf8'),
    classifyPaneAt: (col) => (col >= 10 ? 'right' : 'left'),
    wheelDeltaRowsFromCode: (code) => (code === 64 ? 2 : null),
    hasShiftModifier: (code) => (code & 0b0000_0100) !== 0,
    layout: {
      paneRows: 24,
      rightCols: 70,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'primary',
      viewport: {
        top: 0,
        totalRows: 24,
        followOutput: true,
      },
    },
    appMouseTrackingEnabled: false,
  });
  assert.equal(routedConversation.mainPaneScrollRows, 2);
  assert.deepEqual(
    routedConversation.forwardToSession.map((chunk) => chunk.toString('utf8')),
    ['ECHO HELLO\n'],
  );

  const routedProject = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'passthrough',
        text: 'ignored',
      },
      {
        kind: 'mouse',
        event: {
          col: 15,
          row: 3,
          code: 64,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'project',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: () => 1,
    hasShiftModifier: () => false,
    layout: {
      paneRows: 24,
      rightCols: 70,
      rightStartCol: 10,
    },
    snapshotForInput: null,
    appMouseTrackingEnabled: false,
  });
  assert.equal(routedProject.mainPaneScrollRows, 0);
  assert.equal(routedProject.forwardToSession.length, 0);
});

void test('routeInputTokensForConversation consumes command-click mouse events through meta click handler', () => {
  const calls: string[] = [];
  const routed = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 12,
          row: 5,
          code: 0b0000_1000,
          final: 'M',
        },
      },
      {
        kind: 'mouse',
        event: {
          col: 12,
          row: 5,
          code: 0,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: () => null,
    hasShiftModifier: () => false,
    hasMetaModifier: (code) => (code & 0b0000_1000) !== 0,
    handleMetaClick: ({ event }) => {
      calls.push(`meta-click:${event.col}:${event.row}`);
      return true;
    },
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'primary',
      viewport: {
        top: 0,
        totalRows: 20,
        followOutput: true,
      },
    },
    appMouseTrackingEnabled: false,
  });
  assert.deepEqual(calls, ['meta-click:12:5']);
  assert.equal(routed.mainPaneScrollRows, 0);
  assert.equal(routed.forwardToSession.length, 0);
});

void test('routeInputTokensForConversation covers meta-click button guard branches', () => {
  const calls: string[] = [];
  const routed = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 12,
          row: 5,
          code: 0b0000_1000,
          final: 'M',
        },
      },
      {
        kind: 'mouse',
        event: {
          col: 12,
          row: 5,
          code: 0b0100_1000,
          final: 'M',
        },
      },
      {
        kind: 'mouse',
        event: {
          col: 12,
          row: 5,
          code: 0b0000_1000,
          final: 'm',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: () => null,
    hasShiftModifier: () => false,
    handleMetaClick: ({ event }) => {
      calls.push(`meta-click:${event.code}:${event.final}`);
      return true;
    },
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'primary',
      viewport: {
        top: 0,
        totalRows: 20,
        followOutput: true,
      },
    },
    appMouseTrackingEnabled: false,
  });
  assert.deepEqual(calls, ['meta-click:8:M']);
  assert.equal(routed.mainPaneScrollRows, 0);
  assert.equal(routed.forwardToSession.length, 0);
});

void test('routeInputTokensForConversation forwards right-pane mouse input when app mouse mode is active', () => {
  const routed = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 12,
          row: 5,
          code: 0,
          final: 'M',
        },
      },
      {
        kind: 'mouse',
        event: {
          col: 17,
          row: 6,
          code: 64,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: (code) => (code === 64 ? 2 : null),
    hasShiftModifier: () => false,
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'alternate',
      viewport: {
        top: 0,
        totalRows: 20,
        followOutput: true,
      },
    },
    appMouseTrackingEnabled: true,
  });
  assert.equal(routed.mainPaneScrollRows, 0);
  assert.deepEqual(
    routed.forwardToSession.map((chunk) => chunk.toString('utf8')),
    ['\u001b[<0;3;5M', '\u001b[<64;8;6M'],
  );
});

void test('routeInputTokensForConversation keeps local scrollback controls when forced-local or viewport is pinned', () => {
  const shifted = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 17,
          row: 6,
          code: 68,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: (code) => (code === 68 ? 2 : null),
    hasShiftModifier: (code) => (code & 0b0000_0100) !== 0,
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'alternate',
      viewport: {
        top: 0,
        totalRows: 20,
        followOutput: true,
      },
    },
    appMouseTrackingEnabled: true,
  });
  assert.equal(shifted.mainPaneScrollRows, 2);
  assert.equal(shifted.forwardToSession.length, 0);

  const pinnedScrollback = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 17,
          row: 6,
          code: 64,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: (code) => (code === 64 ? 2 : null),
    hasShiftModifier: () => false,
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'alternate',
      viewport: {
        top: 0,
        totalRows: 20,
        followOutput: false,
      },
    },
    appMouseTrackingEnabled: true,
  });
  assert.equal(pinnedScrollback.mainPaneScrollRows, 2);
  assert.equal(pinnedScrollback.forwardToSession.length, 0);

  const noSnapshot = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 17,
          row: 6,
          code: 64,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: (code) => (code === 64 ? 2 : null),
    hasShiftModifier: () => false,
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: null,
    appMouseTrackingEnabled: true,
  });
  assert.equal(noSnapshot.mainPaneScrollRows, 2);
  assert.equal(noSnapshot.forwardToSession.length, 0);

  const primaryScreen = routeInputTokensForConversation({
    tokens: [
      {
        kind: 'mouse',
        event: {
          col: 17,
          row: 6,
          code: 64,
          final: 'M',
        },
      },
    ],
    mainPaneMode: 'conversation',
    normalizeMuxKeyboardInputForPty: (input) => input,
    classifyPaneAt: () => 'right',
    wheelDeltaRowsFromCode: (code) => (code === 64 ? 2 : null),
    hasShiftModifier: () => false,
    layout: {
      paneRows: 20,
      rightCols: 40,
      rightStartCol: 10,
    },
    snapshotForInput: {
      activeScreen: 'primary',
      viewport: {
        top: 0,
        totalRows: 20,
        followOutput: true,
      },
    },
    appMouseTrackingEnabled: true,
  });
  assert.equal(primaryScreen.mainPaneScrollRows, 2);
  assert.equal(primaryScreen.forwardToSession.length, 0);
});

void test('dismissModalOnOutsideClick handles no-escape, null-overlay, and pointer-press routing', () => {
  const noEscape = dismissModalOnOutsideClick({
    input: Buffer.from('plain text', 'utf8'),
    inputRemainder: '',
    dismiss: () => {
      throw new Error('unreachable');
    },
    buildCurrentModalOverlay: () => null,
    isOverlayHit: () => true,
  });
  assert.deepEqual(noEscape, {
    handled: false,
    inputRemainder: '',
  });

  const nullOverlay = dismissModalOnOutsideClick({
    input: Buffer.from('\u001b[<0;10;5M', 'utf8'),
    inputRemainder: '',
    dismiss: () => {
      throw new Error('unreachable');
    },
    buildCurrentModalOverlay: () => null,
    isOverlayHit: () => true,
  });
  assert.equal(nullOverlay.handled, true);

  let dismissed = false;
  const overlay = {
    left: 1,
    top: 1,
    width: 10,
    height: 5,
    rows: [''],
  };
  const outside = dismissModalOnOutsideClick({
    input: Buffer.from('\u001b[<0;10;5M', 'utf8'),
    inputRemainder: '',
    dismiss: () => {
      dismissed = true;
    },
    buildCurrentModalOverlay: () => overlay,
    isOverlayHit: () => false,
  });
  assert.equal(outside.handled, true);
  assert.equal(dismissed, true);

  dismissed = false;
  const inside = dismissModalOnOutsideClick({
    input: Buffer.from('\u001b[<0;10;5M', 'utf8'),
    inputRemainder: '',
    dismiss: () => {
      dismissed = true;
    },
    buildCurrentModalOverlay: () => overlay,
    onInsidePointerPress: () => true,
    isOverlayHit: () => true,
  });
  assert.equal(inside.handled, true);
  assert.equal(dismissed, false);

  const nonPress = dismissModalOnOutsideClick({
    input: Buffer.from('\u001b[<64;10;5M', 'utf8'),
    inputRemainder: '',
    dismiss: () => {
      dismissed = true;
    },
    buildCurrentModalOverlay: () => overlay,
    isOverlayHit: () => true,
  });
  assert.equal(nonPress.handled, true);

  const insideNotConsumed = dismissModalOnOutsideClick({
    input: Buffer.from('\u001b[<0;10;5M', 'utf8'),
    inputRemainder: '',
    dismiss: () => {
      dismissed = true;
    },
    buildCurrentModalOverlay: () => overlay,
    onInsidePointerPress: () => false,
    isOverlayHit: () => true,
  });
  assert.equal(insideNotConsumed.handled, true);
});

void test('left-nav helpers build stable target keys and dedupe visible targets', () => {
  assert.equal(leftNavTargetKey({ kind: 'home' }), 'home');
  assert.equal(leftNavTargetKey({ kind: 'tasks' }), 'tasks');
  assert.equal(
    leftNavTargetKey({ kind: 'repository', repositoryId: 'repo-a' }),
    'repository:repo-a',
  );
  assert.equal(leftNavTargetKey({ kind: 'project', directoryId: 'dir-a' }), 'directory:dir-a');
  assert.equal(
    leftNavTargetKey({ kind: 'conversation', sessionId: 'session-a' }),
    'conversation:session-a',
  );
  assert.equal(leftNavTargetKey({ kind: 'github', directoryId: 'dir-a' }), 'github:dir-a');

  const rows = [
    {
      kind: 'dir-header',
      text: 'home',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'home.open',
      conversationStatus: null,
    },
    {
      kind: 'dir-header',
      text: 'tasks',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'tasks.open',
      conversationStatus: null,
    },
    {
      kind: 'repository-header',
      text: 'repo',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: 'repo-a',
      railAction: null,
      conversationStatus: null,
    },
    {
      kind: 'repository-header',
      text: 'repo duplicate',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: 'repo-a',
      railAction: null,
      conversationStatus: null,
    },
    {
      kind: 'dir-header',
      text: 'project',
      active: false,
      conversationSessionId: null,
      directoryKey: 'dir-a',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    {
      kind: 'github-header',
      text: 'github',
      active: false,
      conversationSessionId: null,
      directoryKey: 'dir-a',
      repositoryId: null,
      railAction: 'project.github.open',
      conversationStatus: null,
    },
    {
      kind: 'conversation-title',
      text: 'thread',
      active: false,
      conversationSessionId: 'session-a',
      directoryKey: 'dir-a',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
    {
      kind: 'conversation-title',
      text: 'thread missing id',
      active: false,
      conversationSessionId: null,
      directoryKey: 'dir-a',
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    },
  ] as unknown as Array<Record<string, unknown>>;
  rows[8] = {
    kind: 'muted',
    text: 'gap filler',
    active: false,
    conversationSessionId: null,
    directoryKey: null,
    repositoryId: null,
    railAction: null,
    conversationStatus: null,
  };
  rows[9] = {
    kind: 'muted',
    text: 'extra filler',
    active: false,
    conversationSessionId: null,
    directoryKey: null,
    repositoryId: null,
    railAction: null,
    conversationStatus: null,
  };

  assert.deepEqual(visibleLeftNavTargets(rows as unknown as RailRows), [
    { kind: 'home' },
    { kind: 'tasks' },
    { kind: 'repository', repositoryId: 'repo-a' },
    { kind: 'project', directoryId: 'dir-a' },
    { kind: 'github', directoryId: 'dir-a' },
    { kind: 'conversation', sessionId: 'session-a' },
  ]);

  const sparseRows = new Array(1) as unknown as RailRows;
  assert.deepEqual(visibleLeftNavTargets(sparseRows), []);
});

void test('handleLeftRailPointerClick applies title-edit, selection clear, action, and conversation branches', () => {
  const rows = [
    {
      kind: 'conversation-title',
      text: 'thread',
      active: false,
      conversationSessionId: 'session-a',
      directoryKey: 'dir-a',
      repositoryId: 'repo-a',
      railAction: null,
      conversationStatus: null,
    },
    {
      kind: 'action',
      text: 'add project',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'project.add',
      conversationStatus: null,
    },
  ] as unknown as RailRows;

  assert.equal(
    handleLeftRailPointerClick({
      clickEligible: false,
      rows,
      paneRows: 10,
      leftCols: 20,
      pointerRow: 1,
      pointerCol: 1,
      hasConversationTitleEdit: false,
      conversationTitleEditConversationId: null,
      stopConversationTitleEdit: () => {
        throw new Error('unreachable');
      },
      hasSelection: false,
      clearSelection: () => {
        throw new Error('unreachable');
      },
      handleAction: () => false,
      handleConversation: () => {
        throw new Error('unreachable');
      },
    }),
    false,
  );

  const actionCalls: string[] = [];
  assert.equal(
    handleLeftRailPointerClick({
      clickEligible: true,
      rows,
      paneRows: 10,
      leftCols: 20,
      pointerRow: 2,
      pointerCol: 1,
      hasConversationTitleEdit: true,
      conversationTitleEditConversationId: 'session-a',
      stopConversationTitleEdit: () => {
        actionCalls.push('stopConversationTitleEdit');
      },
      hasSelection: true,
      clearSelection: () => {
        actionCalls.push('clearSelection');
      },
      handleAction: (context) => {
        actionCalls.push(`handleAction:${context.selectedAction}`);
        return true;
      },
      handleConversation: () => {
        actionCalls.push('handleConversation');
      },
    }),
    true,
  );
  assert.deepEqual(actionCalls, [
    'stopConversationTitleEdit',
    'clearSelection',
    'handleAction:project.add',
  ]);

  const conversationCalls: string[] = [];
  assert.equal(
    handleLeftRailPointerClick({
      clickEligible: true,
      rows,
      paneRows: 10,
      leftCols: 20,
      pointerRow: 1,
      pointerCol: 1,
      hasConversationTitleEdit: true,
      conversationTitleEditConversationId: 'session-a',
      stopConversationTitleEdit: () => {
        conversationCalls.push('stopConversationTitleEdit');
      },
      hasSelection: false,
      clearSelection: () => {
        conversationCalls.push('clearSelection');
      },
      handleAction: (context) => {
        conversationCalls.push(`handleAction:${String(context.selectedAction)}`);
        assert.equal(context.supportsConversationTitleEditClick, true);
        return false;
      },
      handleConversation: (context) => {
        conversationCalls.push(`handleConversation:${context.selectedConversationId}`);
      },
    }),
    true,
  );
  assert.deepEqual(conversationCalls, ['handleAction:null', 'handleConversation:session-a']);
});
