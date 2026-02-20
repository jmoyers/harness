import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTaskComposerBuffer, type TaskComposerBuffer } from '../src/mux/task-composer.ts';
import { resolveTaskScreenKeybindings } from '../src/mux/task-screen-keybindings.ts';
import { handleTaskPaneShortcutInput } from '../src/mux/live-mux/task-pane-shortcuts.ts';

const bindings = resolveTaskScreenKeybindings({
  'mux.home.repo.dropdown.toggle': ['g'],
  'mux.home.repo.next': ['n'],
  'mux.home.repo.previous': ['p'],
  'mux.home.task.submit': ['s'],
  'mux.home.task.queue': ['q'],
  'mux.home.task.newline': ['l'],
  'mux.home.task.status.ready': ['r'],
  'mux.home.task.status.draft': ['d'],
  'mux.home.task.status.complete': ['c'],
  'mux.home.task.reorder.up': ['u'],
  'mux.home.task.reorder.down': ['j'],
  'mux.home.editor.cursor.left': ['h'],
  'mux.home.editor.cursor.right': ['k'],
  'mux.home.editor.cursor.up': ['i'],
  'mux.home.editor.cursor.down': ['m'],
  'mux.home.editor.line.start': ['a'],
  'mux.home.editor.line.end': ['e'],
  'mux.home.editor.word.left': ['b'],
  'mux.home.editor.word.right': ['f'],
  'mux.home.editor.delete.backward': ['x'],
  'mux.home.editor.delete.forward': ['y'],
  'mux.home.editor.delete.word.backward': ['w'],
  'mux.home.editor.delete.line.start': ['t'],
  'mux.home.editor.delete.line.end': ['z'],
});

interface RunOptions {
  input: string | Buffer;
  mainPaneMode?: 'conversation' | 'project' | 'home';
  taskPaneVisible?: boolean;
  taskEditorTarget?: { kind: 'draft' } | { kind: 'task'; taskId: string };
  initialBuffer?: TaskComposerBuffer;
  dropdownOpen?: boolean;
}

function runShortcut(options: RunOptions): {
  handled: boolean;
  calls: string[];
  buffer: TaskComposerBuffer;
  dropdownOpen: boolean;
} {
  const calls: string[] = [];
  let buffer = options.initialBuffer ?? createTaskComposerBuffer('alpha beta');
  let dropdownOpen = options.dropdownOpen ?? false;
  const handled = handleTaskPaneShortcutInput({
    input: typeof options.input === 'string' ? Buffer.from(options.input, 'utf8') : options.input,
    mainPaneMode: options.mainPaneMode ?? 'home',
    taskPaneVisible: options.taskPaneVisible ?? true,
    taskScreenKeybindings: bindings,
    taskEditorTarget: options.taskEditorTarget ?? { kind: 'draft' },
    homeEditorBuffer: () => buffer,
    updateHomeEditorBuffer: (next) => {
      buffer = next;
      calls.push(`buffer:${next.text}:${next.cursor}`);
    },
    moveTaskEditorFocusUp: () => calls.push('move-up'),
    moveTaskEditorFocusDown: () => calls.push('move-down'),
    focusDraftComposer: () => calls.push('focus-draft'),
    submitDraftTaskFromComposer: (mode) => calls.push(`submit-draft:${mode}`),
    runTaskPaneAction: (action) => calls.push(`action:${action}`),
    selectRepositoryByDirection: (direction) => calls.push(`repo-direction:${direction}`),
    getTaskRepositoryDropdownOpen: () => dropdownOpen,
    setTaskRepositoryDropdownOpen: (open) => {
      dropdownOpen = open;
      calls.push(`dropdown:${open}`);
    },
    markDirty: () => calls.push('dirty'),
  });
  return {
    handled,
    calls,
    buffer,
    dropdownOpen,
  };
}

void test('task pane shortcuts ignore non-home panes and handle escape/raw-input fallbacks', () => {
  const nonHome = runShortcut({
    input: 'g',
    mainPaneMode: 'conversation',
  });
  assert.equal(nonHome.handled, false);

  const hiddenTaskPane = runShortcut({
    input: 'g',
    taskPaneVisible: false,
  });
  assert.equal(hiddenTaskPane.handled, false);

  const escapeFallback = runShortcut({
    input: Buffer.from('\u001b[A', 'utf8'),
  });
  assert.equal(escapeFallback.handled, false);

  const unchangedFallback = runShortcut({
    input: Buffer.from([0x01]),
  });
  assert.equal(unchangedFallback.handled, false);

  const printableFallback = runShortcut({
    input: 'Q!',
    initialBuffer: createTaskComposerBuffer('seed'),
  });
  assert.equal(printableFallback.handled, true);
  assert.equal(printableFallback.buffer.text.endsWith('Q!'), true);
});

void test('task pane shortcuts accept bracketed paste payloads for composer input', () => {
  const pasted = runShortcut({
    input: Buffer.from('\u001b[200~line 1\nline 2\u001b[201~', 'utf8'),
    initialBuffer: createTaskComposerBuffer('seed '),
  });
  assert.equal(pasted.handled, true);
  assert.equal(pasted.buffer.text, 'seed line 1\nline 2');

  const unsupportedEscape = runShortcut({
    input: Buffer.from('\u001b[A', 'utf8'),
    initialBuffer: createTaskComposerBuffer('seed'),
  });
  assert.equal(unsupportedEscape.handled, false);
  assert.equal(unsupportedEscape.buffer.text, 'seed');
});

void test('task pane shortcut actions route repository controls and task actions', () => {
  const toggle = runShortcut({
    input: 'g',
    dropdownOpen: false,
  });
  assert.equal(toggle.handled, true);
  assert.equal(toggle.dropdownOpen, true);
  assert.equal(toggle.calls.includes('dirty'), true);

  const next = runShortcut({
    input: 'n',
    dropdownOpen: false,
  });
  assert.equal(next.handled, true);
  assert.equal(next.calls.includes('dropdown:true'), true);
  assert.equal(next.calls.includes('repo-direction:1'), true);

  const previous = runShortcut({
    input: 'p',
    dropdownOpen: false,
  });
  assert.equal(previous.handled, true);
  assert.equal(previous.calls.includes('dropdown:true'), true);
  assert.equal(previous.calls.includes('repo-direction:-1'), true);

  const ready = runShortcut({ input: 'r' });
  assert.equal(ready.calls.includes('action:task.ready'), true);
  const draft = runShortcut({ input: 'd' });
  assert.equal(draft.calls.includes('action:task.draft'), true);
  const complete = runShortcut({ input: 'c' });
  assert.equal(complete.calls.includes('action:task.complete'), true);
  const up = runShortcut({ input: 'u' });
  assert.equal(up.calls.includes('action:task.reorder-up'), true);
  const down = runShortcut({ input: 'j' });
  assert.equal(down.calls.includes('action:task.reorder-down'), true);

  const newline = runShortcut({ input: 'l', initialBuffer: createTaskComposerBuffer('abc') });
  assert.equal(newline.buffer.text.includes('\n'), true);

  const submitDraft = runShortcut({
    input: 's',
    taskEditorTarget: { kind: 'draft' },
  });
  assert.equal(submitDraft.calls.includes('submit-draft:ready'), true);
  const submitTask = runShortcut({
    input: 's',
    taskEditorTarget: { kind: 'task', taskId: 'task-a' },
  });
  assert.equal(submitTask.calls.includes('focus-draft'), true);

  const queueDraft = runShortcut({
    input: 'q',
    taskEditorTarget: { kind: 'draft' },
    initialBuffer: createTaskComposerBuffer('seed'),
  });
  assert.equal(queueDraft.handled, true);
  assert.equal(queueDraft.calls.includes('submit-draft:queue'), true);
  assert.equal(queueDraft.buffer.text, 'seed');

  const queueFromTaskEditorFocusesDraft = runShortcut({
    input: 'q',
    taskEditorTarget: { kind: 'task', taskId: 'task-a' },
    initialBuffer: createTaskComposerBuffer('seed'),
  });
  assert.equal(queueFromTaskEditorFocusesDraft.handled, true);
  assert.equal(queueFromTaskEditorFocusesDraft.calls.includes('focus-draft'), true);
});

void test('task pane editor cursor and delete actions route through composer operations', () => {
  const left = runShortcut({
    input: 'h',
    initialBuffer: {
      text: 'abc',
      cursor: 2,
    },
  });
  assert.equal(left.buffer.cursor, 1);

  const right = runShortcut({
    input: 'k',
    initialBuffer: {
      text: 'abc',
      cursor: 1,
    },
  });
  assert.equal(right.buffer.cursor, 2);

  const upBoundary = runShortcut({
    input: 'i',
    initialBuffer: {
      text: 'line1',
      cursor: 0,
    },
  });
  assert.equal(upBoundary.calls.includes('move-up'), true);

  const upWithinText = runShortcut({
    input: 'i',
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 7,
    },
  });
  assert.equal(upWithinText.calls.includes('move-up'), false);
  assert.equal(
    upWithinText.calls.some((value) => value.startsWith('buffer:')),
    true,
  );

  const downTaskBoundary = runShortcut({
    input: 'm',
    taskEditorTarget: { kind: 'task', taskId: 'task-a' },
    initialBuffer: {
      text: 'line1',
      cursor: 5,
    },
  });
  assert.equal(downTaskBoundary.calls.includes('move-down'), true);
  assert.equal(downTaskBoundary.calls.includes('focus-draft'), false);

  const downTaskWithinText = runShortcut({
    input: 'm',
    taskEditorTarget: { kind: 'task', taskId: 'task-a' },
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 0,
    },
  });
  assert.equal(downTaskWithinText.calls.includes('focus-draft'), false);
  assert.equal(
    downTaskWithinText.calls.some((value) => value.startsWith('buffer:')),
    true,
  );

  const downDraft = runShortcut({
    input: 'm',
    taskEditorTarget: { kind: 'draft' },
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 0,
    },
  });
  assert.equal(
    downDraft.calls.some((value) => value.startsWith('buffer:')),
    true,
  );

  const lineStart = runShortcut({
    input: 'a',
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 7,
    },
  });
  assert.equal(lineStart.buffer.cursor, 6);

  const lineEnd = runShortcut({
    input: 'e',
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 1,
    },
  });
  assert.equal(lineEnd.buffer.cursor, 5);

  const wordLeft = runShortcut({
    input: 'b',
    initialBuffer: {
      text: 'alpha beta',
      cursor: 10,
    },
  });
  assert.equal(wordLeft.buffer.cursor, 6);

  const wordRight = runShortcut({
    input: 'f',
    initialBuffer: {
      text: 'alpha beta',
      cursor: 0,
    },
  });
  assert.equal(wordRight.buffer.cursor, 5);

  const backspace = runShortcut({
    input: 'x',
    initialBuffer: {
      text: 'abc',
      cursor: 2,
    },
  });
  assert.equal(backspace.buffer.text, 'ac');

  const deleteForward = runShortcut({
    input: 'y',
    initialBuffer: {
      text: 'abc',
      cursor: 1,
    },
  });
  assert.equal(deleteForward.buffer.text, 'ac');

  const deleteWord = runShortcut({
    input: 'w',
    initialBuffer: {
      text: 'alpha beta',
      cursor: 10,
    },
  });
  assert.equal(deleteWord.buffer.text, 'alpha ');

  const deleteLineStart = runShortcut({
    input: 't',
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 7,
    },
  });
  assert.equal(deleteLineStart.buffer.text, 'line1\nine2');

  const deleteLineEnd = runShortcut({
    input: 'z',
    initialBuffer: {
      text: 'line1\nline2',
      cursor: 1,
    },
  });
  assert.equal(deleteLineEnd.buffer.text, 'l\nline2');
});
