import {
  detectMuxGlobalShortcut,
  type ResolvedMuxShortcutBindings,
} from '../../mux/input-shortcuts.ts';
import { handleGlobalShortcut } from '../../mux/live-mux/global-shortcut-handlers.ts';
import {
  activateLeftNavTarget,
  cycleLeftNavSelection,
} from '../../mux/live-mux/left-nav-activation.ts';
import { visibleLeftNavTargets } from '../../mux/live-mux/left-nav.ts';
import {
  firstDirectoryForRepositoryGroup as firstDirectoryForRepositoryGroupFn,
  reduceRepositoryFoldChordInput,
  repositoryTreeArrowAction,
} from '../../mux/live-mux/repository-folding.ts';
import type { buildWorkspaceRailViewRows } from '../../mux/workspace-rail-model.ts';
import type { WorkspaceModel } from '../../domain/workspace.ts';
import { LeftRailPointerHandler } from '../../services/left-rail-pointer-handler.ts';
import { GlobalShortcutInput } from '../../../packages/harness-ui/src/interaction/global-shortcut-input.ts';
import { LeftNavInput } from '../../../packages/harness-ui/src/interaction/left-nav-input.ts';
import {
  RailPointerInput,
  type HandlePointerClickInput,
} from '../../../packages/harness-ui/src/interaction/rail-pointer-input.ts';
import { RepositoryFoldInput } from '../../../packages/harness-ui/src/interaction/repository-fold-input.ts';

interface DirectoryRecordLike {
  readonly directoryId: string;
}

interface ConversationRecordLike {
  readonly directoryId: string | null;
  readonly agentType: string;
}

interface ConversationLookup {
  readonly activeConversationId: string | null;
  has(sessionId: string): boolean;
  directoryIdOf(sessionId: string): string | null;
}

interface DirectoryLookup {
  hasDirectory(directoryId: string): boolean;
}

interface RepositoryManagerLike {
  repositoryGroupIdForDirectory(directoryId: string, fallbackGroupId: string): string;
  collapseRepositoryGroup(repositoryGroupId: string, repositoriesCollapsed: boolean): void;
  expandRepositoryGroup(repositoryGroupId: string, repositoriesCollapsed: boolean): void;
  toggleRepositoryGroup(repositoryGroupId: string, repositoriesCollapsed: boolean): void;
  collapseAllRepositoryGroups(): true;
  expandAllRepositoryGroups(): false;
}

interface QueueControlPlaneOps {
  queueControlPlaneOp(task: () => Promise<void>, label: string): void;
  queueLatestControlPlaneOp(
    key: string,
    task: (options: { readonly signal: AbortSignal }) => Promise<void>,
    label: string,
  ): void;
}

interface ConversationLifecycleActions {
  activateConversation(
    sessionId: string,
    options?: {
      readonly signal?: AbortSignal;
    },
  ): Promise<void>;
  openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
  takeoverConversation(sessionId: string): Promise<void>;
  beginConversationTitleEdit(conversationId: string): void;
  stopConversationTitleEdit(persistPending: boolean): void;
}

interface RuntimeDirectoryActions {
  archiveConversation(sessionId: string): Promise<void>;
  closeDirectory(directoryId: string): Promise<void>;
}

interface RuntimeRepositoryActions {
  openRepositoryPromptForCreate(): void;
  openRepositoryPromptForEdit(repositoryId: string): void;
  archiveRepositoryById(repositoryId: string): Promise<void>;
}

interface RuntimeControlActions {
  toggleGatewayProfiler(): Promise<void>;
  toggleGatewayStatusTimeline(): Promise<void>;
  toggleGatewayRenderTrace(conversationId: string | null): Promise<void>;
  refreshAllConversationTitles(): Promise<void>;
  interruptConversation(sessionId: string): Promise<void>;
}

interface TuiLeftRailInteractionNavigationActions {
  enterHomePane(): void;
  enterProjectPane(directoryId: string): void;
  enterTasksPane?(): void;
  resolveDirectoryForAction(): string | null;
  openNewThreadPrompt(directoryId: string): void;
  toggleCommandMenu(): void;
  requestStop(): void;
  markDirty(): void;
  queuePersistMuxUiState(): void;
  resetFrameCache(): void;
  releaseViewportPinForSelection(): void;
}

export interface TuiLeftRailInteractionOptions<
  TShortcutBindings extends ResolvedMuxShortcutBindings | undefined,
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  readonly workspace: WorkspaceModel;
  readonly railViewState: {
    readLatestRows(): ReturnType<typeof buildWorkspaceRailViewRows>;
  };
  readonly directories: ReadonlyMap<string, TDirectoryRecord>;
  readonly conversationRecords: ReadonlyMap<string, TConversationRecord>;
  readonly repositories: ReadonlyMap<string, unknown>;
  readonly conversationLookup: ConversationLookup;
  readonly directoryLookup: DirectoryLookup;
  readonly repositoryManager: RepositoryManagerLike;
  readonly repositoryGroupFallbackId: string;
  readonly queueControlPlaneOps: QueueControlPlaneOps;
  readonly conversationLifecycle: ConversationLifecycleActions;
  readonly runtimeDirectoryActions: RuntimeDirectoryActions;
  readonly runtimeRepositoryActions: RuntimeRepositoryActions;
  readonly runtimeControlActions: RuntimeControlActions;
  readonly navigation: TuiLeftRailInteractionNavigationActions;
  readonly shortcutBindings: TShortcutBindings;
  readonly showTasksEntry: boolean;
  readonly nowMs?: () => number;
  readonly repositoryToggleChordTimeoutMs?: number;
  readonly repositoryCollapseAllChordPrefix?: Buffer;
  readonly conversationTitleEditDoubleClickWindowMs?: number;
}

export interface TuiLeftRailInteractions {
  readonly handleRepositoryFoldInput: (input: Buffer) => boolean;
  readonly handleGlobalShortcutInput: (input: Buffer) => boolean;
  readonly leftRailPointerInput: {
    handlePointerClick(input: HandlePointerClickInput): boolean;
  };
}

const DEFAULT_CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS = 350;
const DEFAULT_REPOSITORY_TOGGLE_CHORD_TIMEOUT_MS = 1250;
const DEFAULT_REPOSITORY_COLLAPSE_ALL_CHORD_PREFIX = Buffer.from([0x0b]);

export function createTuiLeftRailInteractions<
  TShortcutBindings extends ResolvedMuxShortcutBindings | undefined,
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
>(
  options: TuiLeftRailInteractionOptions<
    TShortcutBindings,
    TDirectoryRecord,
    TConversationRecord
  >,
): TuiLeftRailInteractions {
  const nowMs = options.nowMs ?? (() => Date.now());
  const conversationTitleEditDoubleClickWindowMs =
    options.conversationTitleEditDoubleClickWindowMs ??
    DEFAULT_CONVERSATION_TITLE_EDIT_DOUBLE_CLICK_WINDOW_MS;
  const repositoryToggleChordTimeoutMs =
    options.repositoryToggleChordTimeoutMs ?? DEFAULT_REPOSITORY_TOGGLE_CHORD_TIMEOUT_MS;
  const repositoryCollapseAllChordPrefix =
    options.repositoryCollapseAllChordPrefix ?? DEFAULT_REPOSITORY_COLLAPSE_ALL_CHORD_PREFIX;

  const selectLeftNavRepository = options.workspace.selectLeftNavRepository.bind(options.workspace);
  const selectLeftNavConversation = options.workspace.selectLeftNavConversation.bind(options.workspace);
  const repositoryGroupIdForDirectory = (directoryId: string): string => {
    return options.repositoryManager.repositoryGroupIdForDirectory(
      directoryId,
      options.repositoryGroupFallbackId,
    );
  };

  const firstDirectoryForRepositoryGroup = (repositoryGroupId: string): string | null => {
    return firstDirectoryForRepositoryGroupFn(
      options.directories,
      repositoryGroupIdForDirectory,
      repositoryGroupId,
    );
  };

  const collapseRepositoryGroup = (repositoryGroupId: string): void => {
    options.repositoryManager.collapseRepositoryGroup(
      repositoryGroupId,
      options.workspace.repositoriesCollapsed,
    );
  };
  const expandRepositoryGroup = (repositoryGroupId: string): void => {
    options.repositoryManager.expandRepositoryGroup(
      repositoryGroupId,
      options.workspace.repositoriesCollapsed,
    );
  };
  const toggleRepositoryGroup = (repositoryGroupId: string): void => {
    options.repositoryManager.toggleRepositoryGroup(
      repositoryGroupId,
      options.workspace.repositoriesCollapsed,
    );
  };
  const collapseAllRepositoryGroups = (): void => {
    options.workspace.repositoriesCollapsed = options.repositoryManager.collapseAllRepositoryGroups();
    options.navigation.queuePersistMuxUiState();
  };
  const expandAllRepositoryGroups = (): void => {
    options.workspace.repositoriesCollapsed = options.repositoryManager.expandAllRepositoryGroups();
    options.navigation.queuePersistMuxUiState();
  };

  const openAddDirectoryPromptFromRail = (): void => {
    options.workspace.repositoryPrompt = null;
    options.workspace.apiKeyPrompt = null;
    options.workspace.addDirectoryPrompt = {
      value: '',
      error: null,
    };
  };

  const leftNavInput = new LeftNavInput(
    {
      railViewState: options.railViewState,
      currentSelection: () => options.workspace.leftNavSelection,
    },
    {
      enterHomePane: options.navigation.enterHomePane,
      firstDirectoryForRepositoryGroup,
      enterProjectPane: options.navigation.enterProjectPane,
      setMainPaneProjectMode: () => {
        options.workspace.mainPaneMode = 'project';
      },
      selectLeftNavRepository,
      selectLeftNavConversation,
      markDirty: options.navigation.markDirty,
      directoriesHas: (directoryId) => options.directoryLookup.hasDirectory(directoryId),
      conversationDirectoryId: (sessionId) => options.conversationLookup.directoryIdOf(sessionId),
      queueControlPlaneOp: options.queueControlPlaneOps.queueControlPlaneOp,
      queueLatestControlPlaneOp: options.queueControlPlaneOps.queueLatestControlPlaneOp,
      activateConversation: async (sessionId, activateOptions) => {
        await options.conversationLifecycle.activateConversation(sessionId, activateOptions);
      },
      conversationsHas: (sessionId) => options.conversationLookup.has(sessionId),
      ...(options.showTasksEntry
        ? {
            enterTasksPane: options.navigation.enterTasksPane,
          }
        : {}),
    },
    {
      visibleTargets: visibleLeftNavTargets,
      activateTarget: activateLeftNavTarget,
      cycleSelection: cycleLeftNavSelection,
    },
  );

  const repositoryFoldInput = new RepositoryFoldInput(
    {
      leftNavSelection: () => options.workspace.leftNavSelection,
      repositoryToggleChordPrefixAtMs: () => options.workspace.repositoryToggleChordPrefixAtMs,
      setRepositoryToggleChordPrefixAtMs: (value) => {
        options.workspace.repositoryToggleChordPrefixAtMs = value;
      },
      conversations: () => options.conversationRecords,
      repositoryGroupIdForDirectory,
      nowMs,
    },
    {
      collapseRepositoryGroup,
      expandRepositoryGroup,
      collapseAllRepositoryGroups,
      expandAllRepositoryGroups,
      selectLeftNavRepository,
      markDirty: options.navigation.markDirty,
    },
    {
      chordTimeoutMs: repositoryToggleChordTimeoutMs,
      collapseAllChordPrefix: repositoryCollapseAllChordPrefix,
    },
    {
      reduceRepositoryFoldChordInput,
      repositoryTreeArrowAction,
    },
  );

  const globalShortcutInput = new GlobalShortcutInput(
    options.shortcutBindings,
    {
      mainPaneMode: () => options.workspace.mainPaneMode,
      activeConversationId: () => options.conversationLookup.activeConversationId,
      activeConversationAgentType: () => {
        const activeConversationId = options.conversationLookup.activeConversationId;
        if (activeConversationId === null) {
          return null;
        }
        return options.conversationRecords.get(activeConversationId)?.agentType ?? null;
      },
      conversationsHas: (sessionId) => options.conversationLookup.has(sessionId),
      activeDirectoryId: () => options.workspace.activeDirectoryId,
      directoryExists: (directoryId) => options.directoryLookup.hasDirectory(directoryId),
    },
    {
      requestStop: options.navigation.requestStop,
      resolveDirectoryForAction: options.navigation.resolveDirectoryForAction,
      openNewThreadPrompt: options.navigation.openNewThreadPrompt,
      toggleCommandMenu: options.navigation.toggleCommandMenu,
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        await options.conversationLifecycle.openOrCreateCritiqueConversationInDirectory(directoryId);
      },
      toggleGatewayProfile: async () => {
        await options.runtimeControlActions.toggleGatewayProfiler();
      },
      toggleGatewayStatusTimeline: async () => {
        await options.runtimeControlActions.toggleGatewayStatusTimeline();
      },
      toggleGatewayRenderTrace: async (conversationId) => {
        await options.runtimeControlActions.toggleGatewayRenderTrace(conversationId);
      },
      queueControlPlaneOp: options.queueControlPlaneOps.queueControlPlaneOp,
      archiveConversation: async (sessionId) => {
        await options.runtimeDirectoryActions.archiveConversation(sessionId);
      },
      refreshAllConversationTitles: async () => {
        await options.runtimeControlActions.refreshAllConversationTitles();
      },
      interruptConversation: async (sessionId) => {
        await options.runtimeControlActions.interruptConversation(sessionId);
      },
      takeoverConversation: async (sessionId) => {
        await options.conversationLifecycle.takeoverConversation(sessionId);
      },
      openAddDirectoryPrompt: () => {
        openAddDirectoryPromptFromRail();
        options.navigation.markDirty();
      },
      closeDirectory: async (directoryId) => {
        await options.runtimeDirectoryActions.closeDirectory(directoryId);
      },
      cycleLeftNavSelection: (direction) => {
        leftNavInput.cycleSelection(direction);
      },
    },
    {
      detectShortcut: detectMuxGlobalShortcut,
      handleShortcut: (input) =>
        handleGlobalShortcut({
          ...input,
          toggleDebugBar: () => {
            options.workspace.showDebugBar = !options.workspace.showDebugBar;
            options.navigation.queuePersistMuxUiState();
            options.navigation.markDirty();
          },
        }),
    },
  );

  const leftRailPointerHandler = new LeftRailPointerHandler(
    {
      railViewState: options.railViewState,
      conversationTitleEditConversationId: () =>
        options.workspace.conversationTitleEdit?.conversationId ?? null,
      activeConversationId: () => options.conversationLookup.activeConversationId,
      repositoriesCollapsed: () => options.workspace.repositoriesCollapsed,
      resolveDirectoryForAction: options.navigation.resolveDirectoryForAction,
      previousConversationClickState: () => options.workspace.conversationTitleEditClickState,
      nowMs,
      isConversationPaneActive: () => options.workspace.mainPaneMode === 'conversation',
      directoriesHas: (directoryId) => options.directoryLookup.hasDirectory(directoryId),
    },
    {
      clearConversationTitleEditClickState: () => {
        options.workspace.conversationTitleEditClickState = null;
      },
      openNewThreadPrompt: options.navigation.openNewThreadPrompt,
      queueArchiveConversation: (conversationId) => {
        options.queueControlPlaneOps.queueControlPlaneOp(async () => {
          await options.runtimeDirectoryActions.archiveConversation(conversationId);
        }, 'mouse-archive-conversation');
      },
      openAddDirectoryPrompt: openAddDirectoryPromptFromRail,
      openRepositoryPromptForCreate: () => {
        options.runtimeRepositoryActions.openRepositoryPromptForCreate();
      },
      repositoryExists: (repositoryId) => options.repositories.has(repositoryId),
      openRepositoryPromptForEdit: (repositoryId) => {
        options.runtimeRepositoryActions.openRepositoryPromptForEdit(repositoryId);
      },
      queueArchiveRepository: (repositoryId) => {
        options.queueControlPlaneOps.queueControlPlaneOp(async () => {
          await options.runtimeRepositoryActions.archiveRepositoryById(repositoryId);
        }, 'mouse-archive-repository');
      },
      toggleRepositoryGroup,
      selectLeftNavRepository,
      expandAllRepositoryGroups,
      collapseAllRepositoryGroups,
      enterHomePane: options.navigation.enterHomePane,
      ...(options.showTasksEntry
        ? {
            enterTasksPane: options.navigation.enterTasksPane,
          }
        : {}),
      queueCloseDirectory: (directoryId) => {
        options.queueControlPlaneOps.queueControlPlaneOp(async () => {
          await options.runtimeDirectoryActions.closeDirectory(directoryId);
        }, 'mouse-close-directory');
      },
      toggleShortcutsCollapsed: () => {
        options.workspace.shortcutsCollapsed = !options.workspace.shortcutsCollapsed;
        options.navigation.queuePersistMuxUiState();
      },
      setConversationClickState: (next) => {
        options.workspace.conversationTitleEditClickState = next;
      },
      ensureConversationPaneActive: (conversationId) => {
        options.workspace.mainPaneMode = 'conversation';
        options.workspace.selectLeftNavConversation(conversationId);
        options.workspace.projectPaneSnapshot = null;
        options.workspace.projectPaneScrollTop = 0;
        options.navigation.resetFrameCache();
      },
      beginConversationTitleEdit: (conversationId) => {
        options.conversationLifecycle.beginConversationTitleEdit(conversationId);
      },
      queueActivateConversation: (conversationId) => {
        options.queueControlPlaneOps.queueLatestControlPlaneOp(
          'left-nav:activate-conversation',
          async ({ signal }) => {
            if (signal.aborted) {
              return;
            }
            await options.conversationLifecycle.activateConversation(conversationId, {
              signal,
            });
          },
          'mouse-activate-conversation',
        );
      },
      queueActivateConversationAndEdit: (conversationId) => {
        options.queueControlPlaneOps.queueLatestControlPlaneOp(
          'left-nav:activate-conversation',
          async ({ signal }) => {
            if (signal.aborted) {
              return;
            }
            await options.conversationLifecycle.activateConversation(conversationId, {
              signal,
            });
            if (signal.aborted) {
              return;
            }
            options.conversationLifecycle.beginConversationTitleEdit(conversationId);
          },
          'mouse-activate-edit-conversation',
        );
      },
      enterProjectPane: options.navigation.enterProjectPane,
      markDirty: options.navigation.markDirty,
    },
    {
      conversationTitleEditDoubleClickWindowMs,
    },
  );

  const leftRailPointerInput = new RailPointerInput(
    leftRailPointerHandler,
    leftRailPointerHandler,
    {
      hasActiveEdit: () => options.workspace.conversationTitleEdit !== null,
      shouldKeepActiveEdit: (hit) =>
        leftRailPointerHandler.shouldKeepConversationTitleEditActive(hit),
      stopActiveEdit: () => {
        options.conversationLifecycle.stopConversationTitleEdit(true);
      },
    },
    {
      hasSelection: () => options.workspace.selection !== null || options.workspace.selectionDrag !== null,
      clearSelection: () => {
        options.workspace.selection = null;
        options.workspace.selectionDrag = null;
        options.navigation.releaseViewportPinForSelection();
      },
    },
  );

  const handleRepositoryFoldInput = (input: Buffer): boolean => {
    return (
      repositoryFoldInput.handleRepositoryFoldChords(input) ||
      repositoryFoldInput.handleRepositoryTreeArrow(input)
    );
  };

  const handleGlobalShortcutInput = (input: Buffer): boolean => {
    return globalShortcutInput.handleInput(input);
  };

  return {
    handleRepositoryFoldInput,
    handleGlobalShortcutInput,
    leftRailPointerInput,
  };
}
