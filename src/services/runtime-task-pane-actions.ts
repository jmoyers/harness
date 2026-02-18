import type { WorkspaceModel } from '../domain/workspace.ts';
import type { TaskPaneAction } from '../mux/harness-core-ui.ts';
import { runTaskPaneAction as runTaskPaneActionFrame } from '../mux/live-mux/actions-task.ts';

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
  readonly runTaskPaneAction?: typeof runTaskPaneActionFrame;
}

export class RuntimeTaskPaneActions<TTaskRecord extends TaskRecordShape> {
  private readonly runTaskPaneActionFn: typeof runTaskPaneActionFrame;

  constructor(private readonly options: RuntimeTaskPaneActionsOptions<TTaskRecord>) {
    this.runTaskPaneActionFn = options.runTaskPaneAction ?? runTaskPaneActionFrame;
  }

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

  runTaskPaneAction(action: TaskPaneAction): void {
    this.runTaskPaneActionFn({
      action,
      openTaskCreatePrompt: () => {
        this.openTaskCreatePrompt();
      },
      openRepositoryPromptForCreate: () => {
        this.options.openRepositoryPromptForCreate();
      },
      selectedRepositoryId: this.options.workspace.taskPaneSelectedRepositoryId,
      repositoryExists: (repositoryId) => this.options.repositoriesHas(repositoryId),
      setTaskPaneNotice: (notice) => {
        this.options.workspace.taskPaneNotice = notice;
      },
      markDirty: () => {
        this.options.markDirty();
      },
      setTaskPaneSelectionFocus: (focus) => {
        this.options.workspace.taskPaneSelectionFocus = focus;
      },
      openRepositoryPromptForEdit: (repositoryId) => {
        this.options.openRepositoryPromptForEdit(repositoryId);
      },
      queueArchiveRepository: (repositoryId) => {
        this.options.queueControlPlaneOp(async () => {
          await this.options.archiveRepositoryById(repositoryId);
          this.options.syncTaskPaneRepositorySelection();
        }, 'tasks-archive-repository');
      },
      selectedTask: this.options.selectedTask(),
      openTaskEditPrompt: (taskId) => {
        this.openTaskEditPrompt(taskId);
      },
      queueDeleteTask: (taskId) => {
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
      },
      queueTaskReady: (taskId) => {
        this.options.queueControlPlaneOp(async () => {
          this.applyTaskRecord(await this.options.controlPlaneService.taskReady(taskId));
        }, 'tasks-ready');
      },
      queueTaskDraft: (taskId) => {
        this.options.queueControlPlaneOp(async () => {
          this.applyTaskRecord(await this.options.controlPlaneService.taskDraft(taskId));
        }, 'tasks-draft');
      },
      queueTaskComplete: (taskId) => {
        this.options.queueControlPlaneOp(async () => {
          this.applyTaskRecord(await this.options.controlPlaneService.taskComplete(taskId));
        }, 'tasks-complete');
      },
      orderedTaskRecords: () => this.options.orderedTaskRecords(),
      queueTaskReorderByIds: (orderedTaskIds, label) => {
        this.queueTaskReorderByIds(orderedTaskIds, label);
      },
    });
  }
}
