import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { RuntimeNavigationInput } from '../src/services/runtime-navigation-input.ts';

interface CapturedLeftNavOptions {
  getLatestRailRows(): readonly unknown[];
  getCurrentSelection(): { kind: string };
  setMainPaneProjectMode(): void;
  selectLeftNavRepository(repositoryGroupId: string): void;
  selectLeftNavConversation(sessionId: string): void;
  activateConversation(sessionId: string): Promise<void>;
}

interface CapturedRepositoryFoldOptions {
  getLeftNavSelection(): { kind: string };
  getRepositoryToggleChordPrefixAtMs(): number | null;
  setRepositoryToggleChordPrefixAtMs(value: number | null): void;
  nowMs(): number;
}

interface CapturedGlobalShortcutOptions {
  cycleLeftNavSelection(direction: 'next' | 'previous'): void;
  getActiveConversationAgentType(): string | null;
  toggleCommandMenu(): void;
  toggleDebugBar(): void;
  openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
  toggleGatewayProfile(): Promise<void>;
  toggleGatewayStatusTimeline(): Promise<void>;
  toggleGatewayRenderTrace(conversationId: string | null): Promise<void>;
  archiveConversation(sessionId: string): Promise<void>;
  refreshAllConversationTitles(): Promise<void>;
  interruptConversation(sessionId: string): Promise<void>;
  takeoverConversation(sessionId: string): Promise<void>;
  closeDirectory(directoryId: string): Promise<void>;
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

function expectCaptured<T>(value: T, label: string): NonNullable<T> {
  assert.notEqual(value, null, label);
  if (value === null) {
    throw new Error(label);
  }
  return value as NonNullable<T>;
}

function createNavigationOptions(
  workspace: WorkspaceModel,
  calls: string[],
): ConstructorParameters<typeof RuntimeNavigationInput>[0] {
  return {
    workspace,
    shortcutBindings: resolveMuxShortcutBindings(),
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
    openAddDirectoryPrompt: () => {
      calls.push('openAddDirectoryPrompt');
    },
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label}`);
      void task();
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
    conversations: new Map([
      [
        'session-1',
        {
          directoryId: 'dir-1',
          agentType: 'terminal',
        },
      ],
    ]),
    repositoryGroupIdForDirectory: (directoryId) => `group:${directoryId}`,
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
    workspaceActions: {
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
    },
    chordTimeoutMs: 1250,
    collapseAllChordPrefix: Buffer.from([0x0b]),
  };
}

void test('runtime navigation input composes left-nav, fold, and global shortcut handlers', async () => {
  const calls: string[] = [];
  const workspace = createWorkspace();
  const options = createNavigationOptions(workspace, calls);
  let leftNavCycleCalls = 0;
  let capturedLeftNavOptions: CapturedLeftNavOptions | null = null;
  let capturedRepositoryFoldOptions: CapturedRepositoryFoldOptions | null = null;
  let capturedGlobalShortcutOptions: CapturedGlobalShortcutOptions | null = null;

  const runtimeNavigationInput = new RuntimeNavigationInput(
    {
      ...options,
      nowMs: () => 1234,
    },
    {
      createLeftNavInput: (leftNavOptions) => {
        capturedLeftNavOptions = leftNavOptions as unknown as CapturedLeftNavOptions;
        return {
          cycleSelection: (direction) => {
            calls.push(`leftNavCycle:${direction}`);
            leftNavCycleCalls += 1;
            return direction === 'next';
          },
        };
      },
      createRepositoryFoldInput: (repositoryFoldOptions) => {
        capturedRepositoryFoldOptions =
          repositoryFoldOptions as unknown as CapturedRepositoryFoldOptions;
        return {
          handleRepositoryFoldChords: (input) => input[0] === 0x01,
          handleRepositoryTreeArrow: (input) => input[0] === 0x02,
        };
      },
      createGlobalShortcutInput: (globalShortcutOptions) => {
        capturedGlobalShortcutOptions =
          globalShortcutOptions as unknown as CapturedGlobalShortcutOptions;
        return {
          handleInput: (input) => input[0] === 0x03,
        };
      },
    },
  );

  assert.equal(runtimeNavigationInput.cycleLeftNavSelection('next'), true);
  assert.equal(runtimeNavigationInput.handleRepositoryFoldInput(Buffer.from([0x01])), true);
  assert.equal(runtimeNavigationInput.handleRepositoryFoldInput(Buffer.from([0x02])), true);
  assert.equal(runtimeNavigationInput.handleGlobalShortcutInput(Buffer.from([0x03])), true);

  const leftNavOptions = expectCaptured(
    capturedLeftNavOptions as CapturedLeftNavOptions | null,
    'captured left-nav options should be populated',
  );
  const repositoryFoldOptions = expectCaptured(
    capturedRepositoryFoldOptions as CapturedRepositoryFoldOptions | null,
    'captured repository-fold options should be populated',
  );
  const globalShortcutOptions = expectCaptured(
    capturedGlobalShortcutOptions as CapturedGlobalShortcutOptions | null,
    'captured global-shortcut options should be populated',
  );

  workspace.latestRailViewRows = [{ id: 'row' }] as unknown as typeof workspace.latestRailViewRows;
  assert.equal(leftNavOptions.getLatestRailRows().length, 1);
  assert.equal(leftNavOptions.getCurrentSelection().kind, 'home');
  leftNavOptions.setMainPaneProjectMode();
  assert.equal(workspace.mainPaneMode, 'project');
  leftNavOptions.selectLeftNavRepository('group:dir-1');
  assert.equal(workspace.leftNavSelection.kind, 'repository');
  leftNavOptions.selectLeftNavConversation('session-2');
  assert.deepEqual(workspace.leftNavSelection, {
    kind: 'conversation',
    sessionId: 'session-2',
  });
  await leftNavOptions.activateConversation('session-2');

  workspace.repositoryToggleChordPrefixAtMs = 55;
  assert.equal(repositoryFoldOptions.getLeftNavSelection().kind, 'conversation');
  assert.equal(repositoryFoldOptions.getRepositoryToggleChordPrefixAtMs(), 55);
  repositoryFoldOptions.setRepositoryToggleChordPrefixAtMs(99);
  assert.equal(workspace.repositoryToggleChordPrefixAtMs, 99);
  assert.equal(repositoryFoldOptions.nowMs(), 1234);
  assert.equal(globalShortcutOptions.getActiveConversationAgentType(), 'terminal');

  globalShortcutOptions.cycleLeftNavSelection('previous');
  globalShortcutOptions.toggleCommandMenu();
  globalShortcutOptions.toggleDebugBar();
  assert.equal(leftNavCycleCalls, 2);
});

void test('runtime navigation input default dependency path is usable', () => {
  const calls: string[] = [];
  const workspace = createWorkspace();
  const runtimeNavigationInput = new RuntimeNavigationInput(
    createNavigationOptions(workspace, calls),
  );

  const cycleResult = runtimeNavigationInput.cycleLeftNavSelection('next');
  const foldResult = runtimeNavigationInput.handleRepositoryFoldInput(Buffer.from([0x0b]));
  const shortcutResult = runtimeNavigationInput.handleGlobalShortcutInput(Buffer.from('x'));

  assert.equal(typeof cycleResult, 'boolean');
  assert.equal(typeof foldResult, 'boolean');
  assert.equal(shortcutResult, false);
});

void test('runtime navigation input preserves workspace action method context', async () => {
  const calls: string[] = [];
  const workspace = createWorkspace();

  class MethodContextWorkspaceActions {
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
  }

  const workspaceActions = new MethodContextWorkspaceActions(calls);
  let capturedLeftNavOptions: CapturedLeftNavOptions | null = null;
  let capturedGlobalShortcutOptions: CapturedGlobalShortcutOptions | null = null;

  const runtimeNavigationInput = new RuntimeNavigationInput(
    {
      ...createNavigationOptions(workspace, calls),
      workspaceActions: workspaceActions as ConstructorParameters<
        typeof RuntimeNavigationInput
      >[0]['workspaceActions'],
    },
    {
      createLeftNavInput: (leftNavOptions) => {
        capturedLeftNavOptions = leftNavOptions as unknown as CapturedLeftNavOptions;
        return {
          cycleSelection: () => false,
        };
      },
      createRepositoryFoldInput: () => {
        return {
          handleRepositoryFoldChords: () => false,
          handleRepositoryTreeArrow: () => false,
        };
      },
      createGlobalShortcutInput: (globalShortcutOptions) => {
        capturedGlobalShortcutOptions =
          globalShortcutOptions as unknown as CapturedGlobalShortcutOptions;
        return {
          handleInput: () => false,
        };
      },
    },
  );

  void runtimeNavigationInput;

  const leftNavOptions = expectCaptured(
    capturedLeftNavOptions as CapturedLeftNavOptions | null,
    'captured left-nav options should be populated',
  );
  const globalShortcutOptions = expectCaptured(
    capturedGlobalShortcutOptions as CapturedGlobalShortcutOptions | null,
    'captured global-shortcut options should be populated',
  );

  await leftNavOptions.activateConversation('session-ctx');
  await globalShortcutOptions.openOrCreateCritiqueConversationInDirectory('dir-ctx');
  globalShortcutOptions.toggleCommandMenu();
  globalShortcutOptions.toggleDebugBar();
  await globalShortcutOptions.toggleGatewayProfile();
  await globalShortcutOptions.toggleGatewayStatusTimeline();
  await globalShortcutOptions.toggleGatewayRenderTrace('session-ctx');
  await globalShortcutOptions.archiveConversation('session-ctx');
  await globalShortcutOptions.refreshAllConversationTitles();
  await globalShortcutOptions.interruptConversation('session-ctx');
  await globalShortcutOptions.takeoverConversation('session-ctx');
  await globalShortcutOptions.closeDirectory('dir-ctx');

  assert.deepEqual(calls, [
    'activateConversation:session-ctx',
    'openOrCreateCritiqueConversationInDirectory:dir-ctx',
    'toggleCommandMenu',
    'toggleDebugBar',
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
