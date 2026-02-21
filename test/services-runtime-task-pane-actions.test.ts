import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { RuntimeTaskPaneActions } from '../src/services/runtime-task-pane-actions.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly status: string;
}

type RuntimeTaskPaneActionsOptions = ConstructorParameters<
  typeof RuntimeTaskPaneActions<TaskRecord>
>[0];

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

function createHarness(overrides: Partial<RuntimeTaskPaneActionsOptions> = {}) {
  const workspace = createWorkspace();
  const tasksById = new Map<string, TaskRecord>();
  const calls: string[] = [];
  const reorderPayloads: Array<readonly string[]> = [];
  const queuedOps: Promise<void>[] = [];

  const options: RuntimeTaskPaneActionsOptions = {
    workspace,
    controlPlaneService: {
      reorderTasks: async (orderedTaskIds) => {
        calls.push(`reorderTasks:${orderedTaskIds.join(',')}`);
        return orderedTaskIds.map((taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'ready',
        }));
      },
      deleteTask: async (taskId) => {
        calls.push(`serviceDeleteTask:${taskId}`);
      },
      taskReady: async (taskId) => ({
        taskId,
        repositoryId: 'repo-1',
        status: 'ready',
      }),
      taskDraft: async (taskId) => ({
        taskId,
        repositoryId: 'repo-1',
        status: 'draft',
      }),
      taskComplete: async (taskId) => ({
        taskId,
        repositoryId: 'repo-1',
        status: 'completed',
      }),
    },
    repositoriesHas: (repositoryId) => repositoryId === 'repo-1',
    setTask: (task) => {
      tasksById.set(task.taskId, task);
      calls.push(`setTask:${task.taskId}:${task.status}`);
    },
    getTask: (taskId) => tasksById.get(taskId),
    taskReorderPayloadIds: (orderedActiveTaskIds) => {
      reorderPayloads.push(orderedActiveTaskIds);
      return orderedActiveTaskIds;
    },
    reorderedActiveTaskIdsForDrop: () => null,
    clearTaskAutosaveTimer: (taskId) => {
      calls.push(`clearTaskAutosaveTimer:${taskId}`);
    },
    deleteTask: (taskId) => {
      tasksById.delete(taskId);
      calls.push(`deleteTask:${taskId}`);
    },
    deleteTaskComposer: (taskId) => {
      calls.push(`deleteTaskComposer:${taskId}`);
    },
    focusDraftComposer: () => {
      workspace.taskEditorTarget = {
        kind: 'draft',
      };
      calls.push('focusDraftComposer');
    },
    focusTaskComposer: (taskId) => {
      workspace.taskEditorTarget = {
        kind: 'task',
        taskId,
      };
      calls.push(`focusTaskComposer:${taskId}`);
    },
    selectedTask: () => null,
    orderedTaskRecords: () => [],
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label ?? ''}`);
      queuedOps.push(task());
    },
    syncTaskPaneSelection: () => {
      calls.push('syncTaskPaneSelection');
    },
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncTaskPaneRepositorySelection');
    },
    openRepositoryPromptForCreate: () => {
      calls.push('openRepositoryPromptForCreate');
    },
    openRepositoryPromptForEdit: (repositoryId) => {
      calls.push(`openRepositoryPromptForEdit:${repositoryId}`);
    },
    archiveRepositoryById: async (repositoryId) => {
      calls.push(`archiveRepositoryById:${repositoryId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    ...overrides,
  };
  const service = new RuntimeTaskPaneActions<TaskRecord>(options);
  return {
    workspace,
    service,
    tasksById,
    calls,
    reorderPayloads,
    flushQueued: async () => {
      while (queuedOps.length > 0) {
        const queued = queuedOps.shift();
        if (queued !== undefined) {
          await queued;
        }
      }
    },
  };
}

void test('runtime task pane actions openTaskCreatePrompt requires selected repository', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = null;

  harness.service.openTaskCreatePrompt();

  assert.equal(harness.workspace.taskPaneNotice, 'select a repository first');
  assert.deepEqual(harness.calls, ['markDirty']);
});

void test('runtime task pane actions openTaskCreatePrompt focuses draft when repository is selected', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';

  harness.service.openTaskCreatePrompt();

  assert.deepEqual(harness.workspace.taskEditorTarget, { kind: 'draft' });
  assert.equal(harness.workspace.taskPaneNotice, null);
  assert.deepEqual(harness.calls, ['focusDraftComposer', 'markDirty']);
});

void test('runtime task pane actions openTaskEditPrompt no-ops for unknown tasks', () => {
  const harness = createHarness();

  harness.service.openTaskEditPrompt('task-missing');
  assert.deepEqual(harness.calls, []);
});

void test('runtime task pane actions openTaskEditPrompt updates selection and focus for known task', () => {
  const harness = createHarness();
  harness.tasksById.set('task-1', {
    taskId: 'task-1',
    repositoryId: 'repo-1',
    status: 'ready',
  });

  harness.service.openTaskEditPrompt('task-1');

  assert.equal(harness.workspace.taskPaneSelectedRepositoryId, 'repo-1');
  assert.deepEqual(harness.workspace.taskEditorTarget, {
    kind: 'task',
    taskId: 'task-1',
  });
  assert.equal(harness.workspace.taskPaneNotice, null);
  assert.deepEqual(harness.calls, ['focusTaskComposer:task-1', 'markDirty']);
});

void test('runtime task pane actions applyTaskRecord updates selection state and task map', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-stale';
  const applied = harness.service.applyTaskRecord({
    taskId: 'task-1',
    repositoryId: 'repo-1',
    status: 'ready',
  });

  assert.equal(applied.taskId, 'task-1');
  assert.equal(harness.workspace.taskPaneSelectedTaskId, 'task-1');
  assert.equal(harness.workspace.taskPaneSelectedRepositoryId, 'repo-1');
  assert.equal(harness.workspace.taskPaneSelectionFocus, 'task');
  assert.deepEqual(harness.calls, ['setTask:task-1:ready', 'syncTaskPaneSelection', 'markDirty']);
});

void test('runtime task pane actions applyTaskList updates all tasks and marks dirty only when changed', () => {
  const empty = createHarness();
  const emptyChanged = empty.service.applyTaskList([]);
  assert.equal(emptyChanged, false);
  assert.deepEqual(empty.calls, []);

  const harness = createHarness();
  const changed = harness.service.applyTaskList([
    {
      taskId: 'task-a',
      repositoryId: 'repo-1',
      status: 'ready',
    },
    {
      taskId: 'task-b',
      repositoryId: 'repo-1',
      status: 'draft',
    },
  ]);
  assert.equal(changed, true);
  assert.deepEqual(harness.calls, [
    'setTask:task-a:ready',
    'setTask:task-b:draft',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane actions queueTaskReorderByIds queues reorder payload and applies task list', async () => {
  const harness = createHarness();

  harness.service.queueTaskReorderByIds(['task-a', 'task-b'], 'tasks-reorder-up');
  await harness.flushQueued();

  assert.deepEqual(harness.reorderPayloads, [['task-a', 'task-b']]);
  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:tasks-reorder-up',
    'reorderTasks:task-a,task-b',
    'setTask:task-a:ready',
    'setTask:task-b:ready',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane actions reorderTaskByDrop handles completed-task guard and null reorder', async () => {
  const completed = createHarness({
    reorderedActiveTaskIdsForDrop: () => 'cannot-reorder-completed',
  });
  completed.service.reorderTaskByDrop('task-a', 'task-b');
  assert.equal(completed.workspace.taskPaneNotice, 'cannot reorder completed tasks');
  assert.deepEqual(completed.calls, ['markDirty']);

  const noChange = createHarness({
    reorderedActiveTaskIdsForDrop: () => null,
  });
  noChange.service.reorderTaskByDrop('task-a', 'task-b');
  await noChange.flushQueued();
  assert.deepEqual(noChange.calls, []);
});

void test('runtime task pane actions reorderTaskByDrop queues reorder operation when drop is valid', async () => {
  const harness = createHarness({
    reorderedActiveTaskIdsForDrop: () => ['task-b', 'task-a'],
  });

  harness.service.reorderTaskByDrop('task-a', 'task-b');
  await harness.flushQueued();

  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:tasks-reorder-drag',
    'reorderTasks:task-b,task-a',
    'setTask:task-b:ready',
    'setTask:task-a:ready',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane actions runTaskPaneAction default repository edit flow checks repository existence and opens prompt', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';

  harness.service.runTaskPaneAction('repository.edit');

  assert.equal(harness.workspace.taskPaneSelectionFocus, 'repository');
  assert.equal(harness.workspace.taskPaneNotice, null);
  assert.deepEqual(harness.calls, ['openRepositoryPromptForEdit:repo-1']);
});

void test('runtime task pane actions runTaskPaneAction default task reorder flow uses ordered task records', async () => {
  const harness = createHarness({
    selectedTask: () => ({
      taskId: 'task-1',
      repositoryId: 'repo-1',
      status: 'ready',
    }),
    orderedTaskRecords: () => [
      {
        taskId: 'task-1',
        repositoryId: 'repo-1',
        status: 'ready',
      },
      {
        taskId: 'task-2',
        repositoryId: 'repo-1',
        status: 'ready',
      },
    ],
  });

  harness.service.runTaskPaneAction('task.reorder-down');
  await harness.flushQueued();

  assert.equal(harness.workspace.taskPaneSelectionFocus, 'task');
  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:tasks-reorder-down',
    'reorderTasks:task-2,task-1',
    'setTask:task-2:ready',
    'setTask:task-1:ready',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane actions repository archive requires selected repository', () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = null;

  harness.service.runTaskPaneAction('repository.archive');

  assert.equal(harness.workspace.taskPaneNotice, 'select a repository first');
  assert.deepEqual(harness.calls, ['markDirty']);
});

void test('runtime task pane actions repository archive queues archive and sync', async () => {
  const harness = createHarness();
  harness.workspace.taskPaneSelectedRepositoryId = 'repo-1';

  harness.service.runTaskPaneAction('repository.archive');
  await harness.flushQueued();

  assert.equal(harness.workspace.taskPaneSelectionFocus, 'repository');
  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:tasks-archive-repository',
    'archiveRepositoryById:repo-1',
    'syncTaskPaneRepositorySelection',
  ]);
});

void test('runtime task pane actions delete task clears task editor target and local task state', async () => {
  const harness = createHarness({
    selectedTask: () => ({
      taskId: 'task-1',
      repositoryId: 'repo-1',
      status: 'ready',
    }),
  });
  harness.workspace.taskEditorTarget = { kind: 'task', taskId: 'task-1' };

  harness.service.runTaskPaneAction('task.delete');
  await harness.flushQueued();

  assert.deepEqual(harness.workspace.taskEditorTarget, { kind: 'draft' });
  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:tasks-delete',
    'clearTaskAutosaveTimer:task-1',
    'serviceDeleteTask:task-1',
    'deleteTask:task-1',
    'deleteTaskComposer:task-1',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});

void test('runtime task pane actions status updates queue correct control-plane operations', async () => {
  const harness = createHarness({
    selectedTask: () => ({
      taskId: 'task-1',
      repositoryId: 'repo-1',
      status: 'ready',
    }),
  });

  harness.service.runTaskPaneAction('task.ready');
  harness.service.runTaskPaneAction('task.draft');
  harness.service.runTaskPaneAction('task.complete');
  await harness.flushQueued();

  assert.equal(harness.workspace.taskPaneSelectionFocus, 'task');
  assert.deepEqual(harness.calls, [
    'queueControlPlaneOp:tasks-ready',
    'queueControlPlaneOp:tasks-draft',
    'queueControlPlaneOp:tasks-complete',
    'setTask:task-1:ready',
    'syncTaskPaneSelection',
    'markDirty',
    'setTask:task-1:draft',
    'syncTaskPaneSelection',
    'markDirty',
    'setTask:task-1:completed',
    'syncTaskPaneSelection',
    'markDirty',
  ]);
});
