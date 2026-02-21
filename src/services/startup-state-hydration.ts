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

interface StartupStateHydrationServiceOptions<
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
  readonly enterStartupPane: () => void;
}

export class StartupStateHydrationService<
  TRepository extends RepositoryRecordLike,
  TSummary,
  TSnapshot,
  TDirectoryGitStatus extends DirectoryGitStatusLike<TRepository, TSummary, TSnapshot>,
> {
  constructor(
    private readonly options: StartupStateHydrationServiceOptions<
      TRepository,
      TSummary,
      TSnapshot,
      TDirectoryGitStatus
    >,
  ) {}

  async hydrateRepositoryList(): Promise<void> {
    const rows = await this.options.listRepositories();
    this.options.clearRepositories();
    for (const record of rows) {
      this.options.setRepository(record.repositoryId, record);
    }
    this.options.syncRepositoryAssociationsWithDirectorySnapshots();
  }

  async hydrateDirectoryGitStatus(): Promise<void> {
    if (!this.options.gitHydrationEnabled) {
      return;
    }
    const rows = await this.options.listDirectoryGitStatuses();
    for (const record of rows) {
      this.options.setDirectoryGitSummary(record.directoryId, record.summary);
      this.options.setDirectoryRepositorySnapshot(record.directoryId, record.repositorySnapshot);
      this.options.setDirectoryRepositoryAssociation(record.directoryId, record.repositoryId);
      if (record.repository !== null) {
        this.options.setRepository(record.repository.repositoryId, record.repository);
      }
    }
    this.options.syncRepositoryAssociationsWithDirectorySnapshots();
  }

  async hydrateStartupState(afterCursor: number | null): Promise<void> {
    await this.options.hydrateConversationList();
    await this.hydrateRepositoryList();
    await this.options.hydrateTaskPlanningState();
    await this.hydrateDirectoryGitStatus();
    await this.options.subscribeTaskPlanningEvents(afterCursor);
    this.options.ensureActiveConversationId();
    this.options.enterStartupPane();
  }
}
