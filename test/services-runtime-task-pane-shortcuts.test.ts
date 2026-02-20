import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import type { TaskComposerBuffer } from '../src/mux/task-composer.ts';
import { resolveTaskScreenKeybindings } from '../src/mux/task-screen-keybindings.ts';
import { RuntimeTaskPaneShortcuts } from '../src/services/runtime-task-pane-shortcuts.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly body: string;
}

type ShortcutsOptions = ConstructorParameters<typeof RuntimeTaskPaneShortcuts<TaskRecord>>[0];

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
    shortcutsCollapsed: false,
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

  const service = new RuntimeTaskPaneShortcuts<TaskRecord>(options);
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
  const harness = createHarness({
    normalizeTaskComposerBuffer: (buffer) => ({
      text: buffer.text.trim(),
      cursor: Math.min(buffer.cursor, buffer.text.trim().length),
    }),
  });
  harness.workspace.taskEditorTarget = { kind: 'draft' };

  harness.service.updateHomeEditorBuffer({
    text: '  draft  ',
    cursor: 8,
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
    taskId: 'task-1',
  };
  harness.service.moveTaskEditorFocusUp();
  assert.deepEqual(harness.calls, []);

  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-2',
  };
  harness.service.moveTaskEditorFocusUp();
  assert.deepEqual(harness.calls, ['focusTaskComposer:task-1']);
});

void test('runtime task pane shortcuts handleInput delegates through injected shortcuts handler callbacks', async () => {
  const callbackCalls: string[] = [];
  const harness = createHarness({
    createTaskComposerBuffer: () => ({
      text: 'created',
      cursor: 7,
    }),
    taskFieldsFromComposerText: () => ({
      title: '',
      body: '',
    }),
    handleTaskPaneShortcutInput: (options) => {
      callbackCalls.push('handler');
      options.homeEditorBuffer();
      options.updateHomeEditorBuffer({
        text: 'new text',
        cursor: 8,
      });
      options.moveTaskEditorFocusUp();
      options.focusDraftComposer();
      options.submitDraftTaskFromComposer('queue');
      options.runTaskPaneAction('task.ready');
      options.selectRepositoryByDirection(1);
      options.getTaskRepositoryDropdownOpen();
      options.setTaskRepositoryDropdownOpen(true);
      options.markDirty();
      return true;
    },
  });
  harness.workspace.mainPaneMode = 'home';
  harness.workspace.taskPaneSelectedRepositoryId = null;
  harness.workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-missing',
  };

  const handled = harness.service.handleInput(Buffer.from('x'));
  await harness.flushQueued();

  assert.equal(handled, true);
  assert.equal(harness.workspace.taskRepositoryDropdownOpen, true);
  assert.deepEqual(callbackCalls, ['handler']);
  assert.deepEqual(harness.calls, [
    'setTaskComposerForTask:task-missing',
    'scheduleTaskComposerPersist:task-missing',
    'markDirty',
    'focusDraftComposer',
    'markDirty',
    'runTaskPaneAction:task.ready',
    'selectRepositoryById:repo-2',
    'markDirty',
  ]);
});
