import type { WorkspaceModel } from '../domain/workspace.ts';
import {
  createTaskComposerBuffer,
  insertTaskComposerText,
  normalizeTaskComposerBuffer,
  taskComposerBackspace,
  taskComposerDeleteForward,
  taskComposerDeleteToLineEnd,
  taskComposerDeleteToLineStart,
  taskComposerDeleteWordLeft,
  taskComposerMoveLeft,
  taskComposerMoveLineEnd,
  taskComposerMoveLineStart,
  taskComposerMoveRight,
  taskComposerMoveVertical,
  taskComposerMoveWordLeft,
  taskComposerMoveWordRight,
  taskFieldsFromComposerText,
  type TaskComposerBuffer,
} from '../mux/task-composer.ts';
import {
  detectTaskScreenKeybindingAction,
  type ResolvedTaskScreenKeybindings,
} from '../mux/task-screen-keybindings.ts';
type TaskPaneShortcutAction =
  | 'task.ready'
  | 'task.draft'
  | 'task.complete'
  | 'task.reorder-up'
  | 'task.reorder-down';
type TaskComposerSubmitMode = 'ready' | 'queue';

const BRACKETED_PASTE_START = Buffer.from('\u001b[200~', 'utf8');
const BRACKETED_PASTE_END = Buffer.from('\u001b[201~', 'utf8');

interface TaskRecordShape {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
}

export interface RuntimeTaskPaneShortcutsOptions<TTaskRecord extends TaskRecordShape> {
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
}

export class RuntimeTaskPaneShortcuts<TTaskRecord extends TaskRecordShape> {
  constructor(private readonly options: RuntimeTaskPaneShortcutsOptions<TTaskRecord>) {}

  homeEditorBuffer(): TaskComposerBuffer {
    const taskEditorTarget = this.options.workspace.taskEditorTarget;
    if (taskEditorTarget.kind === 'task') {
      return (
        this.options.taskComposerForTask(taskEditorTarget.taskId) ?? createTaskComposerBuffer('')
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
      this.options.workspace.taskDraftComposer = normalizeTaskComposerBuffer(next);
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

  submitDraftTaskFromComposer(mode: TaskComposerSubmitMode): void {
    const repositoryId = this.options.workspace.taskPaneSelectedRepositoryId;
    if (repositoryId === null || !this.options.repositoriesHas(repositoryId)) {
      this.options.workspace.taskPaneNotice = 'select a repository first';
      this.options.markDirty();
      return;
    }
    const fields = taskFieldsFromComposerText(this.options.workspace.taskDraftComposer.text);
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
        this.options.workspace.taskDraftComposer = createTaskComposerBuffer('');
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

  private matchesSequence(input: Buffer, startIndex: number, sequence: Buffer): boolean {
    if (startIndex < 0 || startIndex + sequence.length > input.length) {
      return false;
    }
    for (let index = 0; index < sequence.length; index += 1) {
      if (input[startIndex + index] !== sequence[index]) {
        return false;
      }
    }
    return true;
  }

  private extractInsertText(input: Buffer): string | null {
    const chunks: Buffer[] = [];
    let inBracketedPaste = false;
    for (let index = 0; index < input.length; index += 1) {
      if (!inBracketedPaste && this.matchesSequence(input, index, BRACKETED_PASTE_START)) {
        inBracketedPaste = true;
        index += BRACKETED_PASTE_START.length - 1;
        continue;
      }
      if (inBracketedPaste && this.matchesSequence(input, index, BRACKETED_PASTE_END)) {
        inBracketedPaste = false;
        index += BRACKETED_PASTE_END.length - 1;
        continue;
      }
      const byte = input[index]!;
      if (inBracketedPaste) {
        chunks.push(Buffer.from([byte]));
        continue;
      }
      if (byte === 0x1b) {
        return null;
      }
      if (byte >= 32 && byte <= 126) {
        chunks.push(Buffer.from([byte]));
      }
    }
    if (chunks.length === 0) {
      return '';
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r\n?/gu, '\n');
  }

  private handleShortcutAction(action: string): boolean {
    const workspace = this.options.workspace;
    switch (action) {
      case 'mux.home.repo.dropdown.toggle':
        workspace.taskRepositoryDropdownOpen = !workspace.taskRepositoryDropdownOpen;
        this.options.markDirty();
        return true;
      case 'mux.home.repo.next':
        workspace.taskRepositoryDropdownOpen = true;
        this.selectRepositoryByDirection(1);
        return true;
      case 'mux.home.repo.previous':
        workspace.taskRepositoryDropdownOpen = true;
        this.selectRepositoryByDirection(-1);
        return true;
      case 'mux.home.task.status.ready':
        this.options.runTaskPaneAction('task.ready');
        return true;
      case 'mux.home.task.status.draft':
        this.options.runTaskPaneAction('task.draft');
        return true;
      case 'mux.home.task.status.complete':
        this.options.runTaskPaneAction('task.complete');
        return true;
      case 'mux.home.task.reorder.up':
        this.options.runTaskPaneAction('task.reorder-up');
        return true;
      case 'mux.home.task.reorder.down':
        this.options.runTaskPaneAction('task.reorder-down');
        return true;
      case 'mux.home.task.newline':
        this.updateHomeEditorBuffer(insertTaskComposerText(this.homeEditorBuffer(), '\n'));
        return true;
      case 'mux.home.task.queue':
        if (workspace.taskEditorTarget.kind === 'draft') {
          this.submitDraftTaskFromComposer('queue');
        } else {
          this.options.focusDraftComposer();
        }
        return true;
      case 'mux.home.task.submit':
        if (workspace.taskEditorTarget.kind === 'draft') {
          this.submitDraftTaskFromComposer('ready');
        } else {
          this.options.focusDraftComposer();
        }
        return true;
      case 'mux.home.editor.cursor.left':
        this.updateHomeEditorBuffer(taskComposerMoveLeft(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.cursor.right':
        this.updateHomeEditorBuffer(taskComposerMoveRight(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.cursor.up': {
        const vertical = taskComposerMoveVertical(this.homeEditorBuffer(), -1);
        if (vertical.hitBoundary) {
          this.moveTaskEditorFocusUp();
        } else {
          this.updateHomeEditorBuffer(vertical.next);
        }
        return true;
      }
      case 'mux.home.editor.cursor.down':
        if (workspace.taskEditorTarget.kind === 'task') {
          const vertical = taskComposerMoveVertical(this.homeEditorBuffer(), 1);
          if (vertical.hitBoundary) {
            this.moveTaskEditorFocusDown();
          } else {
            this.updateHomeEditorBuffer(vertical.next);
          }
        } else {
          this.updateHomeEditorBuffer(taskComposerMoveVertical(this.homeEditorBuffer(), 1).next);
        }
        return true;
      case 'mux.home.editor.line.start':
        this.updateHomeEditorBuffer(taskComposerMoveLineStart(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.line.end':
        this.updateHomeEditorBuffer(taskComposerMoveLineEnd(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.word.left':
        this.updateHomeEditorBuffer(taskComposerMoveWordLeft(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.word.right':
        this.updateHomeEditorBuffer(taskComposerMoveWordRight(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.backward':
        this.updateHomeEditorBuffer(taskComposerBackspace(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.forward':
        this.updateHomeEditorBuffer(taskComposerDeleteForward(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.word.backward':
        this.updateHomeEditorBuffer(taskComposerDeleteWordLeft(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.line.start':
        this.updateHomeEditorBuffer(taskComposerDeleteToLineStart(this.homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.line.end':
        this.updateHomeEditorBuffer(taskComposerDeleteToLineEnd(this.homeEditorBuffer()));
        return true;
      default:
        return false;
    }
  }

  handleInput(input: Buffer): boolean {
    const workspace = this.options.workspace;
    if (workspace.mainPaneMode !== 'home' || workspace.leftNavSelection.kind !== 'tasks') {
      return false;
    }
    const action = detectTaskScreenKeybindingAction(input, this.options.taskScreenKeybindings);
    if (action !== null && this.handleShortcutAction(action)) {
      return true;
    }
    const inserted = this.extractInsertText(input);
    if (inserted === null || inserted.length === 0) {
      return false;
    }
    this.updateHomeEditorBuffer(insertTaskComposerText(this.homeEditorBuffer(), inserted));
    return true;
  }
}
