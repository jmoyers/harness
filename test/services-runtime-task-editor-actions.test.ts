import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import {
  RuntimeTaskEditorActions,
  type RuntimeTaskEditorSubmitPayload,
} from '../src/services/runtime-task-editor-actions.ts';

interface TaskRecord {
  readonly taskId: string;
}

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

function createHarness(
  overrides: {
    readonly createTask?: (input: {
      repositoryId: string;
      title: string;
      body: string;
    }) => Promise<TaskRecord>;
    readonly updateTask?: (input: {
      taskId: string;
      repositoryId: string;
      title: string;
      body: string;
    }) => Promise<TaskRecord>;
  } = {},
) {
  const workspace = createWorkspace();
  const calls: string[] = [];
  const queuedOps: Array<() => Promise<void>> = [];

  const service = new RuntimeTaskEditorActions<TaskRecord>({
    workspace,
    controlPlaneService: {
      createTask:
        overrides.createTask ??
        (async (input) => {
          calls.push(`createTask:${input.repositoryId}:${input.title}`);
          return {
            taskId: 'task-created',
          };
        }),
      updateTask:
        overrides.updateTask ??
        (async (input) => {
          calls.push(`updateTask:${input.taskId}:${input.repositoryId}`);
          return {
            taskId: input.taskId,
          };
        }),
    },
    applyTaskRecord: (task) => {
      calls.push(`applyTaskRecord:${task.taskId}`);
    },
    queueControlPlaneOp: (task, label) => {
      calls.push(`queue:${label}`);
      queuedOps.push(task);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  const submit = (payload: RuntimeTaskEditorSubmitPayload): void => {
    service.submitTaskEditorPayload(payload);
  };

  return {
    workspace,
    calls,
    submit,
    flushQueued: async () => {
      while (queuedOps.length > 0) {
        const queued = queuedOps.shift();
        if (queued !== undefined) {
          await queued();
        }
      }
    },
  };
}

void test('runtime task editor actions submit create payload applies task and clears prompt state', async () => {
  const harness = createHarness();
  harness.workspace.taskEditorPrompt = {
    mode: 'create',
    taskId: null,
    repositoryIds: ['repo-1'],
    repositoryIndex: 0,
    fieldIndex: 0,
    title: 'before',
    body: 'before',
    error: null,
  };

  harness.submit({
    mode: 'create',
    taskId: null,
    repositoryId: 'repo-1',
    title: 'task title',
    body: 'task body',
    commandLabel: 'tasks-create',
  });
  await harness.flushQueued();

  assert.equal(harness.workspace.taskEditorPrompt, null);
  assert.equal(harness.workspace.taskPaneNotice, null);
  assert.deepEqual(harness.calls, [
    'queue:tasks-create',
    'createTask:repo-1:task title',
    'applyTaskRecord:task-created',
    'markDirty',
  ]);
});

void test('runtime task editor actions submit edit payload requires task id and sets prompt error', async () => {
  const harness = createHarness();
  harness.workspace.taskEditorPrompt = {
    mode: 'edit',
    taskId: null,
    repositoryIds: ['repo-1'],
    repositoryIndex: 0,
    fieldIndex: 0,
    title: 'before',
    body: 'before',
    error: null,
  };

  harness.submit({
    mode: 'edit',
    taskId: null,
    repositoryId: 'repo-1',
    title: 'task title',
    body: 'task body',
    commandLabel: 'tasks-update',
  });
  await harness.flushQueued();

  assert.equal(harness.workspace.taskEditorPrompt?.error, 'task edit state missing task id');
  assert.deepEqual(harness.calls, ['queue:tasks-update', 'markDirty']);
});

void test('runtime task editor actions submit edit payload updates task and falls back to pane notice on errors', async () => {
  const harness = createHarness({
    updateTask: async () => {
      throw new Error('update failed');
    },
  });
  harness.workspace.taskEditorPrompt = null;

  harness.submit({
    mode: 'edit',
    taskId: 'task-9',
    repositoryId: 'repo-1',
    title: 'task title',
    body: 'task body',
    commandLabel: 'tasks-update',
  });
  await harness.flushQueued();

  assert.equal(harness.workspace.taskPaneNotice, 'update failed');
  assert.deepEqual(harness.calls, ['queue:tasks-update', 'markDirty']);
});
