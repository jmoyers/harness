import type { WorkspaceModel } from '../domain/workspace.ts';
import type { RepositoryManager } from '../domain/repositories.ts';

interface RuntimeLeftRailRenderLayout {
  readonly cols: number;
  readonly paneRows: number;
  readonly leftCols: number;
  readonly rightCols: number;
  readonly separatorCol: number;
  readonly rightStartCol: number;
}

interface SessionProjectionInstrumentationLike<TDirectoryRecord, TConversationRecord> {
  refreshSelectorSnapshot(
    source: 'render' | 'observed',
    directories: ReadonlyMap<string, TDirectoryRecord>,
    conversations: ReadonlyMap<string, TConversationRecord>,
    orderedConversationIds: readonly string[],
  ): void;
}

interface LeftRailPaneLike<
  TLayout,
  TRepositoryRecord,
  TRepositorySnapshot,
  TDirectoryRecord,
  TConversationRecord,
  TGitSummary,
  TProcessUsage,
  TShortcutBindings,
  TRailViewRows,
> {
  render(input: {
    layout: TLayout;
    repositories: ReadonlyMap<string, TRepositoryRecord>;
    repositoryAssociationByDirectoryId: ReadonlyMap<string, string>;
    directoryRepositorySnapshotByDirectoryId: ReadonlyMap<string, TRepositorySnapshot>;
    directories: ReadonlyMap<string, TDirectoryRecord>;
    conversations: ReadonlyMap<string, TConversationRecord>;
    orderedIds: readonly string[];
    activeProjectId: string | null;
    activeRepositoryId: string | null;
    activeConversationId: string | null;
    projectSelectionEnabled: boolean;
    repositorySelectionEnabled: boolean;
    homeSelectionEnabled: boolean;
    tasksSelectionEnabled: boolean;
    showTasksEntry: boolean;
    repositoriesCollapsed: boolean;
    collapsedRepositoryGroupIds: ReadonlySet<string>;
    shortcutsCollapsed: boolean;
    gitSummaryByDirectoryId: ReadonlyMap<string, TGitSummary>;
    processUsageBySessionId: ReadonlyMap<string, TProcessUsage>;
    shortcutBindings: TShortcutBindings;
    loadingGitSummary: TGitSummary;
  }): {
    readonly ansiRows: readonly string[];
    readonly viewRows: TRailViewRows;
  };
}

interface RuntimeLeftRailRenderOptions<
  TDirectoryRecord,
  TConversationRecord,
  TRepositoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
  TShortcutBindings,
  TRailViewRows,
> {
  readonly leftRailPane: LeftRailPaneLike<
    RuntimeLeftRailRenderLayout,
    TRepositoryRecord,
    TRepositorySnapshot,
    TDirectoryRecord,
    TConversationRecord,
    TGitSummary,
    TProcessUsage,
    TShortcutBindings,
    TRailViewRows
  >;
  readonly sessionProjectionInstrumentation: SessionProjectionInstrumentationLike<
    TDirectoryRecord,
    TConversationRecord
  >;
  readonly workspace: WorkspaceModel;
  readonly repositoryManager: RepositoryManager<TRepositoryRecord, TRepositorySnapshot>;
  readonly repositories: ReadonlyMap<string, TRepositoryRecord>;
  readonly repositoryAssociationByDirectoryId: ReadonlyMap<string, string>;
  readonly directoryRepositorySnapshotByDirectoryId: ReadonlyMap<string, TRepositorySnapshot>;
  readonly directories: ReadonlyMap<string, TDirectoryRecord>;
  readonly conversations: ReadonlyMap<string, TConversationRecord>;
  readonly gitSummaryByDirectoryId: ReadonlyMap<string, TGitSummary>;
  readonly processUsageBySessionId: () => ReadonlyMap<string, TProcessUsage>;
  readonly shortcutBindings: TShortcutBindings;
  readonly loadingGitSummary: TGitSummary;
  readonly showTasksEntry?: boolean;
  readonly activeConversationId: () => string | null;
  readonly orderedConversationIds: () => readonly string[];
}

export class RuntimeLeftRailRender<
  TDirectoryRecord,
  TConversationRecord,
  TRepositoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
  TShortcutBindings,
  TRailViewRows,
> {
  constructor(
    private readonly options: RuntimeLeftRailRenderOptions<
      TDirectoryRecord,
      TConversationRecord,
      TRepositoryRecord,
      TRepositorySnapshot,
      TGitSummary,
      TProcessUsage,
      TShortcutBindings,
      TRailViewRows
    >,
  ) {}

  render(layout: RuntimeLeftRailRenderLayout): {
    readonly ansiRows: readonly string[];
    readonly viewRows: TRailViewRows;
  } {
    const orderedIds = this.options.orderedConversationIds();
    this.options.sessionProjectionInstrumentation.refreshSelectorSnapshot(
      'render',
      this.options.directories,
      this.options.conversations,
      orderedIds,
    );
    return this.options.leftRailPane.render({
      layout,
      repositories: this.options.repositories,
      repositoryAssociationByDirectoryId: this.options.repositoryAssociationByDirectoryId,
      directoryRepositorySnapshotByDirectoryId:
        this.options.directoryRepositorySnapshotByDirectoryId,
      directories: this.options.directories,
      conversations: this.options.conversations,
      orderedIds,
      activeProjectId: this.options.workspace.activeDirectoryId,
      activeRepositoryId: this.options.workspace.activeRepositorySelectionId,
      activeConversationId: this.options.activeConversationId(),
      projectSelectionEnabled: this.options.workspace.leftNavSelection.kind === 'project',
      repositorySelectionEnabled: this.options.workspace.leftNavSelection.kind === 'repository',
      homeSelectionEnabled: this.options.workspace.leftNavSelection.kind === 'home',
      tasksSelectionEnabled: this.options.workspace.leftNavSelection.kind === 'tasks',
      showTasksEntry: this.options.showTasksEntry ?? true,
      repositoriesCollapsed: this.options.workspace.repositoriesCollapsed,
      collapsedRepositoryGroupIds:
        this.options.repositoryManager.readonlyCollapsedRepositoryGroupIds(),
      shortcutsCollapsed: this.options.workspace.shortcutsCollapsed,
      gitSummaryByDirectoryId: this.options.gitSummaryByDirectoryId,
      processUsageBySessionId: this.options.processUsageBySessionId(),
      shortcutBindings: this.options.shortcutBindings,
      loadingGitSummary: this.options.loadingGitSummary,
    });
  }
}
