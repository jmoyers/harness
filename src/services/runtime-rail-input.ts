import type { WorkspaceModel } from '../domain/workspace.ts';
import type { resolveMuxShortcutBindings } from '../mux/input-shortcuts.ts';
import { LeftRailPointerInput } from '../ui/left-rail-pointer-input.ts';
import { RuntimeNavigationInput } from './runtime-navigation-input.ts';

type MainPaneMode = 'conversation' | 'project' | 'home';
type RuntimeNavigationInputOptions = ConstructorParameters<typeof RuntimeNavigationInput>[0];
type LeftRailPointerInputOptions = ConstructorParameters<typeof LeftRailPointerInput>[0];
type LeftRailPointerClickInput = Parameters<LeftRailPointerInput['handlePointerClick']>[0];

interface RuntimeRailWorkspaceActions {
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
  openRepositoryPromptForCreate(): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  archiveRepositoryById(repositoryId: string): Promise<void>;
}

interface RuntimeRailInputOptions {
  readonly workspace: WorkspaceModel;
  readonly shortcutBindings: ReturnType<typeof resolveMuxShortcutBindings>;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly runtimeWorkspaceActions: RuntimeRailWorkspaceActions;
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly toggleDebugBar: () => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterHomePane: () => void;
  readonly enterTasksPane?: () => void;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly markDirty: () => void;
  readonly queuePersistMuxUiState: () => void;
  readonly conversations: RuntimeNavigationInputOptions['conversations'];
  readonly repositoryGroupIdForDirectory: RuntimeNavigationInputOptions['repositoryGroupIdForDirectory'];
  readonly toggleRepositoryGroup: (repositoryGroupId: string) => void;
  readonly collapseRepositoryGroup: RuntimeNavigationInputOptions['collapseRepositoryGroup'];
  readonly expandRepositoryGroup: RuntimeNavigationInputOptions['expandRepositoryGroup'];
  readonly collapseAllRepositoryGroups: RuntimeNavigationInputOptions['collapseAllRepositoryGroups'];
  readonly expandAllRepositoryGroups: RuntimeNavigationInputOptions['expandAllRepositoryGroups'];
  readonly directoriesHas: RuntimeNavigationInputOptions['directoriesHas'];
  readonly conversationDirectoryId: RuntimeNavigationInputOptions['conversationDirectoryId'];
  readonly conversationsHas: RuntimeNavigationInputOptions['conversationsHas'];
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getActiveConversationId: () => string | null;
  readonly getActiveDirectoryId: () => string | null;
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly chordTimeoutMs: number;
  readonly collapseAllChordPrefix: Buffer;
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly releaseViewportPinForSelection: () => void;
  readonly beginConversationTitleEdit: (conversationId: string) => void;
  readonly resetConversationPaneFrameCache: () => void;
  readonly conversationTitleEditDoubleClickWindowMs: number;
  readonly nowMs?: () => number;
}

interface RuntimeRailInputDependencies {
  readonly createRuntimeNavigationInput?: (
    options: RuntimeNavigationInputOptions,
  ) => Pick<
    RuntimeNavigationInput,
    'cycleLeftNavSelection' | 'handleRepositoryFoldInput' | 'handleGlobalShortcutInput'
  >;
  readonly createLeftRailPointerInput?: (
    options: LeftRailPointerInputOptions,
  ) => Pick<LeftRailPointerInput, 'handlePointerClick'>;
}

export class RuntimeRailInput {
  private readonly navigationInput: Pick<
    RuntimeNavigationInput,
    'cycleLeftNavSelection' | 'handleRepositoryFoldInput' | 'handleGlobalShortcutInput'
  >;
  private readonly leftRailPointerInput: Pick<LeftRailPointerInput, 'handlePointerClick'>;

  constructor(
    private readonly options: RuntimeRailInputOptions,
    dependencies: RuntimeRailInputDependencies = {},
  ) {
    const nowMs = options.nowMs ?? (() => Date.now());
    const createRuntimeNavigationInput =
      dependencies.createRuntimeNavigationInput ??
      ((navigationOptions: RuntimeNavigationInputOptions) =>
        new RuntimeNavigationInput(navigationOptions));
    const createLeftRailPointerInput =
      dependencies.createLeftRailPointerInput ??
      ((leftRailOptions: LeftRailPointerInputOptions) => new LeftRailPointerInput(leftRailOptions));

    const runtimeNavigationOptions: RuntimeNavigationInputOptions = {
      workspace: options.workspace,
      shortcutBindings: options.shortcutBindings,
      requestStop: options.requestStop,
      resolveDirectoryForAction: options.resolveDirectoryForAction,
      openNewThreadPrompt: options.openNewThreadPrompt,
      toggleCommandMenu: options.toggleCommandMenu,
      toggleDebugBar: options.toggleDebugBar,
      openAddDirectoryPrompt: () => {
        this.openAddDirectoryPrompt();
        options.markDirty();
      },
      queueControlPlaneOp: options.queueControlPlaneOp,
      firstDirectoryForRepositoryGroup: options.firstDirectoryForRepositoryGroup,
      enterHomePane: options.enterHomePane,
      enterProjectPane: options.enterProjectPane,
      markDirty: options.markDirty,
      conversations: options.conversations,
      repositoryGroupIdForDirectory: options.repositoryGroupIdForDirectory,
      collapseRepositoryGroup: options.collapseRepositoryGroup,
      expandRepositoryGroup: options.expandRepositoryGroup,
      collapseAllRepositoryGroups: options.collapseAllRepositoryGroups,
      expandAllRepositoryGroups: options.expandAllRepositoryGroups,
      directoriesHas: options.directoriesHas,
      conversationDirectoryId: options.conversationDirectoryId,
      conversationsHas: options.conversationsHas,
      getMainPaneMode: options.getMainPaneMode,
      getActiveConversationId: options.getActiveConversationId,
      getActiveDirectoryId: options.getActiveDirectoryId,
      workspaceActions: {
        activateConversation: async (sessionId) => {
          await options.runtimeWorkspaceActions.activateConversation(sessionId);
        },
        openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
          await options.runtimeWorkspaceActions.openOrCreateCritiqueConversationInDirectory(
            directoryId,
          );
        },
        toggleGatewayProfiler: async () => {
          await options.runtimeWorkspaceActions.toggleGatewayProfiler();
        },
        toggleGatewayStatusTimeline: async () => {
          await options.runtimeWorkspaceActions.toggleGatewayStatusTimeline();
        },
        toggleGatewayRenderTrace: async (conversationId) => {
          await options.runtimeWorkspaceActions.toggleGatewayRenderTrace(conversationId);
        },
        archiveConversation: async (sessionId) => {
          await options.runtimeWorkspaceActions.archiveConversation(sessionId);
        },
        refreshAllConversationTitles: async () => {
          await options.runtimeWorkspaceActions.refreshAllConversationTitles();
        },
        interruptConversation: async (sessionId) => {
          await options.runtimeWorkspaceActions.interruptConversation(sessionId);
        },
        takeoverConversation: async (sessionId) => {
          await options.runtimeWorkspaceActions.takeoverConversation(sessionId);
        },
        closeDirectory: async (directoryId) => {
          await options.runtimeWorkspaceActions.closeDirectory(directoryId);
        },
      },
      chordTimeoutMs: options.chordTimeoutMs,
      collapseAllChordPrefix: options.collapseAllChordPrefix,
      nowMs,
      ...(options.enterTasksPane === undefined
        ? {}
        : {
            enterTasksPane: options.enterTasksPane,
          }),
    };
    this.navigationInput = createRuntimeNavigationInput(runtimeNavigationOptions);

    this.leftRailPointerInput = createLeftRailPointerInput({
      getLatestRailRows: () => options.workspace.latestRailViewRows,
      hasConversationTitleEdit: () => options.workspace.conversationTitleEdit !== null,
      conversationTitleEditConversationId: () =>
        options.workspace.conversationTitleEdit?.conversationId ?? null,
      stopConversationTitleEdit: () => {
        options.stopConversationTitleEdit(true);
      },
      hasSelection: () =>
        options.workspace.selection !== null || options.workspace.selectionDrag !== null,
      clearSelection: () => {
        options.workspace.selection = null;
        options.workspace.selectionDrag = null;
        options.releaseViewportPinForSelection();
      },
      activeConversationId: options.getActiveConversationId,
      repositoriesCollapsed: () => options.workspace.repositoriesCollapsed,
      clearConversationTitleEditClickState: () => {
        options.workspace.conversationTitleEditClickState = null;
      },
      resolveDirectoryForAction: options.resolveDirectoryForAction,
      openNewThreadPrompt: options.openNewThreadPrompt,
      queueArchiveConversation: (conversationId) => {
        options.queueControlPlaneOp(async () => {
          await options.runtimeWorkspaceActions.archiveConversation(conversationId);
        }, 'mouse-archive-conversation');
      },
      openAddDirectoryPrompt: () => {
        this.openAddDirectoryPrompt();
      },
      openRepositoryPromptForCreate: () => {
        options.runtimeWorkspaceActions.openRepositoryPromptForCreate();
      },
      repositoryExists: options.repositoriesHas,
      openRepositoryPromptForEdit: (repositoryId) => {
        options.runtimeWorkspaceActions.openRepositoryPromptForEdit(repositoryId);
      },
      queueArchiveRepository: (repositoryId) => {
        options.queueControlPlaneOp(async () => {
          await options.runtimeWorkspaceActions.archiveRepositoryById(repositoryId);
        }, 'mouse-archive-repository');
      },
      queueCloseDirectory: (directoryId) => {
        options.queueControlPlaneOp(async () => {
          await options.runtimeWorkspaceActions.closeDirectory(directoryId);
        }, 'mouse-close-directory');
      },
      toggleRepositoryGroup: options.toggleRepositoryGroup,
      selectLeftNavRepository: (repositoryGroupId) => {
        options.workspace.selectLeftNavRepository(repositoryGroupId);
      },
      expandAllRepositoryGroups: options.expandAllRepositoryGroups,
      collapseAllRepositoryGroups: options.collapseAllRepositoryGroups,
      enterHomePane: options.enterHomePane,
      previousConversationClickState: () => options.workspace.conversationTitleEditClickState,
      setConversationClickState: (next) => {
        options.workspace.conversationTitleEditClickState = next;
      },
      nowMs,
      conversationTitleEditDoubleClickWindowMs: options.conversationTitleEditDoubleClickWindowMs,
      isConversationPaneActive: () => options.getMainPaneMode() === 'conversation',
      ensureConversationPaneActive: (conversationId) => {
        options.workspace.mainPaneMode = 'conversation';
        options.workspace.selectLeftNavConversation(conversationId);
        options.workspace.projectPaneSnapshot = null;
        options.workspace.projectPaneScrollTop = 0;
        options.resetConversationPaneFrameCache();
      },
      beginConversationTitleEdit: options.beginConversationTitleEdit,
      queueActivateConversation: (conversationId) => {
        options.queueControlPlaneOp(async () => {
          await options.runtimeWorkspaceActions.activateConversation(conversationId);
        }, 'mouse-activate-conversation');
      },
      queueActivateConversationAndEdit: (conversationId) => {
        options.queueControlPlaneOp(async () => {
          await options.runtimeWorkspaceActions.activateConversation(conversationId);
          options.beginConversationTitleEdit(conversationId);
        }, 'mouse-activate-edit-conversation');
      },
      directoriesHas: options.directoriesHas,
      enterProjectPane: options.enterProjectPane,
      markDirty: options.markDirty,
      ...(options.enterTasksPane === undefined
        ? {}
        : {
            enterTasksPane: options.enterTasksPane,
          }),
    });
  }

  cycleLeftNavSelection(direction: 'next' | 'previous'): boolean {
    return this.navigationInput.cycleLeftNavSelection(direction);
  }

  handleRepositoryFoldInput(input: Buffer): boolean {
    return this.navigationInput.handleRepositoryFoldInput(input);
  }

  handleGlobalShortcutInput(input: Buffer): boolean {
    return this.navigationInput.handleGlobalShortcutInput(input);
  }

  handlePointerClick(input: LeftRailPointerClickInput): boolean {
    return this.leftRailPointerInput.handlePointerClick(input);
  }

  private openAddDirectoryPrompt(): void {
    this.options.workspace.repositoryPrompt = null;
    this.options.workspace.apiKeyPrompt = null;
    this.options.workspace.addDirectoryPrompt = {
      value: '',
      error: null,
    };
  }
}
