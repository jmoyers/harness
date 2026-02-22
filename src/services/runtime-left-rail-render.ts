import type { WorkspaceModel } from '../domain/workspace.ts';
import type { RepositoryManager } from '../domain/repositories.ts';

export interface RuntimeLeftRailRenderLayout {
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
    gitSummaryByDirectoryId: ReadonlyMap<string, TGitSummary>;
    processUsageBySessionId: ReadonlyMap<string, TProcessUsage>;
    loadingGitSummary: TGitSummary;
  }): {
    readonly ansiRows: readonly string[];
    readonly viewRows: TRailViewRows;
  };
}

export interface RuntimeLeftRailRenderSnapshot<
  TDirectoryRecord,
  TConversationRecord,
  TRepositoryRecord,
  TProcessUsage,
> {
  readonly repositories: ReadonlyMap<string, TRepositoryRecord>;
  readonly directories: ReadonlyMap<string, TDirectoryRecord>;
  readonly conversations: ReadonlyMap<string, TConversationRecord>;
  readonly orderedConversationIds: readonly string[];
  readonly processUsageBySessionId: ReadonlyMap<string, TProcessUsage>;
  readonly activeConversationId: string | null;
}

export interface RuntimeLeftRailRenderOptions<
  TDirectoryRecord,
  TConversationRecord,
  TRepositoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
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
    TRailViewRows
  >;
  readonly sessionProjectionInstrumentation: SessionProjectionInstrumentationLike<
    TDirectoryRecord,
    TConversationRecord
  >;
  readonly workspace: WorkspaceModel;
  readonly repositoryManager: RepositoryManager<TRepositoryRecord, TRepositorySnapshot>;
  readonly repositoryAssociationByDirectoryId: ReadonlyMap<string, string>;
  readonly directoryRepositorySnapshotByDirectoryId: ReadonlyMap<string, TRepositorySnapshot>;
  readonly gitSummaryByDirectoryId: ReadonlyMap<string, TGitSummary>;
  readonly loadingGitSummary: TGitSummary;
  readonly showTasksEntry?: boolean;
}

export class RuntimeLeftRailRender<
  TDirectoryRecord,
  TConversationRecord,
  TRepositoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
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
      TRailViewRows
    >,
  ) {}

  render(input: {
    readonly layout: RuntimeLeftRailRenderLayout;
    readonly snapshot: RuntimeLeftRailRenderSnapshot<
      TDirectoryRecord,
      TConversationRecord,
      TRepositoryRecord,
      TProcessUsage
    >;
  }): {
    readonly ansiRows: readonly string[];
    readonly viewRows: TRailViewRows;
  } {
    this.options.sessionProjectionInstrumentation.refreshSelectorSnapshot(
      'render',
      input.snapshot.directories,
      input.snapshot.conversations,
      input.snapshot.orderedConversationIds,
    );
    return this.options.leftRailPane.render({
      layout: input.layout,
      repositories: input.snapshot.repositories,
      repositoryAssociationByDirectoryId: this.options.repositoryAssociationByDirectoryId,
      directoryRepositorySnapshotByDirectoryId:
        this.options.directoryRepositorySnapshotByDirectoryId,
      directories: input.snapshot.directories,
      conversations: input.snapshot.conversations,
      orderedIds: input.snapshot.orderedConversationIds,
      activeProjectId: this.options.workspace.activeDirectoryId,
      activeRepositoryId: this.options.workspace.activeRepositorySelectionId,
      activeConversationId: input.snapshot.activeConversationId,
      projectSelectionEnabled: this.options.workspace.leftNavSelection.kind === 'project',
      repositorySelectionEnabled: this.options.workspace.leftNavSelection.kind === 'repository',
      homeSelectionEnabled: this.options.workspace.leftNavSelection.kind === 'home',
      tasksSelectionEnabled: this.options.workspace.leftNavSelection.kind === 'tasks',
      showTasksEntry: this.options.showTasksEntry ?? true,
      repositoriesCollapsed: this.options.workspace.repositoriesCollapsed,
      collapsedRepositoryGroupIds:
        this.options.repositoryManager.readonlyCollapsedRepositoryGroupIds(),
      gitSummaryByDirectoryId: this.options.gitSummaryByDirectoryId,
      processUsageBySessionId: input.snapshot.processUsageBySessionId,
      loadingGitSummary: this.options.loadingGitSummary,
    });
  }
}
