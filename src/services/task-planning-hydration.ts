interface RepositoryRecordLike {
  readonly repositoryId: string;
}

interface TaskRecordLike {
  readonly taskId: string;
}

interface TaskPlanningHydrationServiceControlPlane<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  listRepositories(): Promise<readonly TRepositoryRecord[]>;
  listTasks(limit: number): Promise<readonly TTaskRecord[]>;
}

interface TaskPlanningHydrationServiceOptions<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  readonly controlPlaneService: TaskPlanningHydrationServiceControlPlane<
    TRepositoryRecord,
    TTaskRecord
  >;
  readonly clearRepositories: () => void;
  readonly setRepository: (repository: TRepositoryRecord) => void;
  readonly syncTaskPaneRepositorySelection: () => void;
  readonly clearTasks: () => void;
  readonly setTask: (task: TTaskRecord) => void;
  readonly syncTaskPaneSelection: () => void;
  readonly markDirty: () => void;
  readonly taskLimit: number;
}

export class TaskPlanningHydrationService<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  constructor(
    private readonly options: TaskPlanningHydrationServiceOptions<TRepositoryRecord, TTaskRecord>,
  ) {}

  async hydrate(): Promise<void> {
    this.options.clearRepositories();
    for (const repository of await this.options.controlPlaneService.listRepositories()) {
      this.options.setRepository(repository);
    }
    this.options.syncTaskPaneRepositorySelection();

    this.options.clearTasks();
    for (const task of await this.options.controlPlaneService.listTasks(this.options.taskLimit)) {
      this.options.setTask(task);
    }
    this.options.syncTaskPaneSelection();
    this.options.syncTaskPaneRepositorySelection();
    this.options.markDirty();
  }
}
