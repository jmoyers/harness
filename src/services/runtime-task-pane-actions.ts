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

interface RuntimeTaskPaneActionsOptions<TTaskRecord extends TaskRecordShape> {
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

export class RuntimeTaskPaneActions<TTaskRecord extends TaskRecordShape> {
  constructor(private readonly options: RuntimeTaskPaneActionsOptions<TTaskRecord>) {}

  openTaskCreatePrompt(): void {
    const repositoryId = this.options.workspace.taskPaneSelectedRepositoryId;
    if (repositoryId === null || !this.options.repositoriesHas(repositoryId)) {
      this.options.workspace.taskPaneNotice = 'select a repository first';
      this.options.markDirty();
      return;
    }
    this.options.focusDraftComposer();
    this.options.workspace.taskPaneNotice = null;
    this.options.markDirty();
  }

  openTaskEditPrompt(taskId: string): void {
    const task = this.options.getTask(taskId);
    if (task === undefined) {
      return;
    }
    if (task.repositoryId !== null) {
      this.options.workspace.taskPaneSelectedRepositoryId = task.repositoryId;
    }
    this.options.focusTaskComposer(task.taskId);
    this.options.workspace.taskPaneNotice = null;
    this.options.markDirty();
  }

  applyTaskRecord(task: TTaskRecord): TTaskRecord {
    this.options.setTask(task);
    this.options.workspace.taskPaneSelectedTaskId = task.taskId;
    if (task.repositoryId !== null && this.options.repositoriesHas(task.repositoryId)) {
      this.options.workspace.taskPaneSelectedRepositoryId = task.repositoryId;
    }
    this.options.workspace.taskPaneSelectionFocus = 'task';
    this.options.syncTaskPaneSelection();
    this.options.markDirty();
    return task;
  }

  applyTaskList(tasks: readonly TTaskRecord[]): boolean {
    let changed = false;
    for (const task of tasks) {
      this.options.setTask(task);
      changed = true;
    }
    if (changed) {
      this.options.syncTaskPaneSelection();
      this.options.markDirty();
    }
    return changed;
  }

  queueTaskReorderByIds(orderedActiveTaskIds: readonly string[], label: string): void {
    this.options.queueControlPlaneOp(async () => {
      const tasks = await this.options.controlPlaneService.reorderTasks(
        this.options.taskReorderPayloadIds(orderedActiveTaskIds),
      );
      this.applyTaskList(tasks);
    }, label);
  }

  reorderTaskByDrop(draggedTaskId: string, targetTaskId: string): void {
    const reordered = this.options.reorderedActiveTaskIdsForDrop(draggedTaskId, targetTaskId);
    if (reordered === 'cannot-reorder-completed') {
      this.options.workspace.taskPaneNotice = 'cannot reorder completed tasks';
      this.options.markDirty();
      return;
    }
    if (reordered === null) {
      return;
    }
    this.queueTaskReorderByIds(reordered, 'tasks-reorder-drag');
  }

  private openRepositoryPromptForEditFromSelection(): void {
    const selectedRepositoryId = this.options.workspace.taskPaneSelectedRepositoryId;
    if (selectedRepositoryId === null || !this.options.repositoriesHas(selectedRepositoryId)) {
      this.options.workspace.taskPaneNotice = 'select a repository first';
      this.options.markDirty();
      return;
    }
    this.options.workspace.taskPaneSelectionFocus = 'repository';
    this.options.workspace.taskPaneNotice = null;
    this.options.openRepositoryPromptForEdit(selectedRepositoryId);
  }

  private queueArchiveRepositoryFromSelection(): void {
    const selectedRepositoryId = this.options.workspace.taskPaneSelectedRepositoryId;
    if (selectedRepositoryId === null || !this.options.repositoriesHas(selectedRepositoryId)) {
      this.options.workspace.taskPaneNotice = 'select a repository first';
      this.options.markDirty();
      return;
    }
    this.options.workspace.taskPaneSelectionFocus = 'repository';
    this.options.queueControlPlaneOp(async () => {
      await this.options.archiveRepositoryById(selectedRepositoryId);
      this.options.syncTaskPaneRepositorySelection();
    }, 'tasks-archive-repository');
  }

  private requireSelectedTaskOrNotice(): TTaskRecord | null {
    const selectedTask = this.options.selectedTask();
    if (selectedTask !== null) {
      return selectedTask;
    }
    this.options.workspace.taskPaneNotice = 'select a task first';
    this.options.markDirty();
    return null;
  }

  private queueDeleteTask(taskId: string): void {
    this.options.queueControlPlaneOp(async () => {
      this.options.clearTaskAutosaveTimer(taskId);
      await this.options.controlPlaneService.deleteTask(taskId);
      this.options.deleteTask(taskId);
      this.options.deleteTaskComposer(taskId);
      if (
        this.options.workspace.taskEditorTarget.kind === 'task' &&
        this.options.workspace.taskEditorTarget.taskId === taskId
      ) {
        this.options.workspace.taskEditorTarget = {
          kind: 'draft',
        };
      }
      this.options.syncTaskPaneSelection();
      this.options.markDirty();
    }, 'tasks-delete');
  }

  private queueTaskStatusUpdate(taskId: string, status: 'ready' | 'draft' | 'complete'): void {
    const labelByStatus: Readonly<Record<typeof status, string>> = {
      ready: 'tasks-ready',
      draft: 'tasks-draft',
      complete: 'tasks-complete',
    };
    this.options.queueControlPlaneOp(async () => {
      const task =
        status === 'ready'
          ? await this.options.controlPlaneService.taskReady(taskId)
          : status === 'draft'
            ? await this.options.controlPlaneService.taskDraft(taskId)
            : await this.options.controlPlaneService.taskComplete(taskId);
      this.applyTaskRecord(task);
    }, labelByStatus[status]);
  }

  private reorderSelectedTask(selectedTaskId: string, direction: 'up' | 'down'): void {
    const activeTasks = this.options
      .orderedTaskRecords()
      .filter((task) => task.status !== 'completed');
    const selectedIndex = activeTasks.findIndex((task) => task.taskId === selectedTaskId);
    if (selectedIndex < 0) {
      this.options.workspace.taskPaneNotice = 'cannot reorder completed tasks';
      this.options.markDirty();
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
    this.options.workspace.taskPaneSelectionFocus = 'task';
    this.queueTaskReorderByIds(
      reordered.map((task) => task.taskId),
      direction === 'up' ? 'tasks-reorder-up' : 'tasks-reorder-down',
    );
  }

  runTaskPaneAction(action: TaskPaneAction): void {
    if (action === 'task.create') {
      this.openTaskCreatePrompt();
      return;
    }
    if (action === 'repository.create') {
      this.options.workspace.taskPaneNotice = null;
      this.options.openRepositoryPromptForCreate();
      return;
    }
    if (action === 'repository.edit') {
      this.openRepositoryPromptForEditFromSelection();
      return;
    }
    if (action === 'repository.archive') {
      this.queueArchiveRepositoryFromSelection();
      return;
    }
    const selectedTask = this.requireSelectedTaskOrNotice();
    if (selectedTask === null) {
      return;
    }
    if (action === 'task.edit') {
      this.options.workspace.taskPaneSelectionFocus = 'task';
      this.openTaskEditPrompt(selectedTask.taskId);
      return;
    }
    if (action === 'task.delete') {
      this.options.workspace.taskPaneSelectionFocus = 'task';
      this.queueDeleteTask(selectedTask.taskId);
      return;
    }
    if (action === 'task.ready') {
      this.options.workspace.taskPaneSelectionFocus = 'task';
      this.queueTaskStatusUpdate(selectedTask.taskId, 'ready');
      return;
    }
    if (action === 'task.draft') {
      this.options.workspace.taskPaneSelectionFocus = 'task';
      this.queueTaskStatusUpdate(selectedTask.taskId, 'draft');
      return;
    }
    if (action === 'task.complete') {
      this.options.workspace.taskPaneSelectionFocus = 'task';
      this.queueTaskStatusUpdate(selectedTask.taskId, 'complete');
      return;
    }
    this.reorderSelectedTask(selectedTask.taskId, action === 'task.reorder-up' ? 'up' : 'down');
  }
}
