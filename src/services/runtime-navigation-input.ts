import type { WorkspaceModel } from '../domain/workspace.ts';
import type { resolveMuxShortcutBindings } from '../mux/input-shortcuts.ts';
import { GlobalShortcutInput } from '../ui/global-shortcut-input.ts';
import { LeftNavInput } from '../ui/left-nav-input.ts';
import { RepositoryFoldInput } from '../ui/repository-fold-input.ts';

type LeftNavInputOptions = ConstructorParameters<typeof LeftNavInput>[0];
type RepositoryFoldInputOptions = ConstructorParameters<typeof RepositoryFoldInput>[0];
type GlobalShortcutInputOptions = ConstructorParameters<typeof GlobalShortcutInput>[0];

type MainPaneMode = 'conversation' | 'project' | 'home';

interface RuntimeNavigationWorkspaceActions {
  activateConversation(sessionId: string): Promise<void>;
  openOrCreateCritiqueConversationInDirectory(directoryId: string): Promise<void>;
  toggleGatewayProfiler(): Promise<void>;
  toggleGatewayStatusTimeline(): Promise<void>;
  toggleGatewayRenderTrace(conversationId: string | null): Promise<void>;
  archiveConversation(sessionId: string): Promise<void>;
  interruptConversation(sessionId: string): Promise<void>;
  takeoverConversation(sessionId: string): Promise<void>;
  closeDirectory(directoryId: string): Promise<void>;
}

interface RuntimeNavigationInputOptions {
  readonly workspace: WorkspaceModel;
  readonly shortcutBindings: ReturnType<typeof resolveMuxShortcutBindings>;
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly openAddDirectoryPrompt: () => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly firstDirectoryForRepositoryGroup: (repositoryGroupId: string) => string | null;
  readonly enterHomePane: () => void;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly markDirty: () => void;
  readonly conversations: ReadonlyMap<string, { directoryId: string | null }>;
  readonly repositoryGroupIdForDirectory: (directoryId: string) => string;
  readonly collapseRepositoryGroup: (repositoryGroupId: string) => void;
  readonly expandRepositoryGroup: (repositoryGroupId: string) => void;
  readonly collapseAllRepositoryGroups: () => void;
  readonly expandAllRepositoryGroups: () => void;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getActiveConversationId: () => string | null;
  readonly getActiveDirectoryId: () => string | null;
  readonly workspaceActions: RuntimeNavigationWorkspaceActions;
  readonly chordTimeoutMs: number;
  readonly collapseAllChordPrefix: Buffer;
  readonly nowMs?: () => number;
}

interface RuntimeNavigationInputDependencies {
  readonly createLeftNavInput?: (
    options: LeftNavInputOptions,
  ) => Pick<LeftNavInput, 'cycleSelection'>;
  readonly createRepositoryFoldInput?: (
    options: RepositoryFoldInputOptions,
  ) => Pick<RepositoryFoldInput, 'handleRepositoryFoldChords' | 'handleRepositoryTreeArrow'>;
  readonly createGlobalShortcutInput?: (
    options: GlobalShortcutInputOptions,
  ) => Pick<GlobalShortcutInput, 'handleInput'>;
}

export class RuntimeNavigationInput {
  private readonly leftNavInput: Pick<LeftNavInput, 'cycleSelection'>;
  private readonly repositoryFoldInput: Pick<
    RepositoryFoldInput,
    'handleRepositoryFoldChords' | 'handleRepositoryTreeArrow'
  >;
  private readonly globalShortcutInput: Pick<GlobalShortcutInput, 'handleInput'>;

  constructor(
    options: RuntimeNavigationInputOptions,
    dependencies: RuntimeNavigationInputDependencies = {},
  ) {
    const nowMs = options.nowMs ?? (() => Date.now());
    const createLeftNavInput =
      dependencies.createLeftNavInput ??
      ((leftNavOptions: LeftNavInputOptions) => new LeftNavInput(leftNavOptions));
    const createRepositoryFoldInput =
      dependencies.createRepositoryFoldInput ??
      ((repositoryFoldOptions: RepositoryFoldInputOptions) =>
        new RepositoryFoldInput(repositoryFoldOptions));
    const createGlobalShortcutInput =
      dependencies.createGlobalShortcutInput ??
      ((globalShortcutOptions: GlobalShortcutInputOptions) =>
        new GlobalShortcutInput(globalShortcutOptions));
    const selectLeftNavRepository = options.workspace.selectLeftNavRepository.bind(options.workspace);

    this.leftNavInput = createLeftNavInput({
      getLatestRailRows: () => options.workspace.latestRailViewRows,
      getCurrentSelection: () => options.workspace.leftNavSelection,
      enterHomePane: options.enterHomePane,
      firstDirectoryForRepositoryGroup: options.firstDirectoryForRepositoryGroup,
      enterProjectPane: options.enterProjectPane,
      setMainPaneProjectMode: () => {
        options.workspace.mainPaneMode = 'project';
      },
      selectLeftNavRepository,
      markDirty: options.markDirty,
      directoriesHas: options.directoriesHas,
      conversationDirectoryId: options.conversationDirectoryId,
      queueControlPlaneOp: options.queueControlPlaneOp,
      activateConversation: async (sessionId) => {
        await options.workspaceActions.activateConversation(sessionId);
      },
      conversationsHas: options.conversationsHas,
    });

    this.repositoryFoldInput = createRepositoryFoldInput({
      getLeftNavSelection: () => options.workspace.leftNavSelection,
      getRepositoryToggleChordPrefixAtMs: () => options.workspace.repositoryToggleChordPrefixAtMs,
      setRepositoryToggleChordPrefixAtMs: (value) => {
        options.workspace.repositoryToggleChordPrefixAtMs = value;
      },
      conversations: options.conversations,
      repositoryGroupIdForDirectory: options.repositoryGroupIdForDirectory,
      collapseRepositoryGroup: options.collapseRepositoryGroup,
      expandRepositoryGroup: options.expandRepositoryGroup,
      collapseAllRepositoryGroups: options.collapseAllRepositoryGroups,
      expandAllRepositoryGroups: options.expandAllRepositoryGroups,
      selectLeftNavRepository,
      markDirty: options.markDirty,
      chordTimeoutMs: options.chordTimeoutMs,
      collapseAllChordPrefix: options.collapseAllChordPrefix,
      nowMs,
    });

    this.globalShortcutInput = createGlobalShortcutInput({
      shortcutBindings: options.shortcutBindings,
      requestStop: options.requestStop,
      resolveDirectoryForAction: options.resolveDirectoryForAction,
      openNewThreadPrompt: options.openNewThreadPrompt,
      toggleCommandMenu: options.toggleCommandMenu,
      openOrCreateCritiqueConversationInDirectory: async (directoryId) => {
        await options.workspaceActions.openOrCreateCritiqueConversationInDirectory(directoryId);
      },
      toggleGatewayProfile: async () => {
        await options.workspaceActions.toggleGatewayProfiler();
      },
      toggleGatewayStatusTimeline: async () => {
        await options.workspaceActions.toggleGatewayStatusTimeline();
      },
      toggleGatewayRenderTrace: async (conversationId) => {
        await options.workspaceActions.toggleGatewayRenderTrace(conversationId);
      },
      getMainPaneMode: options.getMainPaneMode,
      getActiveConversationId: options.getActiveConversationId,
      conversationsHas: options.conversationsHas,
      queueControlPlaneOp: options.queueControlPlaneOp,
      archiveConversation: async (sessionId) => {
        await options.workspaceActions.archiveConversation(sessionId);
      },
      interruptConversation: async (sessionId) => {
        await options.workspaceActions.interruptConversation(sessionId);
      },
      takeoverConversation: async (sessionId) => {
        await options.workspaceActions.takeoverConversation(sessionId);
      },
      openAddDirectoryPrompt: options.openAddDirectoryPrompt,
      getActiveDirectoryId: options.getActiveDirectoryId,
      directoryExists: options.directoriesHas,
      closeDirectory: async (directoryId) => {
        await options.workspaceActions.closeDirectory(directoryId);
      },
      cycleLeftNavSelection: (direction) => {
        this.leftNavInput.cycleSelection(direction);
      },
    });
  }

  cycleLeftNavSelection(direction: 'next' | 'previous'): boolean {
    return this.leftNavInput.cycleSelection(direction);
  }

  handleRepositoryFoldInput(input: Buffer): boolean {
    return (
      this.repositoryFoldInput.handleRepositoryFoldChords(input) ||
      this.repositoryFoldInput.handleRepositoryTreeArrow(input)
    );
  }

  handleGlobalShortcutInput(input: Buffer): boolean {
    return this.globalShortcutInput.handleInput(input);
  }
}
