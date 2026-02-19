import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { computeDualPaneLayout } from '../src/mux/dual-pane-core.ts';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { RuntimeInputRouter } from '../src/services/runtime-input-router.ts';

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: 'dir-1',
    leftNavSelection: {
      kind: 'home',
    },
    latestTaskPaneView: {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    },
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
    shortcutsCollapsed: false,
  });
}

void test('runtime input router composes modal rail and main-pane routing surfaces', () => {
  const workspace = createWorkspace();
  const conversations = new Map([
    [
      'session-1',
      {
        title: 'Session',
        directoryId: 'dir-1',
      },
    ],
  ]);
  const calls: string[] = [];
  const runtimeInputRouter = new RuntimeInputRouter({
    workspace,
    conversations,
    runtimeWorkspaceActions: {
      activateConversation: async () => {},
      openOrCreateCritiqueConversationInDirectory: async () => {},
      toggleGatewayProfiler: async () => {},
      toggleGatewayStatusTimeline: async () => {},
      toggleGatewayRenderTrace: async () => {},
      archiveConversation: async () => {},
      interruptConversation: async () => {},
      takeoverConversation: async () => {},
      closeDirectory: async () => {},
      openRepositoryPromptForCreate: () => {},
      openRepositoryPromptForEdit: () => {},
      archiveRepositoryById: async () => {},
      createAndActivateConversationInDirectory: async () => {},
      addDirectoryByPath: async () => {},
      upsertRepositoryByRemoteUrl: async () => {},
      runTaskPaneAction: () => {},
      openTaskEditPrompt: () => {},
      reorderTaskByDrop: () => {},
      reorderRepositoryByDrop: () => {},
    },
    runtimeTaskEditorActions: {
      submitTaskEditorPayload: () => {},
    },
    detectShortcut: (input) => {
      if (input.toString('utf8') === 'toggle-command-menu') {
        return 'mux.command-menu.toggle';
      }
      return null;
    },
    modalDismissShortcutBindings: resolveMuxShortcutBindings(),
    shortcutBindings: resolveMuxShortcutBindings(),
    dismissOnOutsideClick: () => false,
    buildCommandMenuModalOverlay: () => null,
    buildConversationTitleModalOverlay: () => null,
    buildNewThreadModalOverlay: () => null,
    resolveNewThreadPromptAgentByRow: () => 'codex',
    stopConversationTitleEdit: () => {},
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label}`);
      void task();
    },
    normalizeGitHubRemoteUrl: () => null,
    repositoriesHas: () => true,
    markDirty: () => {},
    scheduleConversationTitlePersist: () => {},
    resolveCommandMenuActions: () => [],
    executeCommandMenuAction: () => {},
    requestStop: () => {},
    resolveDirectoryForAction: () => 'dir-1',
    openNewThreadPrompt: () => {},
    toggleCommandMenu: () => {},
    firstDirectoryForRepositoryGroup: () => 'dir-1',
    enterHomePane: () => {},
    enterProjectPane: () => {},
    queuePersistMuxUiState: () => {},
    repositoryGroupIdForDirectory: (directoryId) => directoryId,
    toggleRepositoryGroup: () => {},
    collapseRepositoryGroup: () => {},
    expandRepositoryGroup: () => {},
    collapseAllRepositoryGroups: () => {},
    expandAllRepositoryGroups: () => {},
    directoriesHas: () => true,
    conversationDirectoryId: () => 'dir-1',
    conversationsHas: () => true,
    getMainPaneMode: () => workspace.mainPaneMode,
    getActiveConversationId: () => 'session-1',
    getActiveDirectoryId: () => workspace.activeDirectoryId,
    chordTimeoutMs: 1250,
    collapseAllChordPrefix: Buffer.from([0x0b]),
    releaseViewportPinForSelection: () => {},
    beginConversationTitleEdit: () => {},
    resetConversationPaneFrameCache: () => {},
    conversationTitleEditDoubleClickWindowMs: 350,
    projectPaneActionAtRow: () => null,
    queueCloseDirectory: (directoryId) => {
      calls.push(`queueCloseDirectory:${directoryId}`);
    },
    selectTaskById: () => {},
    selectRepositoryById: () => {},
    taskPaneActionAtCell: () => null,
    taskPaneActionAtRow: () => null,
    taskPaneTaskIdAtRow: () => null,
    taskPaneRepositoryIdAtRow: () => null,
    applyPaneDividerAtCol: () => {},
    pinViewportForSelection: () => {},
    homePaneEditDoubleClickWindowMs: 350,
  });

  const layout = computeDualPaneLayout(120, 40, {
    leftCols: 36,
  });

  assert.equal(typeof runtimeInputRouter.routeModalInput(Buffer.from('x')), 'boolean');
  workspace.conversationTitleEdit = {
    conversationId: 'session-1',
    value: '',
    lastSavedValue: '',
    error: null,
    persistInFlight: false,
    debounceTimer: null,
  };
  assert.equal(runtimeInputRouter.routeModalInput(Buffer.from('a')), true);
  workspace.commandMenu = {
    query: 'cur',
    selectedIndex: 0,
  };
  assert.equal(
    runtimeInputRouter.routeModalInput(Buffer.from('toggle-command-menu', 'utf8')),
    true,
  );
  assert.equal(workspace.commandMenu, null);
  assert.equal(
    typeof runtimeInputRouter.handleRepositoryFoldInput(Buffer.from([0x0b])),
    'boolean',
  );
  assert.equal(typeof runtimeInputRouter.handleGlobalShortcutInput(Buffer.from('x')), 'boolean');
  const tokenRouter = runtimeInputRouter.inputTokenRouter();
  const routed = tokenRouter.routeTokens({
    tokens: [],
    layout,
    conversation: null,
    snapshotForInput: null,
  });
  assert.deepEqual(routed.routedTokens, []);
  assert.equal(routed.snapshotForInput, null);
});
