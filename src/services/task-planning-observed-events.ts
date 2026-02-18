import type { StreamObservedEvent } from '../control-plane/stream-protocol.ts';

interface RepositoryRecordLike {
  readonly repositoryId: string;
  readonly archivedAt: string | null;
}

interface TaskRecordLike {
  readonly taskId: string;
}

interface TaskPlanningObservedEventsOptions<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  readonly parseRepositoryRecord: (value: unknown) => TRepositoryRecord | null;
  readonly parseTaskRecord: (value: unknown) => TTaskRecord | null;
  readonly getRepository: (repositoryId: string) => TRepositoryRecord | undefined;
  readonly setRepository: (repositoryId: string, repository: TRepositoryRecord) => void;
  readonly setTask: (task: TTaskRecord) => void;
  readonly deleteTask: (taskId: string) => boolean;
  readonly syncTaskPaneRepositorySelection: () => void;
  readonly syncTaskPaneSelection: () => void;
  readonly markDirty: () => void;
}

export class TaskPlanningObservedEvents<
  TRepositoryRecord extends RepositoryRecordLike,
  TTaskRecord extends TaskRecordLike,
> {
  constructor(
    private readonly options: TaskPlanningObservedEventsOptions<TRepositoryRecord, TTaskRecord>,
  ) {}

  apply(observed: StreamObservedEvent): void {
    if (observed.type === 'repository-upserted' || observed.type === 'repository-updated') {
      const repository = this.options.parseRepositoryRecord(observed.repository);
      if (repository !== null) {
        this.options.setRepository(repository.repositoryId, repository);
        this.options.syncTaskPaneRepositorySelection();
        this.options.markDirty();
      }
      return;
    }
    if (observed.type === 'repository-archived') {
      const repository = this.options.getRepository(observed.repositoryId);
      if (repository !== undefined) {
        this.options.setRepository(observed.repositoryId, {
          ...repository,
          archivedAt: observed.ts,
        });
        this.options.syncTaskPaneRepositorySelection();
        this.options.markDirty();
      }
      return;
    }
    if (observed.type === 'task-created' || observed.type === 'task-updated') {
      const task = this.options.parseTaskRecord(observed.task);
      if (task !== null) {
        this.options.setTask(task);
        this.options.syncTaskPaneSelection();
        this.options.markDirty();
      }
      return;
    }
    if (observed.type === 'task-deleted') {
      if (this.options.deleteTask(observed.taskId)) {
        this.options.syncTaskPaneSelection();
        this.options.markDirty();
      }
      return;
    }
    if (observed.type === 'task-reordered') {
      let changed = false;
      for (const value of observed.tasks) {
        const task = this.options.parseTaskRecord(value);
        if (task === null) {
          continue;
        }
        this.options.setTask(task);
        changed = true;
      }
      if (changed) {
        this.options.syncTaskPaneSelection();
        this.options.markDirty();
      }
    }
  }
}
