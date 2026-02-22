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

export interface TaskPlanningHydrationServiceOptions<
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

export interface TaskPlanningHydrationService {
  hydrate(): Promise<void>;
}

export function createTaskPlanningHydrationService<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
>(
  options: TaskPlanningHydrationServiceOptions<TRepositoryRecord, TTaskRecord>,
): TaskPlanningHydrationService {
  async function hydrate(): Promise<void> {
    options.clearRepositories();
    for (const repository of await options.controlPlaneService.listRepositories()) {
      options.setRepository(repository);
    }
    options.syncTaskPaneRepositorySelection();

    options.clearTasks();
    for (const task of await options.controlPlaneService.listTasks(options.taskLimit)) {
      options.setTask(task);
    }
    options.syncTaskPaneSelection();
    options.syncTaskPaneRepositorySelection();
    options.markDirty();
  }

  return {
    hydrate,
  };
}
