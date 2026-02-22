interface RepositoryRecordLike {
  readonly repositoryId: string;
}

interface DirectoryGitStatusLike<TRepository, TSummary, TSnapshot> {
  readonly directoryId: string;
  readonly summary: TSummary;
  readonly repositorySnapshot: TSnapshot;
  readonly repositoryId: string | null;
  readonly repository: TRepository | null;
}

export interface StartupStateHydrationServiceOptions<
  TRepository extends RepositoryRecordLike,
  TSummary,
  TSnapshot,
  TDirectoryGitStatus extends DirectoryGitStatusLike<TRepository, TSummary, TSnapshot>,
> {
  readonly hydrateConversationList: () => Promise<void>;
  readonly listRepositories: () => Promise<readonly TRepository[]>;
  readonly clearRepositories: () => void;
  readonly setRepository: (repositoryId: string, repository: TRepository) => void;
  readonly syncRepositoryAssociationsWithDirectorySnapshots: () => void;
  readonly gitHydrationEnabled: boolean;
  readonly listDirectoryGitStatuses: () => Promise<readonly TDirectoryGitStatus[]>;
  readonly setDirectoryGitSummary: (directoryId: string, summary: TSummary) => void;
  readonly setDirectoryRepositorySnapshot: (directoryId: string, snapshot: TSnapshot) => void;
  readonly setDirectoryRepositoryAssociation: (
    directoryId: string,
    repositoryId: string | null,
  ) => void;
  readonly hydrateTaskPlanningState: () => Promise<void>;
  readonly subscribeTaskPlanningEvents: (afterCursor: number | null) => Promise<void>;
  readonly ensureActiveConversationId: () => void;
  readonly activeConversationId: () => string | null;
  readonly selectLeftNavConversation: (sessionId: string) => void;
  readonly enterHomePane: () => void;
}

export interface StartupStateHydrationService {
  hydrateRepositoryList(): Promise<void>;
  hydrateDirectoryGitStatus(): Promise<void>;
  hydrateStartupState(afterCursor: number | null): Promise<void>;
}

export function createStartupStateHydrationService<
  TRepository extends RepositoryRecordLike,
  TSummary,
  TSnapshot,
  TDirectoryGitStatus extends DirectoryGitStatusLike<TRepository, TSummary, TSnapshot>,
>(
  options: StartupStateHydrationServiceOptions<
    TRepository,
    TSummary,
    TSnapshot,
    TDirectoryGitStatus
  >,
): StartupStateHydrationService {
  async function hydrateRepositoryList(): Promise<void> {
    const rows = await options.listRepositories();
    options.clearRepositories();
    for (const record of rows) {
      options.setRepository(record.repositoryId, record);
    }
    options.syncRepositoryAssociationsWithDirectorySnapshots();
  }

  async function hydrateDirectoryGitStatus(): Promise<void> {
    if (!options.gitHydrationEnabled) {
      return;
    }
    const rows = await options.listDirectoryGitStatuses();
    for (const record of rows) {
      options.setDirectoryGitSummary(record.directoryId, record.summary);
      options.setDirectoryRepositorySnapshot(record.directoryId, record.repositorySnapshot);
      options.setDirectoryRepositoryAssociation(record.directoryId, record.repositoryId);
      if (record.repository !== null) {
        options.setRepository(record.repository.repositoryId, record.repository);
      }
    }
    options.syncRepositoryAssociationsWithDirectorySnapshots();
  }

  async function hydrateStartupState(afterCursor: number | null): Promise<void> {
    await options.hydrateConversationList();
    await hydrateRepositoryList();
    await options.hydrateTaskPlanningState();
    await hydrateDirectoryGitStatus();
    await options.subscribeTaskPlanningEvents(afterCursor);
    options.ensureActiveConversationId();
    options.enterHomePane();
  }

  return {
    hydrateRepositoryList,
    hydrateDirectoryGitStatus,
    hydrateStartupState,
  };
}
