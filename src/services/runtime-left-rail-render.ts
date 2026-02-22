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

export function renderRuntimeLeftRail<
  TDirectoryRecord,
  TConversationRecord,
  TRepositoryRecord,
  TRepositorySnapshot,
  TGitSummary,
  TProcessUsage,
  TRailViewRows,
>(
  options: RuntimeLeftRailRenderOptions<
    TDirectoryRecord,
    TConversationRecord,
    TRepositoryRecord,
    TRepositorySnapshot,
    TGitSummary,
    TProcessUsage,
    TRailViewRows
  >,
  input: {
    readonly layout: RuntimeLeftRailRenderLayout;
    readonly snapshot: RuntimeLeftRailRenderSnapshot<
      TDirectoryRecord,
      TConversationRecord,
      TRepositoryRecord,
      TProcessUsage
    >;
  },
): {
  readonly ansiRows: readonly string[];
  readonly viewRows: TRailViewRows;
} {
  options.sessionProjectionInstrumentation.refreshSelectorSnapshot(
    'render',
    input.snapshot.directories,
    input.snapshot.conversations,
    input.snapshot.orderedConversationIds,
  );
  return options.leftRailPane.render({
    layout: input.layout,
    repositories: input.snapshot.repositories,
    repositoryAssociationByDirectoryId: options.repositoryAssociationByDirectoryId,
    directoryRepositorySnapshotByDirectoryId: options.directoryRepositorySnapshotByDirectoryId,
    directories: input.snapshot.directories,
    conversations: input.snapshot.conversations,
    orderedIds: input.snapshot.orderedConversationIds,
    activeProjectId: options.workspace.activeDirectoryId,
    activeRepositoryId: options.workspace.activeRepositorySelectionId,
    activeConversationId: input.snapshot.activeConversationId,
    projectSelectionEnabled: options.workspace.leftNavSelection.kind === 'project',
    repositorySelectionEnabled: options.workspace.leftNavSelection.kind === 'repository',
    homeSelectionEnabled: options.workspace.leftNavSelection.kind === 'home',
    tasksSelectionEnabled: options.workspace.leftNavSelection.kind === 'tasks',
    showTasksEntry: options.showTasksEntry ?? true,
    repositoriesCollapsed: options.workspace.repositoriesCollapsed,
    collapsedRepositoryGroupIds: options.repositoryManager.readonlyCollapsedRepositoryGroupIds(),
    gitSummaryByDirectoryId: options.gitSummaryByDirectoryId,
    processUsageBySessionId: input.snapshot.processUsageBySessionId,
    loadingGitSummary: options.loadingGitSummary,
  });
}
