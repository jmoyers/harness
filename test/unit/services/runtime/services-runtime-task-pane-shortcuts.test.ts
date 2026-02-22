import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../../../../src/domain/workspace.ts';
import type { TaskComposerBuffer } from '../../../../src/mux/task-composer.ts';
import { resolveTaskScreenKeybindings } from '../../../../src/mux/task-screen-keybindings.ts';
import {
  createRuntimeTaskPaneShortcuts,
  type RuntimeTaskPaneShortcutsOptions,
} from '../../../../src/services/runtime-task-pane-shortcuts.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
}

type ShortcutsOptions = RuntimeTaskPaneShortcutsOptions<TaskRecord>;

function createWorkspace(): WorkspaceModel {
  return new WorkspaceModel({
    activeDirectoryId: null,
    leftNavSelection: {
      kind: 'home',
    },
    latestTaskPaneView: {
      rows: [],
      taskIds: [],
      repositoryIds: [],
      actions: [],
      actionCells: [],
      top: 0,
      selectedRepositoryId: null,
    },
    taskDraftComposer: {
      text: '',
      cursor: 0,
    },
    repositoriesCollapsed: false,
  });
}

function createHarness(overrides: Partial<ShortcutsOptions> = {}) {
  const workspace = createWorkspace();
  const composerByTask = new Map<string, TaskComposerBuffer>();
  const taskRecords: TaskRecord[] = [];
  const calls: string[] = [];
  const selectedRepositoryTasks: TaskRecord[] = [];
  const createdPayloads: Array<{
    repositoryId: string;
    title: string;
    body: string;
  }> = [];
  const queued: Promise<void>[] = [];

  const options: ShortcutsOptions = {
    workspace,
    taskScreenKeybindings: resolveTaskScreenKeybindings(),
    repositoriesHas: (repositoryId) => repositoryId === 'repo-1',
    activeRepositoryIds: () => ['repo-1', 'repo-2'],
    selectRepositoryById: (repositoryId) => {
      calls.push(`selectRepositoryById:${repositoryId}`);
      workspace.taskPaneSelectedRepositoryId = repositoryId;
    },
    taskComposerForTask: (taskId) => composerByTask.get(taskId) ?? null,
    setTaskComposerForTask: (taskId, buffer) => {
      calls.push(`setTaskComposerForTask:${taskId}`);
      composerByTask.set(taskId, buffer);
    },
    scheduleTaskComposerPersist: (taskId) => {
      calls.push(`scheduleTaskComposerPersist:${taskId}`);
    },
    selectedRepositoryTaskRecords: () => selectedRepositoryTasks,
    focusTaskComposer: (taskId) => {
      calls.push(`focusTaskComposer:${taskId}`);
      workspace.taskEditorTarget = {
        kind: 'task',
        taskId,
      };
    },
    focusDraftComposer: () => {
      calls.push('focusDraftComposer');
      workspace.taskEditorTarget = { kind: 'draft' };
    },
    runTaskPaneAction: (action) => {
      calls.push(`runTaskPaneAction:${action}`);
    },
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label ?? ''}`);
      queued.push(task());
    },
    createTask: async (payload) => {
      createdPayloads.push(payload);
      const created: TaskRecord = {
        taskId: `task-${createdPayloads.length}`,
        repositoryId: payload.repositoryId,
        title: payload.title,
        body: payload.body,
      };
      taskRecords.push(created);
      return created;
    },
    taskReady: async (taskId) => {
      calls.push(`taskReady:${taskId}`);
      const existing = taskRecords.find((task) => task.taskId === taskId);
      if (existing === undefined) {
        throw new Error(`missing task: ${taskId}`);
      }
      return existing;
    },
    applyTaskRecord: (task) => {
      calls.push(`applyTaskRecord:${task.taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('syncTaskPaneSelection');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    ...overrides,
  };

  const service = createRuntimeTaskPaneShortcuts<TaskRecord>(options);
  return {
    workspace,
    service,
    calls,
    composerByTask,
    selectedRepositoryTasks,
    createdPayloads,
    flushQueued: async () => {
      while (queued.length > 0) {
        const task = queued.shift();
        if (task !== undefined) {
          await task;
        }
      }
    },
  };
}

void test('runtime task pane shortcuts homeEditorBuffer returns task composer when editing a task', () => {
  const harness = createHarness();
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  harness.composerByTask.set('task-1', {
    text: 'task body',
    cursor: 4,
  });

  assert.deepEqual(harness.service.homeEditorBuffer(), {
    text: 'task body',
    cursor: 4,
  });
});

void test('runtime task pane shortcuts homeEditorBuffer falls back to empty buffer when task composer is missing', () => {
  const harness = createHarness();
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-missing',
  };
  harness.workspace.taskDraftComposer = {
    text: 'draft',
    cursor: 5,
  };

  assert.deepEqual(harness.service.homeEditorBuffer(), {
    text: '',
    cursor: 0,
  });
});

void test('runtime task pane shortcuts updateHomeEditorBuffer persists per-task composers', () => {
  const harness = createHarness();
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };

  harness.service.updateHomeEditorBuffer({
    text: 'next',
    cursor: 2,
  });

  assert.deepEqual(harness.composerByTask.get('task-1'), {
    text: 'next',
    cursor: 2,
  });
  assert.deepEqual(harness.calls, [
    'setTaskComposerForTask:task-1',
    'scheduleTaskComposerPersist:task-1',
    'markDirty',
  ]);
});

void test('runtime task pane shortcuts updateHomeEditorBuffer normalizes draft buffers', () => {
  const harness = createHarness();
  harness.workspace.taskEditorTarget = { kind: 'draft' };

  harness.service.updateHomeEditorBuffer({
    text: 'draft',
    cursor: 99,
  });

  assert.deepEqual(harness.workspace.taskDraftComposer, {
    text: 'draft',
    cursor: 5,
  });
  assert.deepEqual(harness.calls, ['markDirty']);
});

void test('runtime task pane shortcuts selectRepositoryByDirection no-ops when there are no repositories', () => {
  const harness = createHarness({
    activeRepositoryIds: () => [],
  });

  harness.service.selectRepositoryByDirection(1);
  assert.deepEqual(harness.calls, []);
});

void test('runtime task pane shortcuts selectRepositoryByDirection clamps index and selects visible repository', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';

  harness.service.selectRepositoryByDirection(1);
  harness.service.selectRepositoryByDirection(1);

  assert.deepEqual(harness.calls, ['selectRepositoryById:repo-2', 'selectRepositoryById:repo-2']);
});

void test('runtime task pane shortcuts selectRepositoryByDirection skips undefined ids', () => {
  const harness = createHarness({
    activeRepositoryIds: () => [undefined as unknown as string],
  });

  harness.service.selectRepositoryByDirection(1);
  assert.deepEqual(harness.calls, []);
});

void test('runtime task pane shortcuts submitDraftTaskFromComposer requires selected repository', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = null;
  harness.workspace.taskDraftComposer = {
    text: 'Task title',
    cursor: 10,
  };

  harness.service.submitDraftTaskFromComposer('queue');

  assert.equal(harness.workspace.taskPaneNotice, 'select a repository first');
  assert.deepEqual(harness.calls, ['markDirty']);
});

void test('runtime task pane shortcuts submitDraftTaskFromComposer requires non-empty body', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';
  harness.workspace.taskDraftComposer = {
    text: '   \n   ',
    cursor: 1,
  };

  harness.service.submitDraftTaskFromComposer('queue');

  assert.equal(harness.workspace.taskPaneNotice, 'task body is required');
  assert.deepEqual(harness.calls, ['markDirty']);
});

void test('runtime task pane shortcuts submitDraftTaskFromComposer queues create and resets draft on success', async () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';
  harness.workspace.taskDraftComposer = {
    text: 'Title line\nDescription line',
    cursor: 12,
  };

  harness.service.submitDraftTaskFromComposer('queue');
  await harness.flushQueued();

  assert.deepEqual(harness.createdPayloads, [
    {
      repositoryId: 'repo-1',
      title: 'Title line',
      body: 'Title line\nDescription line',
    },
  ]);
  assert.deepEqual(harness.workspace.taskDraftComposer, {
    text: '',
    cursor: 0,
  });
  assert.equal(harness.workspace.taskPaneNotice, null);
  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:task-composer-queue',
    'applyTaskRecord:task-1',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane shortcuts submitDraftTaskFromComposer ready mode sets task ready before apply', async () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';
  harness.workspace.taskDraftComposer = {
    text: 'Ready me',
    cursor: 7,
  };

  harness.service.submitDraftTaskFromComposer('ready');
  await harness.flushQueued();

  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:task-composer-submit-ready',
    'taskReady:task-1',
    'applyTaskRecord:task-1',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane shortcuts moveTaskEditorFocusUp focuses last task from draft target', () => {
  const harness = createHarness();
  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.workspace.latestTaskPaneView = {
    rows: ['row-a', 'row-b'],
    taskIds: ['task-2', 'task-1'],
    repositoryIds: ['repo-1', 'repo-1'],
    actions: [null, null],
    actionCells: [null, null],
    top: 0,
    selectedRepositoryId: 'repo-1',
  };
  harness.selectedRepositoryTasks.push(
    {
      taskId: 'task-1',
      repositoryId: 'repo-1',
      title: 'Task 1',
      body: '',
    },
    {
      taskId: 'task-2',
      repositoryId: 'repo-1',
      title: 'Task 2',
      body: '',
    },
  );

  harness.service.moveTaskEditorFocusUp();
  assert.deepEqual(harness.calls, ['focusTaskComposer:task-1']);
});

void test('runtime task pane shortcuts moveTaskEditorFocusUp falls back to selected repository tasks when view ids are empty', () => {
  const harness = createHarness();
  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.selectedRepositoryTasks.push(
    {
      taskId: 'task-1',
      repositoryId: 'repo-1',
      title: 'Task 1',
      body: '',
    },
    {
      taskId: 'task-2',
      repositoryId: 'repo-1',
      title: 'Task 2',
      body: '',
    },
  );

  harness.service.moveTaskEditorFocusUp();
  assert.deepEqual(harness.calls, ['focusTaskComposer:task-2']);
});

void test('runtime task pane shortcuts moveTaskEditorFocusUp handles top and middle task positions', () => {
  const harness = createHarness();
  harness.workspace.latestTaskPaneView = {
    rows: ['row-a', 'row-b', 'row-c'],
    taskIds: ['task-2', 'task-2', 'task-1'],
    repositoryIds: ['repo-1', 'repo-1', 'repo-1'],
    actions: [null, null, null],
    actionCells: [null, null, null],
    top: 0,
    selectedRepositoryId: 'repo-1',
  };
  harness.selectedRepositoryTasks.push(
    {
      taskId: 'task-1',
      repositoryId: 'repo-1',
      title: 'Task 1',
      body: '',
    },
    {
      taskId: 'task-2',
      repositoryId: 'repo-1',
      title: 'Task 2',
      body: '',
    },
  );

  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-2',
  };
  harness.service.moveTaskEditorFocusUp();
  assert.deepEqual(harness.calls, []);

  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  harness.service.moveTaskEditorFocusUp();
  assert.deepEqual(harness.calls, ['focusTaskComposer:task-2']);
});

void test('runtime task pane shortcuts moveTaskEditorFocusDown follows view order and falls back to draft', () => {
  const harness = createHarness();
  harness.workspace.latestTaskPaneView = {
    rows: ['row-a', 'row-b', 'row-c'],
    taskIds: ['task-2', 'task-1', null],
    repositoryIds: ['repo-1', 'repo-1', null],
    actions: [null, null, null],
    actionCells: [null, null, null],
    top: 0,
    selectedRepositoryId: 'repo-1',
  };
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-2',
  };
  harness.service.moveTaskEditorFocusDown();
  assert.deepEqual(harness.calls, ['focusTaskComposer:task-1']);

  harness.calls.length = 0;
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  harness.service.moveTaskEditorFocusDown();
  assert.deepEqual(harness.calls, ['focusDraftComposer']);
});

void test('runtime task pane shortcuts moveTaskEditorFocusDown ignores draft target and falls back when focused task is missing', () => {
  const draftHarness = createHarness();
  draftHarness.workspace.taskEditorTarget = { kind: 'draft' };
  draftHarness.service.moveTaskEditorFocusDown();
  assert.deepEqual(draftHarness.calls, []);

  const missingTaskHarness = createHarness();
  missingTaskHarness.workspace.latestTaskPaneView = {
    rows: ['row-a'],
    taskIds: ['task-1'],
    repositoryIds: ['repo-1'],
    actions: [null],
    actionCells: [null],
    top: 0,
    selectedRepositoryId: 'repo-1',
  };
  missingTaskHarness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-missing',
  };
  missingTaskHarness.service.moveTaskEditorFocusDown();
  assert.deepEqual(missingTaskHarness.calls, ['focusDraftComposer']);
});

void test('runtime task pane shortcuts handleInput ignores non-home and hidden task pane states', () => {
  const nonHome = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.status.ready': ['r'],
    }),
  });
  nonHome.workspace.mainPaneMode = 'conversation';
  const handledNonHome = nonHome.service.handleInput(Buffer.from('r', 'utf8'));
  assert.equal(handledNonHome, false);

  const hidden = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.status.ready': ['r'],
    }),
  });
  hidden.workspace.mainPaneMode = 'home';
  hidden.workspace.leftNavSelection = { kind: 'home' };
  const handledHidden = hidden.service.handleInput(Buffer.from('r', 'utf8'));
  assert.equal(handledHidden, false);
});

void test('runtime task pane shortcuts handleInput routes keybinding actions', () => {
  const harness = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.status.ready': ['r'],
      'mux.home.repo.dropdown.toggle': ['g'],
      'mux.home.repo.next': ['n'],
    }),
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };

  const readyHandled = harness.service.handleInput(Buffer.from('r', 'utf8'));
  const toggleHandled = harness.service.handleInput(Buffer.from('g', 'utf8'));
  const nextHandled = harness.service.handleInput(Buffer.from('n', 'utf8'));

  assert.equal(readyHandled, true);
  assert.equal(toggleHandled, true);
  assert.equal(nextHandled, true);
  assert.equal(harness.workspace.taskRepositoryDropdownOpen, true);
  assert.equal(harness.calls.includes('runTaskPaneAction:task.ready'), true);
  assert.equal(harness.calls.includes('selectRepositoryById:repo-2'), true);
  assert.equal(harness.calls.includes('markDirty'), true);
});

void test('runtime task pane shortcuts handleInput inserts printable and bracketed-paste text', () => {
  const harness = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.status.ready': ['r'],
    }),
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };
  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.workspace.taskDraftComposer = {
    text: 'seed ',
    cursor: 5,
  };

  const printableHandled = harness.service.handleInput(Buffer.from('abc', 'utf8'));
  const pasteHandled = harness.service.handleInput(
    Buffer.from('\u001b[200~line 1\nline 2\u001b[201~', 'utf8'),
  );

  assert.equal(printableHandled, true);
  assert.equal(pasteHandled, true);
  assert.equal(harness.workspace.taskDraftComposer.text, 'seed abcline 1\nline 2');
});

void test('runtime task pane shortcuts handleInput covers extended editor and task action shortcuts', () => {
  const harness = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.repo.previous': ['p'],
      'mux.home.task.status.draft': ['d'],
      'mux.home.task.status.complete': ['c'],
      'mux.home.task.reorder.up': ['u'],
      'mux.home.task.reorder.down': ['j'],
      'mux.home.task.newline': ['n'],
      'mux.home.editor.cursor.left': ['h'],
      'mux.home.editor.cursor.right': ['l'],
      'mux.home.editor.line.start': ['g'],
      'mux.home.editor.line.end': ['G'],
      'mux.home.editor.word.left': ['b'],
      'mux.home.editor.word.right': ['w'],
      'mux.home.editor.delete.backward': ['x'],
      'mux.home.editor.delete.forward': ['f'],
      'mux.home.editor.delete.word.backward': ['B'],
      'mux.home.editor.delete.line.start': ['S'],
      'mux.home.editor.delete.line.end': ['E'],
    }),
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };
  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.workspace.taskDraftComposer = {
    text: 'alpha beta\ngamma',
    cursor: 6,
  };
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-2';

  const keys = [
    'p',
    'd',
    'c',
    'u',
    'j',
    'n',
    'h',
    'l',
    'g',
    'G',
    'b',
    'w',
    'x',
    'f',
    'B',
    'S',
    'E',
  ];
  for (const key of keys) {
    const handled = harness.service.handleInput(Buffer.from(key, 'utf8'));
    assert.equal(handled, true);
  }

  assert.equal(harness.calls.includes('runTaskPaneAction:task.draft'), true);
  assert.equal(harness.calls.includes('runTaskPaneAction:task.complete'), true);
  assert.equal(harness.calls.includes('runTaskPaneAction:task.reorder-up'), true);
  assert.equal(harness.calls.includes('runTaskPaneAction:task.reorder-down'), true);
  assert.equal(harness.calls.includes('selectRepositoryById:repo-1'), true);
});

void test('runtime task pane shortcuts handleInput covers queue/submit and cursor up/down task branches', async () => {
  const harness = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.queue': ['q'],
      'mux.home.task.submit': ['s'],
      'mux.home.editor.cursor.up': ['k'],
      'mux.home.editor.cursor.down': ['m'],
    }),
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';
  harness.workspace.latestTaskPaneView = {
    rows: ['row-a', 'row-b'],
    taskIds: ['task-1', 'task-2'],
    repositoryIds: ['repo-1', 'repo-1'],
    actions: [null, null],
    actionCells: [null, null],
    top: 0,
    selectedRepositoryId: 'repo-1',
  };
  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.workspace.taskDraftComposer = {
    text: 'Title\nBody',
    cursor: 10,
  };

  assert.equal(harness.service.handleInput(Buffer.from('s', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('q', 'utf8')), true);

  harness.workspace.taskEditorTarget = { kind: 'task', taskId: 'task-2' };
  harness.composerByTask.set('task-2', { text: 'two', cursor: 0 });
  assert.equal(harness.service.handleInput(Buffer.from('k', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('s', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('q', 'utf8')), true);

  harness.workspace.taskEditorTarget = { kind: 'task', taskId: 'task-1' };
  harness.composerByTask.set('task-1', { text: 'one', cursor: 0 });
  assert.equal(harness.service.handleInput(Buffer.from('m', 'utf8')), true);

  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.workspace.taskDraftComposer = {
    text: 'line 1\nline 2',
    cursor: 0,
  };
  assert.equal(harness.service.handleInput(Buffer.from('m', 'utf8')), true);

  await harness.flushQueued();
  assert.equal(harness.calls.includes('focusTaskComposer:task-1'), true);
  assert.equal(harness.calls.includes('focusTaskComposer:task-2'), true);
  assert.equal(harness.calls.includes('focusDraftComposer'), true);
});

void test('runtime task pane shortcuts handleInput returns false for non-printable input with no inserted text', () => {
  const harness = createHarness();
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };
  harness.workspace.taskEditorTarget = { kind: 'draft' };

  const handled = harness.service.handleInput(Buffer.from([0x00]));
  assert.equal(handled, false);
});

void test('runtime task pane shortcuts handleInput covers remaining task-target queue/submit and editor branches', () => {
  const harness = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.queue': ['q'],
      'mux.home.task.submit': ['s'],
      'mux.home.editor.cursor.up': ['u'],
      'mux.home.editor.cursor.down': ['d'],
      'mux.home.editor.line.end': ['e'],
      'mux.home.editor.delete.word.backward': ['w'],
      'mux.home.editor.delete.line.start': ['l'],
      'mux.home.editor.delete.line.end': ['k'],
    }),
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  harness.composerByTask.set('task-1', {
    text: 'line 1\nline 2',
    cursor: 7,
  });

  assert.equal(harness.service.handleInput(Buffer.from('q', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('s', 'utf8')), true);

  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  assert.equal(harness.service.handleInput(Buffer.from('u', 'utf8')), true);

  harness.composerByTask.set('task-1', {
    text: 'line 1\nline 2',
    cursor: 1,
  });
  assert.equal(harness.service.handleInput(Buffer.from('d', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('e', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('w', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('l', 'utf8')), true);
  assert.equal(harness.service.handleInput(Buffer.from('k', 'utf8')), true);

  assert.equal(harness.calls.includes('focusDraftComposer'), true);
  assert.equal(harness.calls.includes('setTaskComposerForTask:task-1'), true);
});

void test('runtime task pane shortcuts handleInput ignores unsupported escape sequences', () => {
  const harness = createHarness({
    taskScreenKeybindings: resolveTaskScreenKeybindings({
      'mux.home.task.status.ready': ['r'],
    }),
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.leftNavSelection = { kind: 'tasks' };
  harness.workspace.taskEditorTarget = { kind: 'draft' };
  harness.workspace.taskDraftComposer = {
    text: 'seed',
    cursor: 4,
  };

  const handled = harness.service.handleInput(Buffer.from('\u001b[999~', 'utf8'));
  assert.equal(handled, false);
  assert.deepEqual(harness.workspace.taskDraftComposer, {
    text: 'seed',
    cursor: 4,
  });
});
