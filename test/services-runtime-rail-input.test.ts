import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { RuntimeRailInput } from '../src/services/runtime-rail-input.ts';

interface CapturedNavigationOptions {
  openAddDirectoryPrompt(): void;
  toggleCommandMenu(): void;
  toggleDebugBar(): void;
  workspaceActions: {
    activateConversation(sessionId: string): Promise<void>;
    openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
    toggleGatewayProfiler(): Promise<void>;
    toggleGatewayStatusTimeline(): Promise<void>;
    toggleGatewayRenderTrace(conversationId: string | null): Promise<void>;
    archiveConversation(sessionId: string): Promise<void>;
    refreshAllConversationTitles(): Promise<void>;
    interruptConversation(sessionId: string): Promise<void>;
    takeoverConversation(sessionId: string): Promise<void>;
    closeDirectory(directoryId: string): Promise<void>;
  };
}

interface CapturedLeftRailOptions {
  getLatestRailRows(): readonly unknown[];
  hasConversationTitleEdit(): boolean;
  conversationTitleEditConversationId(): string | null;
  hasSelection(): boolean;
  activeConversationId(): string | null;
  repositoriesCollapsed(): boolean;
  clearConversationTitleEditClickState(): void;
  openAddDirectoryPrompt(): void;
  openRepositoryPromptForCreate(): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  selectLeftNavRepository(repositoryGroupId: string): void;
  setConversationClickState(next: { conversationId: string; atMs: number } | null): void;
  clearSelection(): void;
  toggleShortcutsCollapsed(): void;
  ensureConversationPaneActive(conversationId: string): void;
  queueArchiveConversation(conversationId: string): void;
  queueArchiveRepository(repositoryId: string): void;
  queueCloseDirectory(directoryId: string): void;
  queueActivateConversation(conversationId: string): void;
  queueActivateConversationAndEdit(conversationId: string): void;
  previousConversationClickState(): { conversationId: string; atMs: number } | null;
  nowMs(): number;
  isConversationPaneActive(): boolean;
  stopConversationTitleEdit(): void;
}

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
  });
}

function createOptions(
  workspace: WorkspaceModel,
  calls: string[],
): ConstructorParameters<typeof RuntimeRailInput>[0] {
  return {
    workspace,
    shortcutBindings: resolveMuxShortcutBindings(),
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label}`);
      void task();
    },
    runtimeWorkspaceActions: {
      activateConversation: async (sessionId) => {
        calls.push(`activateConversation:${sessionId}`);
      },
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        calls.push(`openOrCreateCritiqueConversationInDirectory:${directoryId}`);
      },
      toggleGatewayProfiler: async () => {
        calls.push('toggleGatewayProfiler');
      },
      toggleGatewayStatusTimeline: async () => {
        calls.push('toggleGatewayStatusTimeline');
      },
      toggleGatewayRenderTrace: async (conversationId) => {
        calls.push(`toggleGatewayRenderTrace:${conversationId ?? 'null'}`);
      },
      archiveConversation: async (sessionId) => {
        calls.push(`archiveConversation:${sessionId}`);
      },
      refreshAllConversationTitles: async () => {
        calls.push('refreshAllConversationTitles');
      },
      interruptConversation: async (sessionId) => {
        calls.push(`interruptConversation:${sessionId}`);
      },
      takeoverConversation: async (sessionId) => {
        calls.push(`takeoverConversation:${sessionId}`);
      },
      closeDirectory: async (directoryId) => {
        calls.push(`closeDirectory:${directoryId}`);
      },
      openRepositoryPromptForCreate: () => {
        calls.push('openRepositoryPromptForCreate');
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
      },
      archiveRepositoryById: async (repositoryId) => {
        calls.push(`archiveRepositoryById:${repositoryId}`);
      },
    },
    requestStop: () => {
      calls.push('requestStop');
    },
    resolveDirectoryForAction: () => 'dir-1',
    openNewThreadPrompt: (directoryId) => {
      calls.push(`openNewThreadPrompt:${directoryId}`);
    },
    toggleCommandMenu: () => {
      calls.push('toggleCommandMenu');
    },
    toggleDebugBar: () => {
      calls.push('toggleDebugBar');
    },
    firstDirectoryForRepositoryGroup: () => 'dir-1',
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
    enterProjectPane: (directoryId) => {
      calls.push(`enterProjectPane:${directoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    queuePersistMuxUiState: () => {
      calls.push('queuePersistMuxUiState');
    },
    conversations: new Map([
      [
        'session-1',
        {
          directoryId: 'dir-1',
        },
      ],
    ]),
    repositoryGroupIdForDirectory: (directoryId) => `group:${directoryId}`,
    toggleRepositoryGroup: (repositoryGroupId) => {
      calls.push(`toggleRepositoryGroup:${repositoryGroupId}`);
    },
    collapseRepositoryGroup: (repositoryGroupId) => {
      calls.push(`collapseRepositoryGroup:${repositoryGroupId}`);
    },
    expandRepositoryGroup: (repositoryGroupId) => {
      calls.push(`expandRepositoryGroup:${repositoryGroupId}`);
    },
    collapseAllRepositoryGroups: () => {
      calls.push('collapseAllRepositoryGroups');
    },
    expandAllRepositoryGroups: () => {
      calls.push('expandAllRepositoryGroups');
    },
    directoriesHas: () => true,
    conversationDirectoryId: () => 'dir-1',
    conversationsHas: () => true,
    getMainPaneMode: () => workspace.mainPaneMode,
    getActiveConversationId: () => 'session-1',
    getActiveDirectoryId: () => workspace.activeDirectoryId,
    repositoriesHas: () => true,
    chordTimeoutMs: 1250,
    collapseAllChordPrefix: Buffer.from([0x0b]),
    stopConversationTitleEdit: (persistPending) => {
      calls.push(`stopConversationTitleEdit:${String(persistPending)}`);
    },
    releaseViewportPinForSelection: () => {
      calls.push('releaseViewportPinForSelection');
    },
    beginConversationTitleEdit: (conversationId) => {
      calls.push(`beginConversationTitleEdit:${conversationId}`);
    },
    resetConversationPaneFrameCache: () => {
      calls.push('resetConversationPaneFrameCache');
    },
    conversationTitleEditDoubleClickWindowMs: 350,
  };
}

void test('runtime rail input composes navigation and pointer input with workspace-owned state updates', async () => {
  const calls: string[] = [];
  const workspace = createWorkspace();
  const options = createOptions(workspace, calls);
  workspace.selection = {
    anchor: { rowAbs: 1, col: 1 },
    focus: { rowAbs: 1, col: 2 },
    text: '',
  };
  workspace.selectionDrag = {
    anchor: { rowAbs: 1, col: 1 },
    focus: { rowAbs: 2, col: 3 },
    hasDragged: true,
  };
  workspace.conversationTitleEditClickState = {
    conversationId: 'session-old',
    atMs: 1,
  };
  let navigationCycleCalls = 0;
  const previousMarkDirtyCount = calls.filter((entry) => entry === 'markDirty').length;

  const runtimeRailInput = new RuntimeRailInput(
    {
      ...options,
      nowMs: () => 1234,
    },
    {
      createRuntimeNavigationInput: (navigationOptions: unknown) => {
        const navigation = navigationOptions as CapturedNavigationOptions;
        navigation.openAddDirectoryPrompt();
        navigation.toggleCommandMenu();
        navigation.toggleDebugBar();
        return {
          cycleLeftNavSelection: (direction) => {
            calls.push(`cycleLeftNavSelection:${direction}`);
            navigationCycleCalls += 1;
            return direction === 'next';
          },
          handleRepositoryFoldInput: (input) => input[0] === 0x01,
          handleGlobalShortcutInput: (input) => input[0] === 0x02,
        };
      },
      createLeftRailPointerInput: (leftRailOptions: unknown) => {
        const pointerOptions = leftRailOptions as CapturedLeftRailOptions;
        pointerOptions.getLatestRailRows();
        pointerOptions.hasConversationTitleEdit();
        pointerOptions.conversationTitleEditConversationId();
        pointerOptions.hasSelection();
        pointerOptions.activeConversationId();
        pointerOptions.repositoriesCollapsed();
        pointerOptions.clearConversationTitleEditClickState();
        pointerOptions.openAddDirectoryPrompt();
        pointerOptions.openRepositoryPromptForCreate();
        pointerOptions.openRepositoryPromptForEdit('repo-2');
        pointerOptions.selectLeftNavRepository('group:dir-1');
        pointerOptions.setConversationClickState({
          conversationId: 'session-clicked',
          atMs: 22,
        });
        pointerOptions.clearSelection();
        pointerOptions.ensureConversationPaneActive('session-1');
        pointerOptions.queueArchiveConversation('session-1');
        pointerOptions.queueArchiveRepository('repo-1');
        pointerOptions.queueCloseDirectory('dir-1');
        pointerOptions.queueActivateConversation('session-1');
        pointerOptions.queueActivateConversationAndEdit('session-2');
        pointerOptions.previousConversationClickState();
        pointerOptions.nowMs();
        pointerOptions.isConversationPaneActive();
        pointerOptions.stopConversationTitleEdit();
        return {
          handlePointerClick: (input) => input.pointerCol === 2,
        };
      },
    },
  );

  await Promise.resolve();
  assert.equal(workspace.repositoryPrompt, null);
  assert.deepEqual(workspace.addDirectoryPrompt, {
    value: '',
    error: null,
  });
  assert.equal(workspace.selection, null);
  assert.equal(workspace.selectionDrag, null);
  assert.equal(workspace.mainPaneMode, 'conversation');
  assert.equal(workspace.leftNavSelection.kind, 'conversation');
  assert.equal(workspace.conversationTitleEditClickState?.conversationId, 'session-clicked');
  assert.equal(calls.filter((entry) => entry === 'markDirty').length, previousMarkDirtyCount + 1);
  assert.equal(calls.includes('openRepositoryPromptForCreate'), true);
  assert.equal(calls.includes('openRepositoryPromptForEdit:repo-2'), true);
  assert.equal(calls.includes('releaseViewportPinForSelection'), true);
  assert.equal(calls.includes('resetConversationPaneFrameCache'), true);
  assert.equal(calls.includes('queueControlPlaneOp:mouse-archive-conversation'), true);
  assert.equal(calls.includes('archiveConversation:session-1'), true);
  assert.equal(calls.includes('queueControlPlaneOp:mouse-archive-repository'), true);
  assert.equal(calls.includes('archiveRepositoryById:repo-1'), true);
  assert.equal(calls.includes('queueControlPlaneOp:mouse-close-directory'), true);
  assert.equal(calls.includes('closeDirectory:dir-1'), true);
  assert.equal(calls.includes('queueControlPlaneOp:mouse-activate-conversation'), true);
  assert.equal(calls.includes('activateConversation:session-1'), true);
  assert.equal(calls.includes('queueControlPlaneOp:mouse-activate-edit-conversation'), true);
  assert.equal(calls.includes('beginConversationTitleEdit:session-2'), true);
  assert.equal(calls.includes('stopConversationTitleEdit:true'), true);

  assert.equal(runtimeRailInput.cycleLeftNavSelection('next'), true);
  assert.equal(runtimeRailInput.handleRepositoryFoldInput(Buffer.from([0x01])), true);
  assert.equal(runtimeRailInput.handleGlobalShortcutInput(Buffer.from([0x02])), true);
  assert.equal(
    runtimeRailInput.handlePointerClick({
      clickEligible: true,
      paneRows: 1,
      leftCols: 2,
      pointerRow: 1,
      pointerCol: 2,
    }),
    true,
  );
  assert.equal(navigationCycleCalls, 1);
});

void test('runtime rail input default dependency path is usable', () => {
  const calls: string[] = [];
  const workspace = createWorkspace();
  const runtimeRailInput = new RuntimeRailInput(createOptions(workspace, calls));

  const cycleResult = runtimeRailInput.cycleLeftNavSelection('next');
  const foldResult = runtimeRailInput.handleRepositoryFoldInput(Buffer.from([0x0b]));
  const shortcutResult = runtimeRailInput.handleGlobalShortcutInput(Buffer.from('x'));
  const pointerResult = runtimeRailInput.handlePointerClick({
    clickEligible: false,
    paneRows: 1,
    leftCols: 1,
    pointerRow: 1,
    pointerCol: 1,
  });

  assert.equal(typeof cycleResult, 'boolean');
  assert.equal(typeof foldResult, 'boolean');
  assert.equal(shortcutResult, false);
  assert.equal(pointerResult, false);
});

void test('runtime rail input preserves runtime workspace action method context', async () => {
  const calls: string[] = [];
  const workspace = createWorkspace();

  class MethodContextRuntimeWorkspaceActions {
    constructor(private readonly sink: string[]) {}

    async activateConversation(sessionId: string): Promise<void> {
      this.sink.push(`activateConversation:${sessionId}`);
    }

    async openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void> {
      this.sink.push(`openOrCreateCritiqueConversationInDirectory:${directoryId}`);
    }

    async toggleGatewayProfiler(): Promise<void> {
      this.sink.push('toggleGatewayProfiler');
    }

    async toggleGatewayStatusTimeline(): Promise<void> {
      this.sink.push('toggleGatewayStatusTimeline');
    }

    async toggleGatewayRenderTrace(conversationId: string | null): Promise<void> {
      this.sink.push(`toggleGatewayRenderTrace:${conversationId ?? 'null'}`);
    }

    async archiveConversation(sessionId: string): Promise<void> {
      this.sink.push(`archiveConversation:${sessionId}`);
    }

    async refreshAllConversationTitles(): Promise<void> {
      this.sink.push('refreshAllConversationTitles');
    }

    async interruptConversation(sessionId: string): Promise<void> {
      this.sink.push(`interruptConversation:${sessionId}`);
    }

    async takeoverConversation(sessionId: string): Promise<void> {
      this.sink.push(`takeoverConversation:${sessionId}`);
    }

    async closeDirectory(directoryId: string): Promise<void> {
      this.sink.push(`closeDirectory:${directoryId}`);
    }

    openRepositoryPromptForCreate(): void {
      this.sink.push('openRepositoryPromptForCreate');
    }

    openRepositoryPromptForEdit(repositoryId: string): void {
      this.sink.push(`openRepositoryPromptForEdit:${repositoryId}`);
    }

    async archiveRepositoryById(repositoryId: string): Promise<void> {
      this.sink.push(`archiveRepositoryById:${repositoryId}`);
    }
  }

  const workspaceActions = new MethodContextRuntimeWorkspaceActions(calls);
  let capturedNavigationOptions: CapturedNavigationOptions | null = null;

  const runtimeRailInput = new RuntimeRailInput(
    {
      ...createOptions(workspace, []),
      runtimeWorkspaceActions: workspaceActions as ConstructorParameters<
        typeof RuntimeRailInput
      >[0]['runtimeWorkspaceActions'],
    },
    {
      createRuntimeNavigationInput: (navigationOptions: unknown) => {
        capturedNavigationOptions = navigationOptions as CapturedNavigationOptions;
        return {
          cycleLeftNavSelection: () => false,
          handleRepositoryFoldInput: () => false,
          handleGlobalShortcutInput: () => false,
        };
      },
      createLeftRailPointerInput: () => {
        return {
          handlePointerClick: () => false,
        };
      },
    },
  );

  void runtimeRailInput;

  const navigationOptions = capturedNavigationOptions as CapturedNavigationOptions | null;
  assert.notEqual(navigationOptions, null);
  if (navigationOptions === null) {
    throw new Error('captured navigation options should be populated');
  }

  await navigationOptions.workspaceActions.activateConversation('session-ctx');
  await navigationOptions.workspaceActions.openOrCreateCritiqueConversationInDirectory('dir-ctx');
  await navigationOptions.workspaceActions.toggleGatewayProfiler();
  await navigationOptions.workspaceActions.toggleGatewayStatusTimeline();
  await navigationOptions.workspaceActions.toggleGatewayRenderTrace('session-ctx');
  await navigationOptions.workspaceActions.archiveConversation('session-ctx');
  await navigationOptions.workspaceActions.refreshAllConversationTitles();
  await navigationOptions.workspaceActions.interruptConversation('session-ctx');
  await navigationOptions.workspaceActions.takeoverConversation('session-ctx');
  await navigationOptions.workspaceActions.closeDirectory('dir-ctx');

  assert.deepEqual(calls, [
    'activateConversation:session-ctx',
    'openOrCreateCritiqueConversationInDirectory:dir-ctx',
    'toggleGatewayProfiler',
    'toggleGatewayStatusTimeline',
    'toggleGatewayRenderTrace:session-ctx',
    'archiveConversation:session-ctx',
    'refreshAllConversationTitles',
    'interruptConversation:session-ctx',
    'takeoverConversation:session-ctx',
    'closeDirectory:dir-ctx',
  ]);
});
