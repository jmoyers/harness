import {
  insertTaskComposerText,
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
  type TaskComposerBuffer,
} from '../task-composer.ts';
import { detectTaskScreenKeybindingAction } from '../task-screen-keybindings.ts';

type TaskPaneActionShortcut =
  | 'task.ready'
  | 'task.draft'
  | 'task.complete'
  | 'task.reorder-up'
  | 'task.reorder-down';
type TaskComposerSubmitMode = 'ready' | 'queue';

const BRACKETED_PASTE_START = Buffer.from('\u001b[200~', 'utf8');
const BRACKETED_PASTE_END = Buffer.from('\u001b[201~', 'utf8');

interface TaskEditorTargetDraft {
  kind: 'draft';
}

interface TaskEditorTargetTask {
  kind: 'task';
  taskId: string;
}

interface HandleTaskPaneShortcutInputOptions {
  input: Buffer;
  mainPaneMode: 'conversation' | 'project' | 'home';
  taskPaneVisible?: boolean;
  taskScreenKeybindings: Parameters<typeof detectTaskScreenKeybindingAction>[1];
  taskEditorTarget: TaskEditorTargetDraft | TaskEditorTargetTask;
  homeEditorBuffer: () => TaskComposerBuffer;
  updateHomeEditorBuffer: (next: TaskComposerBuffer) => void;
  moveTaskEditorFocusUp: () => void;
  moveTaskEditorFocusDown: () => void;
  focusDraftComposer: () => void;
  submitDraftTaskFromComposer: (mode: TaskComposerSubmitMode) => void;
  runTaskPaneAction: (action: TaskPaneActionShortcut) => void;
  selectRepositoryByDirection: (direction: 1 | -1) => void;
  getTaskRepositoryDropdownOpen: () => boolean;
  setTaskRepositoryDropdownOpen: (open: boolean) => void;
  markDirty: () => void;
}

function matchesSequence(input: Buffer, startIndex: number, sequence: Buffer): boolean {
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

function extractTaskPaneInsertText(input: Buffer): string | null {
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
}

export function handleTaskPaneShortcutInput(options: HandleTaskPaneShortcutInputOptions): boolean {
  const {
    input,
    mainPaneMode,
    taskPaneVisible = true,
    taskScreenKeybindings,
    taskEditorTarget,
    homeEditorBuffer,
    updateHomeEditorBuffer,
    moveTaskEditorFocusUp,
    moveTaskEditorFocusDown,
    focusDraftComposer,
    submitDraftTaskFromComposer,
    runTaskPaneAction,
    selectRepositoryByDirection,
    getTaskRepositoryDropdownOpen,
    setTaskRepositoryDropdownOpen,
    markDirty,
  } = options;
  if (mainPaneMode !== 'home' || !taskPaneVisible) {
    return false;
  }
  const action = detectTaskScreenKeybindingAction(input, taskScreenKeybindings);
  if (action !== null) {
    switch (action) {
      case 'mux.home.repo.dropdown.toggle':
        setTaskRepositoryDropdownOpen(!getTaskRepositoryDropdownOpen());
        markDirty();
        return true;
      case 'mux.home.repo.next':
        setTaskRepositoryDropdownOpen(true);
        selectRepositoryByDirection(1);
        return true;
      case 'mux.home.repo.previous':
        setTaskRepositoryDropdownOpen(true);
        selectRepositoryByDirection(-1);
        return true;
      case 'mux.home.task.status.ready':
        runTaskPaneAction('task.ready');
        return true;
      case 'mux.home.task.status.draft':
        runTaskPaneAction('task.draft');
        return true;
      case 'mux.home.task.status.complete':
        runTaskPaneAction('task.complete');
        return true;
      case 'mux.home.task.reorder.up':
        runTaskPaneAction('task.reorder-up');
        return true;
      case 'mux.home.task.reorder.down':
        runTaskPaneAction('task.reorder-down');
        return true;
      case 'mux.home.task.newline':
        updateHomeEditorBuffer(insertTaskComposerText(homeEditorBuffer(), '\n'));
        return true;
      case 'mux.home.task.queue':
        if (taskEditorTarget.kind === 'draft') {
          submitDraftTaskFromComposer('queue');
        } else {
          focusDraftComposer();
        }
        return true;
      case 'mux.home.task.submit':
        if (taskEditorTarget.kind === 'draft') {
          submitDraftTaskFromComposer('ready');
        } else {
          focusDraftComposer();
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
        if (taskEditorTarget.kind === 'task') {
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
    }
  }

  const inserted = extractTaskPaneInsertText(input);
  if (inserted === null) {
    return false;
  }
  if (inserted.length === 0) {
    return false;
  }
  updateHomeEditorBuffer(insertTaskComposerText(homeEditorBuffer(), inserted));
  return true;
}
