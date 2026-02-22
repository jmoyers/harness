interface RepositoryRecordLike {
  readonly repositoryId: string;
  readonly archivedAt: string | null;
}

interface TaskRecordLike {
  readonly taskId: string;
}

interface TaskPlanningSyncedProjectionState<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  readonly repositoriesById: Readonly<Record<string, TRepositoryRecord>>;
  readonly tasksById: Readonly<Record<string, TTaskRecord>>;
}

interface TaskPlanningSyncedProjectionInput<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  readonly changed: boolean;
  readonly state: TaskPlanningSyncedProjectionState<TRepositoryRecord, TTaskRecord>;
  readonly removedTaskIds: readonly string[];
  readonly upsertedRepositoryIds: readonly string[];
  readonly upsertedTaskIds: readonly string[];
}

interface TaskPlanningSyncedProjectionOptions<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  readonly setRepository: (repositoryId: string, repository: TRepositoryRecord) => void;
  readonly setTask: (task: TTaskRecord) => void;
  readonly deleteTask: (taskId: string) => boolean;
  readonly syncTaskPaneRepositorySelection: () => void;
  readonly syncTaskPaneSelection: () => void;
  readonly markDirty: () => void;
}

export class TaskPlanningSyncedProjection<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  constructor(
    private readonly options: TaskPlanningSyncedProjectionOptions<TRepositoryRecord, TTaskRecord>,
  ) {}

  apply(reduction: TaskPlanningSyncedProjectionInput<TRepositoryRecord, TTaskRecord>): void {
    if (!reduction.changed) {
      return;
    }

    let repositoriesChanged = false;
    for (const repositoryId of reduction.upsertedRepositoryIds) {
      const repository = reduction.state.repositoriesById[repositoryId];
      if (repository === undefined) {
        continue;
      }
      this.options.setRepository(repositoryId, repository);
      repositoriesChanged = true;
    }
    if (repositoriesChanged) {
      this.options.syncTaskPaneRepositorySelection();
      this.options.markDirty();
    }

    let tasksChanged = false;
    for (const taskId of reduction.removedTaskIds) {
      if (this.options.deleteTask(taskId)) {
        tasksChanged = true;
      }
    }
    for (const taskId of reduction.upsertedTaskIds) {
      const task = reduction.state.tasksById[taskId];
      if (task === undefined) {
        continue;
      }
      this.options.setTask(task);
      tasksChanged = true;
    }
    if (tasksChanged) {
      this.options.syncTaskPaneSelection();
      this.options.markDirty();
    }
  }
}
