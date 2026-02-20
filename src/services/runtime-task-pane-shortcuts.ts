import type { WorkspaceModel } from '../domain/workspace.ts';
import {
  createTaskComposerBuffer as createTaskComposerBufferFrame,
  normalizeTaskComposerBuffer as normalizeTaskComposerBufferFrame,
  taskFieldsFromComposerText as taskFieldsFromComposerTextFrame,
  type TaskComposerBuffer,
} from '../mux/task-composer.ts';
import { handleTaskPaneShortcutInput as handleTaskPaneShortcutInputFrame } from '../mux/live-mux/task-pane-shortcuts.ts';
import type { ResolvedTaskScreenKeybindings } from '../mux/task-screen-keybindings.ts';

type TaskPaneShortcutAction = Parameters<
  Parameters<typeof handleTaskPaneShortcutInputFrame>[0]['runTaskPaneAction']
>[0];

interface TaskRecordShape {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
}

interface RuntimeTaskPaneShortcutsOptions<TTaskRecord extends TaskRecordShape> {
  readonly workspace: WorkspaceModel;
  readonly taskScreenKeybindings: ResolvedTaskScreenKeybindings;
  readonly repositoriesHas: (repositoryId: string) => boolean;
  readonly activeRepositoryIds: () => readonly string[];
  readonly selectRepositoryById: (repositoryId: string) => void;
  readonly taskComposerForTask: (taskId: string) => TaskComposerBuffer | null;
  readonly setTaskComposerForTask: (taskId: string, buffer: TaskComposerBuffer) => void;
  readonly scheduleTaskComposerPersist: (taskId: string) => void;
  readonly selectedRepositoryTaskRecords: () => readonly TTaskRecord[];
  readonly focusTaskComposer: (taskId: string) => void;
  readonly focusDraftComposer: () => void;
  readonly runTaskPaneAction: (action: TaskPaneShortcutAction) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label?: string) => void;
  readonly createTask: (payload: {
    repositoryId: string;
    title: string;
    body: string;
  }) => Promise<TTaskRecord>;
  readonly taskReady: (taskId: string) => Promise<TTaskRecord>;
  readonly applyTaskRecord: (task: TTaskRecord) => void;
  readonly syncTaskPaneSelection: () => void;
  readonly markDirty: () => void;
  readonly createTaskComposerBuffer?: typeof createTaskComposerBufferFrame;
  readonly normalizeTaskComposerBuffer?: typeof normalizeTaskComposerBufferFrame;
  readonly taskFieldsFromComposerText?: typeof taskFieldsFromComposerTextFrame;
  readonly handleTaskPaneShortcutInput?: typeof handleTaskPaneShortcutInputFrame;
}

export class RuntimeTaskPaneShortcuts<TTaskRecord extends TaskRecordShape> {
  private readonly createTaskComposerBuffer: typeof createTaskComposerBufferFrame;
  private readonly normalizeTaskComposerBuffer: typeof normalizeTaskComposerBufferFrame;
  private readonly taskFieldsFromComposerText: typeof taskFieldsFromComposerTextFrame;
  private readonly handleTaskPaneShortcutInput: typeof handleTaskPaneShortcutInputFrame;

  constructor(private readonly options: RuntimeTaskPaneShortcutsOptions<TTaskRecord>) {
    this.createTaskComposerBuffer =
      options.createTaskComposerBuffer ?? createTaskComposerBufferFrame;
    this.normalizeTaskComposerBuffer =
      options.normalizeTaskComposerBuffer ?? normalizeTaskComposerBufferFrame;
    this.taskFieldsFromComposerText =
      options.taskFieldsFromComposerText ?? taskFieldsFromComposerTextFrame;
    this.handleTaskPaneShortcutInput =
      options.handleTaskPaneShortcutInput ?? handleTaskPaneShortcutInputFrame;
  }

  homeEditorBuffer(): TaskComposerBuffer {
    const taskEditorTarget = this.options.workspace.taskEditorTarget;
    if (taskEditorTarget.kind === 'task') {
      return (
        this.options.taskComposerForTask(taskEditorTarget.taskId) ??
        this.createTaskComposerBuffer('')
      );
    }
    return this.options.workspace.taskDraftComposer;
  }

  updateHomeEditorBuffer(next: TaskComposerBuffer): void {
    const taskEditorTarget = this.options.workspace.taskEditorTarget;
    if (taskEditorTarget.kind === 'task') {
      this.options.setTaskComposerForTask(taskEditorTarget.taskId, next);
      this.options.scheduleTaskComposerPersist(taskEditorTarget.taskId);
    } else {
      this.options.workspace.taskDraftComposer = this.normalizeTaskComposerBuffer(next);
    }
    this.options.markDirty();
  }

  selectRepositoryByDirection(direction: 1 | -1): void {
    const orderedIds = this.options.activeRepositoryIds();
    if (orderedIds.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      orderedIds.indexOf(this.options.workspace.taskPaneSelectedRepositoryId ?? ''),
    );
    const nextIndex = Math.max(0, Math.min(orderedIds.length - 1, currentIndex + direction));
    const nextRepositoryId = orderedIds[nextIndex];
    if (nextRepositoryId !== undefined) {
      this.options.selectRepositoryById(nextRepositoryId);
    }
  }

  private taskNavigationIds(): readonly string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const taskId of this.options.workspace.latestTaskPaneView.taskIds) {
      if (taskId === null || seen.has(taskId)) {
        continue;
      }
      ids.push(taskId);
      seen.add(taskId);
    }
    if (ids.length > 0) {
      return ids;
    }
    for (const task of this.options.selectedRepositoryTaskRecords()) {
      if (seen.has(task.taskId)) {
        continue;
      }
      ids.push(task.taskId);
      seen.add(task.taskId);
    }
    return ids;
  }

  submitDraftTaskFromComposer(mode: 'ready' | 'queue'): void {
    const repositoryId = this.options.workspace.taskPaneSelectedRepositoryId;
    if (repositoryId === null || !this.options.repositoriesHas(repositoryId)) {
      this.options.workspace.taskPaneNotice = 'select a repository first';
      this.options.markDirty();
      return;
    }
    const fields = this.taskFieldsFromComposerText(this.options.workspace.taskDraftComposer.text);
    if (fields.body.trim().length === 0) {
      this.options.workspace.taskPaneNotice = 'task body is required';
      this.options.markDirty();
      return;
    }
    this.options.queueControlPlaneOp(
      async () => {
        const created = await this.options.createTask({
          repositoryId,
          title: fields.title ?? '',
          body: fields.body,
        });
        const task = mode === 'ready' ? await this.options.taskReady(created.taskId) : created;
        this.options.applyTaskRecord(task);
        this.options.workspace.taskDraftComposer = this.createTaskComposerBuffer('');
        this.options.workspace.taskPaneNotice = null;
        this.options.syncTaskPaneSelection();
        this.options.markDirty();
      },
      mode === 'ready' ? 'task-composer-submit-ready' : 'task-composer-queue',
    );
  }

  moveTaskEditorFocusUp(): void {
    const workspace = this.options.workspace;
    const navigationTaskIds = this.taskNavigationIds();
    if (workspace.taskEditorTarget.kind === 'draft') {
      const fallbackTaskId = navigationTaskIds[navigationTaskIds.length - 1];
      if (fallbackTaskId !== undefined) {
        this.options.focusTaskComposer(fallbackTaskId);
      }
      return;
    }

    const focusedTaskId = workspace.taskEditorTarget.taskId;
    const index = navigationTaskIds.indexOf(focusedTaskId);
    if (index <= 0) {
      return;
    }
    const targetTaskId = navigationTaskIds[index - 1];
    if (targetTaskId !== undefined) {
      this.options.focusTaskComposer(targetTaskId);
    }
  }

  moveTaskEditorFocusDown(): void {
    const workspace = this.options.workspace;
    if (workspace.taskEditorTarget.kind !== 'task') {
      return;
    }
    const navigationTaskIds = this.taskNavigationIds();
    const focusedTaskId = workspace.taskEditorTarget.taskId;
    const index = navigationTaskIds.indexOf(focusedTaskId);
    if (index < 0) {
      this.options.focusDraftComposer();
      return;
    }
    const targetTaskId = navigationTaskIds[index + 1];
    if (targetTaskId !== undefined) {
      this.options.focusTaskComposer(targetTaskId);
      return;
    }
    this.options.focusDraftComposer();
  }

  handleInput(input: Buffer): boolean {
    const workspace = this.options.workspace;
    return this.handleTaskPaneShortcutInput({
      input,
      mainPaneMode: workspace.mainPaneMode,
      taskPaneVisible: workspace.leftNavSelection.kind === 'tasks',
      taskScreenKeybindings: this.options.taskScreenKeybindings,
      taskEditorTarget: workspace.taskEditorTarget,
      homeEditorBuffer: () => this.homeEditorBuffer(),
      updateHomeEditorBuffer: (next) => {
        this.updateHomeEditorBuffer(next);
      },
      moveTaskEditorFocusUp: () => {
        this.moveTaskEditorFocusUp();
      },
      moveTaskEditorFocusDown: () => {
        this.moveTaskEditorFocusDown();
      },
      focusDraftComposer: () => {
        this.options.focusDraftComposer();
      },
      submitDraftTaskFromComposer: (mode) => {
        this.submitDraftTaskFromComposer(mode);
      },
      runTaskPaneAction: (action) => {
        this.options.runTaskPaneAction(action);
      },
      selectRepositoryByDirection: (direction) => {
        this.selectRepositoryByDirection(direction);
      },
      getTaskRepositoryDropdownOpen: () => workspace.taskRepositoryDropdownOpen,
      setTaskRepositoryDropdownOpen: (open) => {
        workspace.taskRepositoryDropdownOpen = open;
      },
      markDirty: () => {
        this.options.markDirty();
      },
    });
  }
}
