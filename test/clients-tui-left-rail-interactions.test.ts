import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTuiLeftRailInteractions } from '../src/clients/tui/left-rail-interactions.ts';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { createTaskComposerBuffer } from '../src/mux/task-composer.ts';
import type { buildWorkspaceRailViewRows } from '../src/mux/workspace-rail-model.ts';

function emptyTaskPaneView() {
  return {
    rows: [],
    taskIds: [],
    repositoryIds: [],
    actions: [],
    actionCells: [],
    top: 0,
    selectedRepositoryId: null,
  };
}

void test('tui left-rail interactions wire debug-toggle shortcut through workspace ui state persistence', () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: { kind: 'home' },
    latestTaskPaneView: emptyTaskPaneView(),
    taskDraftComposer: createTaskComposerBuffer(),
    repositoriesCollapsed: false,
  });

  let markDirtyCalls = 0;
  let persistCalls = 0;

  const interactions = createTuiLeftRailInteractions({
    workspace,
    railViewState: {
      readLatestRows: () => [] as ReturnType<typeof buildWorkspaceRailViewRows>,
    },
    directories: new Map([
      [
        'dir-1',
        {
          directoryId: 'dir-1',
        },
      ],
    ]),
    conversationRecords: new Map(),
    repositories: new Map(),
    conversationLookup: {
      activeConversationId: null,
      has: () => false,
      directoryIdOf: () => null,
    },
    directoryLookup: {
      hasDirectory: () => true,
    },
    repositoryManager: {
      repositoryGroupIdForDirectory: () => 'repo-1',
      collapseRepositoryGroup: () => {},
      expandRepositoryGroup: () => {},
      toggleRepositoryGroup: () => {},
      collapseAllRepositoryGroups: () => true,
      expandAllRepositoryGroups: () => false,
    },
    repositoryGroupFallbackId: 'untracked',
    queueControlPlaneOps: {
      queueControlPlaneOp: () => {
        throw new Error('unexpected queued op for debug toggle');
      },
      queueLatestControlPlaneOp: () => {
        throw new Error('unexpected queued latest op for debug toggle');
      },
    },
    conversationLifecycle: {
      activateConversation: async () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      takeoverConversation: async () => {},
      beginConversationTitleEdit: () => {},
      stopConversationTitleEdit: () => {},
    },
    runtimeDirectoryActions: {
      archiveConversation: async () => {},
      closeDirectory: async () => {},
    },
    runtimeRepositoryActions: {
      openRepositoryPromptForCreate: () => {},
      openRepositoryPromptForEdit: () => {},
      archiveRepositoryById: async () => {},
    },
    runtimeControlActions: {
      toggleGatewayProfiler: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      refreshAllConversationTitles: async () => {},
      interruptConversation: async () => {},
    },
    navigation: {
      enterHomePane: () => {},
      enterProjectPane: () => {},
      resolveDirectoryForAction: () => null,
      openNewThreadPrompt: () => {},
      toggleCommandMenu: () => {},
      requestStop: () => {},
      markDirty: () => {
        markDirtyCalls += 1;
      },
      queuePersistMuxUiState: () => {
        persistCalls += 1;
      },
      resetFrameCache: () => {},
      releaseViewportPinForSelection: () => {},
    },
    shortcutBindings: resolveMuxShortcutBindings({
      'mux.debug-bar.toggle': ['ctrl+g'],
    }),
    showTasksEntry: false,
  });

  const handled = interactions.handleGlobalShortcutInput(Buffer.from([0x07]));
  assert.equal(handled, true);
  assert.equal(workspace.showDebugBar, true);
  assert.equal(persistCalls, 1);
  assert.equal(markDirtyCalls, 1);
});

void test('tui left-rail interactions drive repository fold, global shortcuts, and pointer dispatch paths', async () => {
  const workspace = new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: { kind: 'repository', repositoryId: 'repo-1' },
    latestTaskPaneView: emptyTaskPaneView(),
    taskDraftComposer: createTaskComposerBuffer(),
    repositoriesCollapsed: false,
  });
  workspace.mainPaneMode = 'home';
  workspace.selection = {
    anchor: { rowAbs: 0, col: 0 },
    focus: { rowAbs: 0, col: 2 },
    text: 'sel',
  };
  workspace.conversationTitleEdit = {
    conversationId: 'session-1',
    value: 'session-1',
    lastSavedValue: 'session-1',
    error: null,
    persistInFlight: false,
    debounceTimer: null,
  };

  const calls: string[] = [];
  const queued: Promise<void>[] = [];
  let useConversationRow = false;
  let actionRowKind: 'repository.edit' | 'project.close' = 'repository.edit';

  const interactions = createTuiLeftRailInteractions({
    workspace,
    railViewState: {
      readLatestRows: () => {
        if (useConversationRow) {
          return [
            {
              kind: 'conversation-title',
              text: 'session-1',
              active: false,
              conversationSessionId: 'session-1',
              directoryKey: 'dir-1',
              repositoryId: null,
              railAction: null,
              conversationStatus: null,
            },
          ] as ReturnType<typeof buildWorkspaceRailViewRows>;
        }
        return [
          {
            kind: 'action',
            text: actionRowKind === 'repository.edit' ? 'repository edit' : 'project close',
            active: false,
            conversationSessionId: null,
            directoryKey: 'dir-1',
            repositoryId: 'repo-1',
            railAction: actionRowKind,
            conversationStatus: null,
          },
        ] as ReturnType<typeof buildWorkspaceRailViewRows>;
      },
    },
    directories: new Map([
      [
        'dir-1',
        {
          directoryId: 'dir-1',
        },
      ],
    ]),
    conversationRecords: new Map([
      [
        'session-1',
        {
          directoryId: 'dir-1',
          agentType: 'codex',
        },
      ],
    ]),
    repositories: new Map([['repo-1', {}]]),
    conversationLookup: {
      activeConversationId: 'session-1',
      has: (sessionId) => sessionId === 'session-1',
      directoryIdOf: (sessionId) => (sessionId === 'session-1' ? 'dir-1' : null),
    },
    directoryLookup: {
      hasDirectory: (directoryId) => directoryId === 'dir-1',
    },
    repositoryManager: {
      repositoryGroupIdForDirectory: () => 'repo-1',
      collapseRepositoryGroup: (repositoryGroupId) => {
        calls.push(`collapse:${repositoryGroupId}`);
      },
      expandRepositoryGroup: (repositoryGroupId) => {
        calls.push(`expand:${repositoryGroupId}`);
      },
      toggleRepositoryGroup: (repositoryGroupId) => {
        calls.push(`toggle:${repositoryGroupId}`);
      },
      collapseAllRepositoryGroups: () => {
        calls.push('collapse-all');
        return true;
      },
      expandAllRepositoryGroups: () => {
        calls.push('expand-all');
        return false;
      },
    },
    repositoryGroupFallbackId: 'untracked',
    queueControlPlaneOps: {
      queueControlPlaneOp: (task, label) => {
        calls.push(`queue:${label}`);
        queued.push(task());
      },
      queueLatestControlPlaneOp: (_key, task, label) => {
        calls.push(`queue-latest:${label}`);
        queued.push(task({ signal: new AbortController().signal }));
      },
    },
    conversationLifecycle: {
      activateConversation: async (sessionId) => {
        calls.push(`activate:${sessionId}`);
      },
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        calls.push(`critique:${directoryId}`);
      },
      takeoverConversation: async (sessionId) => {
        calls.push(`takeover:${sessionId}`);
      },
      beginConversationTitleEdit: (conversationId) => {
        calls.push(`begin-edit:${conversationId}`);
      },
      stopConversationTitleEdit: (persistPending) => {
        calls.push(`stop-edit:${persistPending ? 'true' : 'false'}`);
        workspace.conversationTitleEdit = null;
      },
    },
    runtimeDirectoryActions: {
      archiveConversation: async (sessionId) => {
        calls.push(`archive:${sessionId}`);
      },
      closeDirectory: async (directoryId) => {
        calls.push(`close:${directoryId}`);
      },
    },
    runtimeRepositoryActions: {
      openRepositoryPromptForCreate: () => {
        calls.push('repo-create');
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        calls.push(`repo-edit:${repositoryId}`);
      },
      archiveRepositoryById: async (repositoryId) => {
        calls.push(`repo-archive:${repositoryId}`);
      },
    },
    runtimeControlActions: {
      toggleGatewayProfiler: async () => {
        calls.push('toggle-profile');
      },
      toggleGatewayStatusTimeline: async () => {
        calls.push('toggle-status-timeline');
      },
      toggleGatewayRenderTrace: async (conversationId) => {
        calls.push(`toggle-render-trace:${conversationId ?? 'null'}`);
      },
      refreshAllConversationTitles: async () => {
        calls.push('refresh-titles');
      },
      interruptConversation: async (sessionId) => {
        calls.push(`interrupt:${sessionId}`);
      },
    },
    navigation: {
      enterHomePane: () => {
        calls.push('enter-home');
      },
      enterProjectPane: (directoryId) => {
        calls.push(`enter-project:${directoryId}`);
      },
      enterTasksPane: () => {
        calls.push('enter-tasks');
      },
      resolveDirectoryForAction: () => 'dir-1',
      openNewThreadPrompt: (directoryId) => {
        calls.push(`new-thread:${directoryId}`);
      },
      toggleCommandMenu: () => {
        calls.push('toggle-command-menu');
      },
      requestStop: () => {
        calls.push('request-stop');
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
      queuePersistMuxUiState: () => {
        calls.push('persist-ui');
      },
      resetFrameCache: () => {
        calls.push('reset-frame-cache');
      },
      releaseViewportPinForSelection: () => {
        calls.push('release-selection-pin');
      },
    },
    shortcutBindings: resolveMuxShortcutBindings({
      'mux.command-menu.toggle': ['m'],
      'mux.gateway.profile.toggle': ['p'],
      'mux.gateway.status-timeline.toggle': ['t'],
      'mux.gateway.render-trace.toggle': ['r'],
      'mux.conversation.new': ['n'],
      'mux.conversation.critique.open-or-create': ['k'],
      'mux.conversation.next': [']'],
      'mux.conversation.previous': ['['],
      'mux.conversation.titles.refresh-all': ['f'],
      'mux.conversation.interrupt': ['i'],
      'mux.conversation.archive': ['a'],
      'mux.conversation.takeover': ['o'],
      'mux.directory.add': ['d'],
      'mux.directory.close': ['c'],
    }),
    showTasksEntry: true,
    nowMs: () => 1000,
  });

  assert.equal(interactions.handleRepositoryFoldInput(Buffer.from('\u001b[C', 'utf8')), true);
  assert.equal(interactions.handleRepositoryFoldInput(Buffer.from('\u001b[D', 'utf8')), true);
  assert.equal(interactions.handleRepositoryFoldInput(Buffer.from([0x0b])), true);
  assert.equal(interactions.handleRepositoryFoldInput(Buffer.from([0x0a])), true);

  workspace.mainPaneMode = 'conversation';
  workspace.leftNavSelection = {
    kind: 'conversation',
    sessionId: 'session-1',
  };
  for (const key of ['m', 'p', 't', 'r', 'n', 'k', ']', '[', 'f', 'i', 'a', 'o', 'd', 'c']) {
    assert.equal(interactions.handleGlobalShortcutInput(Buffer.from(key, 'utf8')), true);
  }
  workspace.mainPaneMode = 'home';
  workspace.leftNavSelection = {
    kind: 'repository',
    repositoryId: 'repo-1',
  };

  assert.equal(
    interactions.leftRailPointerInput.handlePointerClick({
      clickEligible: true,
      paneRows: 20,
      leftCols: 40,
      pointerRow: 1,
      pointerCol: 1,
    }),
    true,
  );
  actionRowKind = 'project.close';
  assert.equal(
    interactions.leftRailPointerInput.handlePointerClick({
      clickEligible: true,
      paneRows: 20,
      leftCols: 40,
      pointerRow: 1,
      pointerCol: 1,
    }),
    true,
  );

  useConversationRow = true;
  assert.equal(
    interactions.leftRailPointerInput.handlePointerClick({
      clickEligible: true,
      paneRows: 20,
      leftCols: 40,
      pointerRow: 1,
      pointerCol: 1,
    }),
    true,
  );
  assert.equal(
    interactions.leftRailPointerInput.handlePointerClick({
      clickEligible: true,
      paneRows: 20,
      leftCols: 40,
      pointerRow: 1,
      pointerCol: 1,
    }),
    true,
  );

  while (queued.length > 0) {
    const next = queued.shift();
    if (next !== undefined) {
      await next;
    }
  }

  assert.equal(calls.includes('repo-edit:repo-1'), true);
  assert.equal(calls.includes('toggle-command-menu'), true);
  assert.equal(calls.includes('toggle-profile'), true);
  assert.equal(calls.includes('toggle-status-timeline'), true);
  assert.equal(
    calls.includes('toggle-render-trace:session-1') || calls.includes('toggle-render-trace:null'),
    true,
  );
  assert.equal(calls.includes('new-thread:dir-1'), true);
  assert.equal(calls.includes('critique:dir-1'), true);
  assert.equal(calls.includes('refresh-titles'), true);
  assert.equal(calls.includes('interrupt:session-1'), true);
  assert.equal(calls.includes('archive:session-1'), true);
  assert.equal(calls.includes('takeover:session-1'), true);
  assert.equal(calls.includes('stop-edit:true'), true);
  assert.equal(calls.includes('release-selection-pin'), true);
  assert.equal(calls.includes('queue:mouse-close-directory'), true);
  assert.equal(calls.includes('close:dir-1'), true);
  assert.equal(calls.includes('queue-latest:mouse-activate-conversation'), true);
  assert.equal(calls.includes('queue-latest:mouse-activate-edit-conversation'), true);
});
