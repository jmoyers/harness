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
