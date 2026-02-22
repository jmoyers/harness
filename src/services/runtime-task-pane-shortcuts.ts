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

export interface RuntimeTaskPaneShortcuts {
  homeEditorBuffer(): TaskComposerBuffer;
  updateHomeEditorBuffer(next: TaskComposerBuffer): void;
  selectRepositoryByDirection(direction: 1 | -1): void;
  submitDraftTaskFromComposer(mode: TaskComposerSubmitMode): void;
  moveTaskEditorFocusUp(): void;
  moveTaskEditorFocusDown(): void;
  handleInput(input: Buffer): boolean;
}

export function createRuntimeTaskPaneShortcuts<TTaskRecord extends TaskRecordShape>(
  options: RuntimeTaskPaneShortcutsOptions<TTaskRecord>,
): RuntimeTaskPaneShortcuts {
  const homeEditorBuffer = (): TaskComposerBuffer => {
    const taskEditorTarget = options.workspace.taskEditorTarget;
    if (taskEditorTarget.kind === 'task') {
      return options.taskComposerForTask(taskEditorTarget.taskId) ?? createTaskComposerBuffer('');
    }
    return options.workspace.taskDraftComposer;
  };

  const updateHomeEditorBuffer = (next: TaskComposerBuffer): void => {
    const taskEditorTarget = options.workspace.taskEditorTarget;
    if (taskEditorTarget.kind === 'task') {
      options.setTaskComposerForTask(taskEditorTarget.taskId, next);
      options.scheduleTaskComposerPersist(taskEditorTarget.taskId);
    } else {
      options.workspace.taskDraftComposer = normalizeTaskComposerBuffer(next);
    }
    options.markDirty();
  };

  const selectRepositoryByDirection = (direction: 1 | -1): void => {
    const orderedIds = options.activeRepositoryIds();
    if (orderedIds.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      orderedIds.indexOf(options.workspace.taskPaneSelectedRepositoryId ?? ''),
    );
    const nextIndex = Math.max(0, Math.min(orderedIds.length - 1, currentIndex + direction));
    const nextRepositoryId = orderedIds[nextIndex];
    if (nextRepositoryId !== undefined) {
      options.selectRepositoryById(nextRepositoryId);
    }
  };

  const taskNavigationIds = (): readonly string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const taskId of options.workspace.latestTaskPaneView.taskIds) {
      if (taskId === null || seen.has(taskId)) {
        continue;
      }
      ids.push(taskId);
      seen.add(taskId);
    }
    if (ids.length > 0) {
      return ids;
    }
    for (const task of options.selectedRepositoryTaskRecords()) {
      if (seen.has(task.taskId)) {
        continue;
      }
      ids.push(task.taskId);
      seen.add(task.taskId);
    }
    return ids;
  };

  const submitDraftTaskFromComposer = (mode: TaskComposerSubmitMode): void => {
    const repositoryId = options.workspace.taskPaneSelectedRepositoryId;
    if (repositoryId === null || !options.repositoriesHas(repositoryId)) {
      options.workspace.taskPaneNotice = 'select a repository first';
      options.markDirty();
      return;
    }
    const fields = taskFieldsFromComposerText(options.workspace.taskDraftComposer.text);
    if (fields.body.trim().length === 0) {
      options.workspace.taskPaneNotice = 'task body is required';
      options.markDirty();
      return;
    }
    options.queueControlPlaneOp(
      async () => {
        const created = await options.createTask({
          repositoryId,
          title: fields.title ?? '',
          body: fields.body,
        });
        const task = mode === 'ready' ? await options.taskReady(created.taskId) : created;
        options.applyTaskRecord(task);
        options.workspace.taskDraftComposer = createTaskComposerBuffer('');
        options.workspace.taskPaneNotice = null;
        options.syncTaskPaneSelection();
        options.markDirty();
      },
      mode === 'ready' ? 'task-composer-submit-ready' : 'task-composer-queue',
    );
  };

  const moveTaskEditorFocusUp = (): void => {
    const workspace = options.workspace;
    const navigationTaskIds = taskNavigationIds();
    if (workspace.taskEditorTarget.kind === 'draft') {
      const fallbackTaskId = navigationTaskIds[navigationTaskIds.length - 1];
      if (fallbackTaskId !== undefined) {
        options.focusTaskComposer(fallbackTaskId);
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
      options.focusTaskComposer(targetTaskId);
    }
  };

  const moveTaskEditorFocusDown = (): void => {
    const workspace = options.workspace;
    if (workspace.taskEditorTarget.kind !== 'task') {
      return;
    }
    const navigationTaskIds = taskNavigationIds();
    const focusedTaskId = workspace.taskEditorTarget.taskId;
    const index = navigationTaskIds.indexOf(focusedTaskId);
    if (index < 0) {
      options.focusDraftComposer();
      return;
    }
    const targetTaskId = navigationTaskIds[index + 1];
    if (targetTaskId !== undefined) {
      options.focusTaskComposer(targetTaskId);
      return;
    }
    options.focusDraftComposer();
  };

  const matchesSequence = (input: Buffer, startIndex: number, sequence: Buffer): boolean => {
    if (startIndex < 0 || startIndex + sequence.length > input.length) {
      return false;
    }
    for (let index = 0; index < sequence.length; index += 1) {
      if (input[startIndex + index] !== sequence[index]) {
        return false;
      }
    }
    return true;
  };

  const extractInsertText = (input: Buffer): string | null => {
    const chunks: Buffer[] = [];
    let inBracketedPaste = false;
    for (let index = 0; index < input.length; index += 1) {
      if (!inBracketedPaste && matchesSequence(input, index, BRACKETED_PASTE_START)) {
        inBracketedPaste = true;
        index += BRACKETED_PASTE_START.length - 1;
        continue;
      }
      if (inBracketedPaste && matchesSequence(input, index, BRACKETED_PASTE_END)) {
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
  };

  const handleShortcutAction = (action: string): boolean => {
    const workspace = options.workspace;
    switch (action) {
      case 'mux.home.repo.dropdown.toggle':
        workspace.taskRepositoryDropdownOpen = !workspace.taskRepositoryDropdownOpen;
        options.markDirty();
        return true;
      case 'mux.home.repo.next':
        workspace.taskRepositoryDropdownOpen = true;
        selectRepositoryByDirection(1);
        return true;
      case 'mux.home.repo.previous':
        workspace.taskRepositoryDropdownOpen = true;
        selectRepositoryByDirection(-1);
        return true;
      case 'mux.home.task.status.ready':
        options.runTaskPaneAction('task.ready');
        return true;
      case 'mux.home.task.status.draft':
        options.runTaskPaneAction('task.draft');
        return true;
      case 'mux.home.task.status.complete':
        options.runTaskPaneAction('task.complete');
        return true;
      case 'mux.home.task.reorder.up':
        options.runTaskPaneAction('task.reorder-up');
        return true;
      case 'mux.home.task.reorder.down':
        options.runTaskPaneAction('task.reorder-down');
        return true;
      case 'mux.home.task.newline':
        updateHomeEditorBuffer(insertTaskComposerText(homeEditorBuffer(), '\n'));
        return true;
      case 'mux.home.task.queue':
        if (workspace.taskEditorTarget.kind === 'draft') {
          submitDraftTaskFromComposer('queue');
        } else {
          options.focusDraftComposer();
        }
        return true;
      case 'mux.home.task.submit':
        if (workspace.taskEditorTarget.kind === 'draft') {
          submitDraftTaskFromComposer('ready');
        } else {
          options.focusDraftComposer();
        }
        return true;
      case 'mux.home.editor.cursor.left':
        updateHomeEditorBuffer(taskComposerMoveLeft(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.cursor.right':
        updateHomeEditorBuffer(taskComposerMoveRight(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.cursor.up': {
        const vertical = taskComposerMoveVertical(homeEditorBuffer(), -1);
        if (vertical.hitBoundary) {
          moveTaskEditorFocusUp();
        } else {
          updateHomeEditorBuffer(vertical.next);
        }
        return true;
      }
      case 'mux.home.editor.cursor.down':
        if (workspace.taskEditorTarget.kind === 'task') {
          const vertical = taskComposerMoveVertical(homeEditorBuffer(), 1);
          if (vertical.hitBoundary) {
            moveTaskEditorFocusDown();
          } else {
            updateHomeEditorBuffer(vertical.next);
          }
        } else {
          updateHomeEditorBuffer(taskComposerMoveVertical(homeEditorBuffer(), 1).next);
        }
        return true;
      case 'mux.home.editor.line.start':
        updateHomeEditorBuffer(taskComposerMoveLineStart(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.line.end':
        updateHomeEditorBuffer(taskComposerMoveLineEnd(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.word.left':
        updateHomeEditorBuffer(taskComposerMoveWordLeft(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.word.right':
        updateHomeEditorBuffer(taskComposerMoveWordRight(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.backward':
        updateHomeEditorBuffer(taskComposerBackspace(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.forward':
        updateHomeEditorBuffer(taskComposerDeleteForward(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.word.backward':
        updateHomeEditorBuffer(taskComposerDeleteWordLeft(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.line.start':
        updateHomeEditorBuffer(taskComposerDeleteToLineStart(homeEditorBuffer()));
        return true;
      case 'mux.home.editor.delete.line.end':
        updateHomeEditorBuffer(taskComposerDeleteToLineEnd(homeEditorBuffer()));
        return true;
      default:
        return false;
    }
  };

  const handleInput = (input: Buffer): boolean => {
    const workspace = options.workspace;
    if (workspace.mainPaneMode !== 'home' || workspace.leftNavSelection.kind !== 'tasks') {
      return false;
    }
    const action = detectTaskScreenKeybindingAction(input, options.taskScreenKeybindings);
    if (action !== null && handleShortcutAction(action)) {
      return true;
    }
    const inserted = extractInsertText(input);
    if (inserted === null || inserted.length === 0) {
      return false;
    }
    updateHomeEditorBuffer(insertTaskComposerText(homeEditorBuffer(), inserted));
    return true;
  };

  return {
    homeEditorBuffer,
    updateHomeEditorBuffer,
    selectRepositoryByDirection,
    submitDraftTaskFromComposer,
    moveTaskEditorFocusUp,
    moveTaskEditorFocusDown,
    handleInput,
  };
}
