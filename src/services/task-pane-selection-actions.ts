import type { WorkspaceModel } from '../domain/workspace.ts';

interface TaskRecordLike {
  readonly taskId: string;
  readonly repositoryId: string | null;
}

interface TaskPaneSelectionActionsOptions<TTaskRecord extends TaskRecordLike> {
  readonly workspace: WorkspaceModel;
  readonly taskRecordById: (taskId: string) => TTaskRecord | undefined;
  readonly hasTask: (taskId: string) => boolean;
  readonly hasRepository: (repositoryId: string) => boolean;
  readonly flushTaskComposerPersist: (taskId: string) => void;
  readonly syncTaskPaneSelection: () => void;
  readonly markDirty: () => void;
}

export class TaskPaneSelectionActions<TTaskRecord extends TaskRecordLike> {
  constructor(private readonly options: TaskPaneSelectionActionsOptions<TTaskRecord>) {}

  focusDraftComposer(): void {
    if (this.options.workspace.taskEditorTarget.kind === 'task') {
      this.options.flushTaskComposerPersist(this.options.workspace.taskEditorTarget.taskId);
    }
    this.options.workspace.taskEditorTarget = {
      kind: 'draft',
    };
    this.options.workspace.taskPaneSelectionFocus = 'task';
    this.options.markDirty();
  }

  focusTaskComposer(taskId: string): void {
    if (!this.options.hasTask(taskId)) {
      return;
    }
    if (
      this.options.workspace.taskEditorTarget.kind === 'task' &&
      this.options.workspace.taskEditorTarget.taskId !== taskId
    ) {
      this.options.flushTaskComposerPersist(this.options.workspace.taskEditorTarget.taskId);
    }
    this.options.workspace.taskEditorTarget = {
      kind: 'task',
      taskId,
    };
    this.options.workspace.taskPaneSelectedTaskId = taskId;
    this.options.workspace.taskPaneSelectionFocus = 'task';
    this.options.workspace.taskPaneNotice = null;
    this.options.markDirty();
  }

  selectTaskById(taskId: string): void {
    const taskRecord = this.options.taskRecordById(taskId);
    if (taskRecord === undefined) {
      return;
    }
    this.options.workspace.taskPaneSelectedTaskId = taskId;
    this.options.workspace.taskPaneSelectionFocus = 'task';
    if (
      taskRecord.repositoryId !== null &&
      this.options.hasRepository(taskRecord.repositoryId)
    ) {
      this.options.workspace.taskPaneSelectedRepositoryId = taskRecord.repositoryId;
    }
    this.focusTaskComposer(taskId);
  }

  selectRepositoryById(repositoryId: string): void {
    if (!this.options.hasRepository(repositoryId)) {
      return;
    }
    if (this.options.workspace.taskEditorTarget.kind === 'task') {
      this.options.flushTaskComposerPersist(this.options.workspace.taskEditorTarget.taskId);
    }
    this.options.workspace.taskPaneSelectedRepositoryId = repositoryId;
    this.options.workspace.taskRepositoryDropdownOpen = false;
    this.options.workspace.taskPaneSelectionFocus = 'repository';
    this.options.workspace.taskEditorTarget = {
      kind: 'draft',
    };
    this.options.syncTaskPaneSelection();
    this.options.workspace.taskPaneNotice = null;
    this.options.markDirty();
  }
}
