import type { WorkspaceModel } from '../domain/workspace.ts';

interface TaskRecordLike {
  readonly taskId: string;
  readonly repositoryId: string | null;
}

interface RepositoryRecordLike {
  readonly archivedAt: string | null;
}

export interface TaskPaneSelectionActionsOptions<TTaskRecord extends TaskRecordLike> {
  readonly workspace: WorkspaceModel;
  readonly taskRecordById: (taskId: string) => TTaskRecord | undefined;
  readonly hasTask: (taskId: string) => boolean;
  readonly hasRepository: (repositoryId: string) => boolean;
  readonly repositoryById: (repositoryId: string) => RepositoryRecordLike | undefined;
  readonly selectedRepositoryTasks: () => readonly TTaskRecord[];
  readonly activeRepositoryIds: () => readonly string[];
  readonly flushTaskComposerPersist: (taskId: string) => void;
  readonly markDirty: () => void;
}

export interface TaskPaneSelectionActions {
  syncTaskPaneSelectionFocus(): void;
  syncTaskPaneSelection(): void;
  syncTaskPaneRepositorySelection(): void;
  focusDraftComposer(): void;
  focusTaskComposer(taskId: string): void;
  selectTaskById(taskId: string): void;
  selectRepositoryById(repositoryId: string): void;
}

export function createTaskPaneSelectionActions<TTaskRecord extends TaskRecordLike>(
  options: TaskPaneSelectionActionsOptions<TTaskRecord>,
): TaskPaneSelectionActions {
  function syncTaskPaneSelectionFocus(): void {
    const hasTaskSelection =
      options.workspace.taskPaneSelectedTaskId !== null &&
      options.hasTask(options.workspace.taskPaneSelectedTaskId);
    const hasRepositorySelection =
      options.workspace.taskPaneSelectedRepositoryId !== null &&
      options.hasRepository(options.workspace.taskPaneSelectedRepositoryId);
    if (options.workspace.taskPaneSelectionFocus === 'task' && hasTaskSelection) {
      return;
    }
    if (options.workspace.taskPaneSelectionFocus === 'repository' && hasRepositorySelection) {
      return;
    }
    if (hasTaskSelection) {
      options.workspace.taskPaneSelectionFocus = 'task';
      return;
    }
    if (hasRepositorySelection) {
      options.workspace.taskPaneSelectionFocus = 'repository';
      return;
    }
    options.workspace.taskPaneSelectionFocus = 'task';
  }

  function syncTaskPaneSelection(): void {
    const scopedTaskIds = new Set(options.selectedRepositoryTasks().map((task) => task.taskId));
    if (
      options.workspace.taskPaneSelectedTaskId !== null &&
      !scopedTaskIds.has(options.workspace.taskPaneSelectedTaskId)
    ) {
      options.workspace.taskPaneSelectedTaskId = null;
    }
    if (options.workspace.taskPaneSelectedTaskId === null) {
      const scopedTasks = options.selectedRepositoryTasks();
      options.workspace.taskPaneSelectedTaskId = scopedTasks[0]?.taskId ?? null;
    }
    syncTaskPaneSelectionFocus();
    if (
      options.workspace.taskEditorTarget.kind === 'task' &&
      !scopedTaskIds.has(options.workspace.taskEditorTarget.taskId)
    ) {
      focusDraftComposer();
    }
  }

  function syncTaskPaneRepositorySelection(): void {
    if (options.workspace.taskPaneSelectedRepositoryId !== null) {
      const selectedRepository = options.repositoryById(
        options.workspace.taskPaneSelectedRepositoryId,
      );
      if (selectedRepository === undefined || selectedRepository.archivedAt !== null) {
        options.workspace.taskPaneSelectedRepositoryId = null;
      }
    }
    if (options.workspace.taskPaneSelectedRepositoryId === null) {
      options.workspace.taskPaneSelectedRepositoryId = options.activeRepositoryIds()[0] ?? null;
    }
    options.workspace.taskRepositoryDropdownOpen = false;
    syncTaskPaneSelectionFocus();
    syncTaskPaneSelection();
  }

  function focusDraftComposer(): void {
    if (options.workspace.taskEditorTarget.kind === 'task') {
      options.flushTaskComposerPersist(options.workspace.taskEditorTarget.taskId);
    }
    options.workspace.taskEditorTarget = {
      kind: 'draft',
    };
    options.workspace.taskPaneSelectionFocus = 'task';
    options.markDirty();
  }

  function focusTaskComposer(taskId: string): void {
    if (!options.hasTask(taskId)) {
      return;
    }
    if (
      options.workspace.taskEditorTarget.kind === 'task' &&
      options.workspace.taskEditorTarget.taskId !== taskId
    ) {
      options.flushTaskComposerPersist(options.workspace.taskEditorTarget.taskId);
    }
    options.workspace.taskEditorTarget = {
      kind: 'task',
      taskId,
    };
    options.workspace.taskPaneSelectedTaskId = taskId;
    options.workspace.taskPaneSelectionFocus = 'task';
    options.workspace.taskPaneNotice = null;
    options.markDirty();
  }

  function selectTaskById(taskId: string): void {
    const taskRecord = options.taskRecordById(taskId);
    if (taskRecord === undefined) {
      return;
    }
    options.workspace.taskPaneSelectedTaskId = taskId;
    options.workspace.taskPaneSelectionFocus = 'task';
    if (taskRecord.repositoryId !== null && options.hasRepository(taskRecord.repositoryId)) {
      options.workspace.taskPaneSelectedRepositoryId = taskRecord.repositoryId;
    }
    focusTaskComposer(taskId);
  }

  function selectRepositoryById(repositoryId: string): void {
    if (!options.hasRepository(repositoryId)) {
      return;
    }
    if (options.workspace.taskEditorTarget.kind === 'task') {
      options.flushTaskComposerPersist(options.workspace.taskEditorTarget.taskId);
    }
    options.workspace.taskPaneSelectedRepositoryId = repositoryId;
    options.workspace.taskRepositoryDropdownOpen = false;
    options.workspace.taskPaneSelectionFocus = 'repository';
    options.workspace.taskEditorTarget = {
      kind: 'draft',
    };
    syncTaskPaneSelection();
    options.workspace.taskPaneNotice = null;
    options.markDirty();
  }

  return {
    syncTaskPaneSelectionFocus,
    syncTaskPaneSelection,
    syncTaskPaneRepositorySelection,
    focusDraftComposer,
    focusTaskComposer,
    selectTaskById,
    selectRepositoryById,
  };
}
