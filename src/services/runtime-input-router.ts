import { RuntimeMainPaneInput } from './runtime-main-pane-input.ts';
import { RuntimeModalInput } from './runtime-modal-input.ts';
import { RuntimeRailInput } from './runtime-rail-input.ts';
import type { CommandMenuActionDescriptor } from '../mux/live-mux/command-menu.ts';

type RuntimeModalInputOptions = ConstructorParameters<typeof RuntimeModalInput>[0];
type RuntimeRailInputOptions = ConstructorParameters<typeof RuntimeRailInput>[0];
type RuntimeMainPaneInputOptions = ConstructorParameters<typeof RuntimeMainPaneInput>[0];
type RuntimeMainPaneInputWithoutLeftRail = Omit<
  RuntimeMainPaneInputOptions,
  'leftRailPointerInput'
>;
type RuntimeWorkspaceActions = RuntimeModalInputOptions['workspaceActions'] &
  RuntimeRailInputOptions['runtimeWorkspaceActions'] &
  RuntimeMainPaneInputWithoutLeftRail['workspaceActions'];
type RuntimeTaskEditorActions = RuntimeModalInputOptions['taskEditorActions'];
type RuntimeShortcutBindings = RuntimeRailInputOptions['shortcutBindings'];
type RuntimeConversationRecord = {
  title: string;
  directoryId: string | null;
};

interface RuntimeInputRouterOptions {
  readonly workspace: RuntimeModalInputOptions['workspace'];
  readonly conversations: ReadonlyMap<string, RuntimeConversationRecord>;
  readonly runtimeWorkspaceActions: RuntimeWorkspaceActions;
  readonly runtimeTaskEditorActions: RuntimeTaskEditorActions;
  readonly detectShortcut: (input: Buffer, bindings: RuntimeShortcutBindings) => string | null;
  readonly modalDismissShortcutBindings: RuntimeShortcutBindings;
  readonly shortcutBindings: RuntimeShortcutBindings;
  readonly dismissOnOutsideClick: RuntimeModalInputOptions['dismissOnOutsideClick'];
  readonly buildCommandMenuModalOverlay: RuntimeModalInputOptions['buildCommandMenuModalOverlay'];
  readonly buildConversationTitleModalOverlay: RuntimeModalInputOptions['buildConversationTitleModalOverlay'];
  readonly buildNewThreadModalOverlay: RuntimeModalInputOptions['buildNewThreadModalOverlay'];
  readonly resolveNewThreadPromptAgentByRow: RuntimeModalInputOptions['resolveNewThreadPromptAgentByRow'];
  readonly stopConversationTitleEdit: (persistPending: boolean) => void;
  readonly queueControlPlaneOp: RuntimeModalInputOptions['queueControlPlaneOp'];
  readonly normalizeGitHubRemoteUrl: RuntimeModalInputOptions['normalizeGitHubRemoteUrl'];
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly markDirty: () => void;
  readonly scheduleConversationTitlePersist: () => void;
  readonly resolveCommandMenuActions: () => readonly CommandMenuActionDescriptor[];
  readonly executeCommandMenuAction: (actionId: string) => void;
  readonly persistApiKey?: RuntimeModalInputOptions['persistApiKey'];
  readonly requestStop: RuntimeRailInputOptions['requestStop'];
  readonly resolveDirectoryForAction: RuntimeRailInputOptions['resolveDirectoryForAction'];
  readonly toggleCommandMenu: RuntimeRailInputOptions['toggleCommandMenu'];
  readonly openNewThreadPrompt: RuntimeRailInputOptions['openNewThreadPrompt'];
  readonly firstDirectoryForRepositoryGroup: RuntimeRailInputOptions['firstDirectoryForRepositoryGroup'];
  readonly enterHomePane: RuntimeRailInputOptions['enterHomePane'];
  readonly enterProjectPane: RuntimeRailInputOptions['enterProjectPane'];
  readonly queuePersistMuxUiState: RuntimeRailInputOptions['queuePersistMuxUiState'];
  readonly repositoryGroupIdForDirectory: RuntimeRailInputOptions['repositoryGroupIdForDirectory'];
  readonly toggleRepositoryGroup: RuntimeRailInputOptions['toggleRepositoryGroup'];
  readonly collapseRepositoryGroup: RuntimeRailInputOptions['collapseRepositoryGroup'];
  readonly expandRepositoryGroup: RuntimeRailInputOptions['expandRepositoryGroup'];
  readonly collapseAllRepositoryGroups: RuntimeRailInputOptions['collapseAllRepositoryGroups'];
  readonly expandAllRepositoryGroups: RuntimeRailInputOptions['expandAllRepositoryGroups'];
  readonly directoriesHas: RuntimeRailInputOptions['directoriesHas'];
  readonly conversationDirectoryId: RuntimeRailInputOptions['conversationDirectoryId'];
  readonly conversationsHas: RuntimeRailInputOptions['conversationsHas'];
  readonly getMainPaneMode: RuntimeRailInputOptions['getMainPaneMode'];
  readonly getActiveConversationId: RuntimeRailInputOptions['getActiveConversationId'];
  readonly getActiveDirectoryId: RuntimeRailInputOptions['getActiveDirectoryId'];
  readonly chordTimeoutMs: RuntimeRailInputOptions['chordTimeoutMs'];
  readonly collapseAllChordPrefix: RuntimeRailInputOptions['collapseAllChordPrefix'];
  readonly releaseViewportPinForSelection: RuntimeRailInputOptions['releaseViewportPinForSelection'];
  readonly beginConversationTitleEdit: RuntimeRailInputOptions['beginConversationTitleEdit'];
  readonly resetConversationPaneFrameCache: RuntimeRailInputOptions['resetConversationPaneFrameCache'];
  readonly conversationTitleEditDoubleClickWindowMs: RuntimeRailInputOptions['conversationTitleEditDoubleClickWindowMs'];
  readonly projectPaneActionAtRow: RuntimeMainPaneInputWithoutLeftRail['projectPaneActionAtRow'];
  readonly queueCloseDirectory: RuntimeMainPaneInputWithoutLeftRail['queueCloseDirectory'];
  readonly selectTaskById: RuntimeMainPaneInputWithoutLeftRail['selectTaskById'];
  readonly selectRepositoryById: RuntimeMainPaneInputWithoutLeftRail['selectRepositoryById'];
  readonly taskPaneActionAtCell: RuntimeMainPaneInputWithoutLeftRail['taskPaneActionAtCell'];
  readonly taskPaneActionAtRow: RuntimeMainPaneInputWithoutLeftRail['taskPaneActionAtRow'];
  readonly taskPaneTaskIdAtRow: RuntimeMainPaneInputWithoutLeftRail['taskPaneTaskIdAtRow'];
  readonly taskPaneRepositoryIdAtRow: RuntimeMainPaneInputWithoutLeftRail['taskPaneRepositoryIdAtRow'];
  readonly applyPaneDividerAtCol: RuntimeMainPaneInputWithoutLeftRail['applyPaneDividerAtCol'];
  readonly pinViewportForSelection: RuntimeMainPaneInputWithoutLeftRail['pinViewportForSelection'];
  readonly homePaneEditDoubleClickWindowMs: RuntimeMainPaneInputWithoutLeftRail['homePaneEditDoubleClickWindowMs'];
}

export class RuntimeInputRouter {
  private readonly modalInput: RuntimeModalInput;
  private readonly railInput: RuntimeRailInput;
  private readonly mainPaneInput: RuntimeMainPaneInput;

  constructor(options: RuntimeInputRouterOptions) {
    this.modalInput = new RuntimeModalInput({
      workspace: options.workspace,
      conversations: options.conversations,
      workspaceActions: options.runtimeWorkspaceActions,
      taskEditorActions: options.runtimeTaskEditorActions,
      isModalDismissShortcut: (input) =>
        options.detectShortcut(input, options.modalDismissShortcutBindings) === 'mux.app.quit',
      isCommandMenuToggleShortcut: (input) =>
        options.detectShortcut(input, options.shortcutBindings) === 'mux.command-menu.toggle',
      isArchiveConversationShortcut: (input) => {
        const action = options.detectShortcut(input, options.shortcutBindings);
        return action === 'mux.conversation.archive' || action === 'mux.conversation.delete';
      },
      dismissOnOutsideClick: options.dismissOnOutsideClick,
      buildCommandMenuModalOverlay: options.buildCommandMenuModalOverlay,
      buildConversationTitleModalOverlay: options.buildConversationTitleModalOverlay,
      buildNewThreadModalOverlay: options.buildNewThreadModalOverlay,
      resolveNewThreadPromptAgentByRow: options.resolveNewThreadPromptAgentByRow,
      stopConversationTitleEdit: options.stopConversationTitleEdit,
      queueControlPlaneOp: options.queueControlPlaneOp,
      normalizeGitHubRemoteUrl: options.normalizeGitHubRemoteUrl,
      repositoriesHas: options.repositoriesHas,
      markDirty: options.markDirty,
      scheduleConversationTitlePersist: options.scheduleConversationTitlePersist,
      resolveCommandMenuActions: options.resolveCommandMenuActions,
      executeCommandMenuAction: options.executeCommandMenuAction,
      ...(options.persistApiKey === undefined
        ? {}
        : {
            persistApiKey: options.persistApiKey,
          }),
    });
    const runtimeRailOptions: RuntimeRailInputOptions = {
      workspace: options.workspace,
      shortcutBindings: options.shortcutBindings,
      queueControlPlaneOp: options.queueControlPlaneOp,
      runtimeWorkspaceActions: options.runtimeWorkspaceActions,
      requestStop: options.requestStop,
      resolveDirectoryForAction: options.resolveDirectoryForAction,
      openNewThreadPrompt: options.openNewThreadPrompt,
      toggleCommandMenu: options.toggleCommandMenu,
      firstDirectoryForRepositoryGroup: options.firstDirectoryForRepositoryGroup,
      enterHomePane: options.enterHomePane,
      enterProjectPane: options.enterProjectPane,
      markDirty: options.markDirty,
      queuePersistMuxUiState: options.queuePersistMuxUiState,
      conversations: options.conversations,
      repositoryGroupIdForDirectory: options.repositoryGroupIdForDirectory,
      toggleRepositoryGroup: options.toggleRepositoryGroup,
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
      repositoriesHas: options.repositoriesHas,
      chordTimeoutMs: options.chordTimeoutMs,
      collapseAllChordPrefix: options.collapseAllChordPrefix,
      stopConversationTitleEdit: options.stopConversationTitleEdit,
      releaseViewportPinForSelection: options.releaseViewportPinForSelection,
      beginConversationTitleEdit: options.beginConversationTitleEdit,
      resetConversationPaneFrameCache: options.resetConversationPaneFrameCache,
      conversationTitleEditDoubleClickWindowMs: options.conversationTitleEditDoubleClickWindowMs,
    };
    this.railInput = new RuntimeRailInput(runtimeRailOptions);
    this.mainPaneInput = new RuntimeMainPaneInput({
      workspace: options.workspace,
      workspaceActions: options.runtimeWorkspaceActions,
      projectPaneActionAtRow: options.projectPaneActionAtRow,
      openNewThreadPrompt: options.openNewThreadPrompt,
      queueCloseDirectory: options.queueCloseDirectory,
      selectTaskById: options.selectTaskById,
      selectRepositoryById: options.selectRepositoryById,
      taskPaneActionAtCell: options.taskPaneActionAtCell,
      taskPaneActionAtRow: options.taskPaneActionAtRow,
      taskPaneTaskIdAtRow: options.taskPaneTaskIdAtRow,
      taskPaneRepositoryIdAtRow: options.taskPaneRepositoryIdAtRow,
      applyPaneDividerAtCol: options.applyPaneDividerAtCol,
      pinViewportForSelection: options.pinViewportForSelection,
      releaseViewportPinForSelection: options.releaseViewportPinForSelection,
      markDirty: options.markDirty,
      homePaneEditDoubleClickWindowMs: options.homePaneEditDoubleClickWindowMs,
      leftRailPointerInput: this.railInput,
    });
  }

  routeModalInput(input: Buffer): boolean {
    return this.modalInput.routeModalInput(input);
  }

  handleRepositoryFoldInput(input: Buffer): boolean {
    return this.railInput.handleRepositoryFoldInput(input);
  }

  handleGlobalShortcutInput(input: Buffer): boolean {
    return this.railInput.handleGlobalShortcutInput(input);
  }

  inputTokenRouter(): Pick<RuntimeMainPaneInput, 'routeTokens'> {
    return this.mainPaneInput;
  }
}
