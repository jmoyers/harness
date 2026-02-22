import type { WorkspaceModel } from '../domain/workspace.ts';
import type { TaskPaneAction } from '../mux/harness-core-ui.ts';

interface TaskRecordShape {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly status: string;
}

interface RuntimeTaskPaneActionService<TTaskRecord extends TaskRecordShape> {
  reorderTasks(orderedTaskIds: readonly string[]): Promise<readonly TTaskRecord[]>;
  deleteTask(taskId: string): Promise<unknown>;
  taskReady(taskId: string): Promise<TTaskRecord>;
  taskDraft(taskId: string): Promise<TTaskRecord>;
  taskComplete(taskId: string): Promise<TTaskRecord>;
}

export interface RuntimeTaskPaneActionsOptions<TTaskRecord extends TaskRecordShape> {
  readonly workspace: WorkspaceModel;
  readonly controlPlaneService: RuntimeTaskPaneActionService<TTaskRecord>;
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly setTask: (task: TTaskRecord) => void;
  readonly getTask: (taskId: string) => TTaskRecord | undefined;
  readonly taskReorderPayloadIds: (orderedActiveTaskIds: readonly string[]) => readonly string[];
  readonly reorderedActiveTaskIdsForDrop: (
    draggedTaskId: string,
    targetTaskId: string,
  ) => readonly string[] | 'cannot-reorder-completed' | null;
  readonly clearTaskAutosaveTimer: (taskId: string) => void;
  readonly deleteTask: (taskId: string) => void;
  readonly deleteTaskComposer: (taskId: string) => void;
  readonly focusDraftComposer: () => void;
  readonly focusTaskComposer: (taskId: string) => void;
  readonly selectedTask: () => TTaskRecord | null;
  readonly orderedTaskRecords: () => readonly TTaskRecord[];
  readonly queueControlPlaneOp: (task: () => Promise<void>, label?: string) => void;
  readonly syncTaskPaneSelection: () => void;
  readonly syncTaskPaneRepositorySelection: () => void;
  readonly openRepositoryPromptForCreate: () => void;
  readonly openRepositoryPromptForEdit: (repositoryId: string) => void;
  readonly archiveRepositoryById: (repositoryId: string) => Promise<void>;
  readonly markDirty: () => void;
}

export interface RuntimeTaskPaneActions<TTaskRecord extends TaskRecordShape> {
  openTaskCreatePrompt(): void;
  openTaskEditPrompt(taskId: string): void;
  applyTaskRecord(task: TTaskRecord): TTaskRecord;
  applyTaskList(tasks: readonly TTaskRecord[]): boolean;
  queueTaskReorderByIds(orderedActiveTaskIds: readonly string[], label: string): void;
  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void;
  runTaskPaneAction(action: TaskPaneAction): void;
}

export function createRuntimeTaskPaneActions<TTaskRecord extends TaskRecordShape>(
  options: RuntimeTaskPaneActionsOptions<TTaskRecord>,
): RuntimeTaskPaneActions<TTaskRecord> {
  const applyTaskList = (tasks: readonly TTaskRecord[]): boolean => {
    let changed = false;
    for (const task of tasks) {
      options.setTask(task);
      changed = true;
    }
    if (changed) {
      options.syncTaskPaneSelection();
      options.markDirty();
    }
    return changed;
  };

  const applyTaskRecord = (task: TTaskRecord): TTaskRecord => {
    options.setTask(task);
    options.workspace.taskPaneSelectedTaskId = task.taskId;
    if (task.repositoryId !== null && options.repositoriesHas(task.repositoryId)) {
      options.workspace.taskPaneSelectedRepositoryId = task.repositoryId;
    }
    options.workspace.taskPaneSelectionFocus = 'task';
    options.syncTaskPaneSelection();
    options.markDirty();
    return task;
  };

  const queueTaskReorderByIds = (orderedActiveTaskIds: readonly string[], label: string): void => {
    options.queueControlPlaneOp(async () => {
      const tasks = await options.controlPlaneService.reorderTasks(
        options.taskReorderPayloadIds(orderedActiveTaskIds),
      );
      applyTaskList(tasks);
    }, label);
  };

  const openTaskCreatePrompt = (): void => {
    const repositoryId = options.workspace.taskPaneSelectedRepositoryId;
    if (repositoryId === null || !options.repositoriesHas(repositoryId)) {
      options.workspace.taskPaneNotice = 'select a repository first';
      options.markDirty();
      return;
    }
    options.focusDraftComposer();
    options.workspace.taskPaneNotice = null;
    options.markDirty();
  };

  const openTaskEditPrompt = (taskId: string): void => {
    const task = options.getTask(taskId);
    if (task === undefined) {
      return;
    }
    if (task.repositoryId !== null) {
      options.workspace.taskPaneSelectedRepositoryId = task.repositoryId;
    }
    options.focusTaskComposer(task.taskId);
    options.workspace.taskPaneNotice = null;
    options.markDirty();
  };

  const openRepositoryPromptForEditFromSelection = (): void => {
    const selectedRepositoryId = options.workspace.taskPaneSelectedRepositoryId;
    if (selectedRepositoryId === null || !options.repositoriesHas(selectedRepositoryId)) {
      options.workspace.taskPaneNotice = 'select a repository first';
      options.markDirty();
      return;
    }
    options.workspace.taskPaneSelectionFocus = 'repository';
    options.workspace.taskPaneNotice = null;
    options.openRepositoryPromptForEdit(selectedRepositoryId);
  };

  const queueArchiveRepositoryFromSelection = (): void => {
    const selectedRepositoryId = options.workspace.taskPaneSelectedRepositoryId;
    if (selectedRepositoryId === null || !options.repositoriesHas(selectedRepositoryId)) {
      options.workspace.taskPaneNotice = 'select a repository first';
      options.markDirty();
      return;
    }
    options.workspace.taskPaneSelectionFocus = 'repository';
    options.queueControlPlaneOp(async () => {
      await options.archiveRepositoryById(selectedRepositoryId);
      options.syncTaskPaneRepositorySelection();
    }, 'tasks-archive-repository');
  };

  const requireSelectedTaskOrNotice = (): TTaskRecord | null => {
    const selectedTask = options.selectedTask();
    if (selectedTask !== null) {
      return selectedTask;
    }
    options.workspace.taskPaneNotice = 'select a task first';
    options.markDirty();
    return null;
  };

  const queueDeleteTask = (taskId: string): void => {
    options.queueControlPlaneOp(async () => {
      options.clearTaskAutosaveTimer(taskId);
      await options.controlPlaneService.deleteTask(taskId);
      options.deleteTask(taskId);
      options.deleteTaskComposer(taskId);
      if (
        options.workspace.taskEditorTarget.kind === 'task' &&
        options.workspace.taskEditorTarget.taskId === taskId
      ) {
        options.workspace.taskEditorTarget = {
          kind: 'draft',
        };
      }
      options.syncTaskPaneSelection();
      options.markDirty();
    }, 'tasks-delete');
  };

  const queueTaskStatusUpdate = (taskId: string, status: 'ready' | 'draft' | 'complete'): void => {
    const labelByStatus: Readonly<Record<typeof status, string>> = {
      ready: 'tasks-ready',
      draft: 'tasks-draft',
      complete: 'tasks-complete',
    };
    options.queueControlPlaneOp(async () => {
      const task =
        status === 'ready'
          ? await options.controlPlaneService.taskReady(taskId)
          : status === 'draft'
            ? await options.controlPlaneService.taskDraft(taskId)
            : await options.controlPlaneService.taskComplete(taskId);
      applyTaskRecord(task);
    }, labelByStatus[status]);
  };

  const reorderSelectedTask = (selectedTaskId: string, direction: 'up' | 'down'): void => {
    const activeTasks = options
      .orderedTaskRecords()
      .filter((task) => task.status !== 'completed');
    const selectedIndex = activeTasks.findIndex((task) => task.taskId === selectedTaskId);
    if (selectedIndex < 0) {
      options.workspace.taskPaneNotice = 'cannot reorder completed tasks';
      options.markDirty();
      return;
    }
    const swapIndex = direction === 'up' ? selectedIndex - 1 : selectedIndex + 1;
    if (swapIndex < 0 || swapIndex >= activeTasks.length) {
      return;
    }
    const reordered = [...activeTasks];
    const currentTask = reordered[selectedIndex]!;
    reordered[selectedIndex] = reordered[swapIndex]!;
    reordered[swapIndex] = currentTask;
    options.workspace.taskPaneSelectionFocus = 'task';
    queueTaskReorderByIds(
      reordered.map((task) => task.taskId),
      direction === 'up' ? 'tasks-reorder-up' : 'tasks-reorder-down',
    );
  };

  const reorderTaskByDrop = (draggedTaskId: string, targetTaskId: string): void => {
    const reordered = options.reorderedActiveTaskIdsForDrop(draggedTaskId, targetTaskId);
    if (reordered === 'cannot-reorder-completed') {
      options.workspace.taskPaneNotice = 'cannot reorder completed tasks';
      options.markDirty();
      return;
    }
    if (reordered === null) {
      return;
    }
    queueTaskReorderByIds(reordered, 'tasks-reorder-drag');
  };

  const runTaskPaneAction = (action: TaskPaneAction): void => {
    if (action === 'task.create') {
      openTaskCreatePrompt();
      return;
    }
    if (action === 'repository.create') {
      options.workspace.taskPaneNotice = null;
      options.openRepositoryPromptForCreate();
      return;
    }
    if (action === 'repository.edit') {
      openRepositoryPromptForEditFromSelection();
      return;
    }
    if (action === 'repository.archive') {
      queueArchiveRepositoryFromSelection();
      return;
    }
    const selectedTask = requireSelectedTaskOrNotice();
    if (selectedTask === null) {
      return;
    }
    if (action === 'task.edit') {
      options.workspace.taskPaneSelectionFocus = 'task';
      openTaskEditPrompt(selectedTask.taskId);
      return;
    }
    if (action === 'task.delete') {
      options.workspace.taskPaneSelectionFocus = 'task';
      queueDeleteTask(selectedTask.taskId);
      return;
    }
    if (action === 'task.ready') {
      options.workspace.taskPaneSelectionFocus = 'task';
      queueTaskStatusUpdate(selectedTask.taskId, 'ready');
      return;
    }
    if (action === 'task.draft') {
      options.workspace.taskPaneSelectionFocus = 'task';
      queueTaskStatusUpdate(selectedTask.taskId, 'draft');
      return;
    }
    if (action === 'task.complete') {
      options.workspace.taskPaneSelectionFocus = 'task';
      queueTaskStatusUpdate(selectedTask.taskId, 'complete');
      return;
    }
    reorderSelectedTask(selectedTask.taskId, action === 'task.reorder-up' ? 'up' : 'down');
  };

  return {
    openTaskCreatePrompt,
    openTaskEditPrompt,
    applyTaskRecord,
    applyTaskList,
    queueTaskReorderByIds,
    reorderTaskByDrop,
    runTaskPaneAction,
  };
}
