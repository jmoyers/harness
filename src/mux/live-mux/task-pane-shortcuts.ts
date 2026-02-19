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
  focusDraftComposer: () => void;
  submitDraftTaskFromComposer: () => void;
  runTaskPaneAction: (action: TaskPaneActionShortcut) => void;
  selectRepositoryByDirection: (direction: 1 | -1) => void;
  getTaskRepositoryDropdownOpen: () => boolean;
  setTaskRepositoryDropdownOpen: (open: boolean) => void;
  markDirty: () => void;
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
    if (action === 'mux.home.repo.dropdown.toggle') {
      setTaskRepositoryDropdownOpen(!getTaskRepositoryDropdownOpen());
      markDirty();
      return true;
    }
    if (action === 'mux.home.repo.next') {
      setTaskRepositoryDropdownOpen(true);
      selectRepositoryByDirection(1);
      return true;
    }
    if (action === 'mux.home.repo.previous') {
      setTaskRepositoryDropdownOpen(true);
      selectRepositoryByDirection(-1);
      return true;
    }
    if (action === 'mux.home.task.status.ready') {
      runTaskPaneAction('task.ready');
      return true;
    }
    if (action === 'mux.home.task.status.draft') {
      runTaskPaneAction('task.draft');
      return true;
    }
    if (action === 'mux.home.task.status.complete') {
      runTaskPaneAction('task.complete');
      return true;
    }
    if (action === 'mux.home.task.reorder.up') {
      runTaskPaneAction('task.reorder-up');
      return true;
    }
    if (action === 'mux.home.task.reorder.down') {
      runTaskPaneAction('task.reorder-down');
      return true;
    }
    if (action === 'mux.home.task.newline') {
      updateHomeEditorBuffer(insertTaskComposerText(homeEditorBuffer(), '\n'));
      return true;
    }
    if (action === 'mux.home.task.submit') {
      if (taskEditorTarget.kind === 'draft') {
        submitDraftTaskFromComposer();
      } else {
        focusDraftComposer();
      }
      return true;
    }
    if (action === 'mux.home.editor.cursor.left') {
      updateHomeEditorBuffer(taskComposerMoveLeft(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.cursor.right') {
      updateHomeEditorBuffer(taskComposerMoveRight(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.cursor.up') {
      const vertical = taskComposerMoveVertical(homeEditorBuffer(), -1);
      if (vertical.hitBoundary) {
        moveTaskEditorFocusUp();
      } else {
        updateHomeEditorBuffer(vertical.next);
      }
      return true;
    }
    if (action === 'mux.home.editor.cursor.down') {
      if (taskEditorTarget.kind === 'task') {
        const vertical = taskComposerMoveVertical(homeEditorBuffer(), 1);
        if (vertical.hitBoundary) {
          focusDraftComposer();
        } else {
          updateHomeEditorBuffer(vertical.next);
        }
      } else {
        updateHomeEditorBuffer(taskComposerMoveVertical(homeEditorBuffer(), 1).next);
      }
      return true;
    }
    if (action === 'mux.home.editor.line.start') {
      updateHomeEditorBuffer(taskComposerMoveLineStart(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.line.end') {
      updateHomeEditorBuffer(taskComposerMoveLineEnd(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.word.left') {
      updateHomeEditorBuffer(taskComposerMoveWordLeft(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.word.right') {
      updateHomeEditorBuffer(taskComposerMoveWordRight(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.delete.backward') {
      updateHomeEditorBuffer(taskComposerBackspace(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.delete.forward') {
      updateHomeEditorBuffer(taskComposerDeleteForward(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.delete.word.backward') {
      updateHomeEditorBuffer(taskComposerDeleteWordLeft(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.delete.line.start') {
      updateHomeEditorBuffer(taskComposerDeleteToLineStart(homeEditorBuffer()));
      return true;
    }
    if (action === 'mux.home.editor.delete.line.end') {
      updateHomeEditorBuffer(taskComposerDeleteToLineEnd(homeEditorBuffer()));
      return true;
    }
  }

  if (input.includes(0x1b)) {
    return false;
  }

  let next = homeEditorBuffer();
  let changed = false;
  for (const byte of input) {
    if (byte >= 32 && byte <= 126) {
      next = insertTaskComposerText(next, String.fromCharCode(byte));
      changed = true;
    }
  }
  if (!changed) {
    return false;
  }
  updateHomeEditorBuffer(next);
  return true;
}
