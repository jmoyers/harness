import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { TaskPaneSelectionActions } from '../src/services/task-pane-selection-actions.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
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
    shortcutsCollapsed: false,
  });
}

void test('task pane selection actions focusDraftComposer flushes task target and marks dirty', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };

  const actions = new TaskPaneSelectionActions<TaskRecord>({
    workspace,
    taskRecordById: () => undefined,
    hasTask: () => false,
    hasRepository: () => false,
    flushTaskComposerPersist: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('sync');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.focusDraftComposer();

  assert.deepEqual(workspace.taskEditorTarget, { kind: 'draft' });
  assert.equal(workspace.taskPaneSelectionFocus, 'task');
  assert.deepEqual(calls, ['flush:task-1', 'markDirty']);
});

void test('task pane selection actions focusTaskComposer handles missing and switching tasks', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  workspace.taskPaneNotice = 'notice';

  const actions = new TaskPaneSelectionActions<TaskRecord>({
    workspace,
    taskRecordById: () => undefined,
    hasTask: (taskId) => taskId === 'task-1' || taskId === 'task-2',
    hasRepository: () => false,
    flushTaskComposerPersist: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('sync');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.focusTaskComposer('missing');
  assert.deepEqual(calls, []);

  actions.focusTaskComposer('task-2');
  assert.deepEqual(workspace.taskEditorTarget, { kind: 'task', taskId: 'task-2' });
  assert.equal(workspace.taskPaneSelectedTaskId, 'task-2');
  assert.equal(workspace.taskPaneSelectionFocus, 'task');
  assert.equal(workspace.taskPaneNotice, null);
  assert.deepEqual(calls, ['flush:task-1', 'markDirty']);
});

void test('task pane selection actions selectTaskById applies repository when available', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  const tasks = new Map<string, TaskRecord>([
    ['task-1', { taskId: 'task-1', repositoryId: 'repo-1' }],
  ]);

  const actions = new TaskPaneSelectionActions<TaskRecord>({
    workspace,
    taskRecordById: (taskId) => tasks.get(taskId),
    hasTask: (taskId) => tasks.has(taskId),
    hasRepository: (repositoryId) => repositoryId === 'repo-1',
    flushTaskComposerPersist: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('sync');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.selectTaskById('missing');
  assert.deepEqual(calls, []);

  actions.selectTaskById('task-1');
  assert.equal(workspace.taskPaneSelectedTaskId, 'task-1');
  assert.equal(workspace.taskPaneSelectedRepositoryId, 'repo-1');
  assert.deepEqual(workspace.taskEditorTarget, { kind: 'task', taskId: 'task-1' });
  assert.equal(workspace.taskPaneSelectionFocus, 'task');
  assert.deepEqual(calls, ['markDirty']);
});

void test('task pane selection actions selectRepositoryById no-ops when repository is missing', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  const actions = new TaskPaneSelectionActions<TaskRecord>({
    workspace,
    taskRecordById: () => undefined,
    hasTask: () => false,
    hasRepository: () => false,
    flushTaskComposerPersist: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('sync');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.selectRepositoryById('repo-missing');
  assert.deepEqual(calls, []);
});

void test('task pane selection actions selectRepositoryById flushes active task and syncs state', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };
  workspace.taskPaneNotice = 'notice';
  workspace.taskRepositoryDropdownOpen = true;

  const actions = new TaskPaneSelectionActions<TaskRecord>({
    workspace,
    taskRecordById: () => undefined,
    hasTask: () => true,
    hasRepository: (repositoryId) => repositoryId === 'repo-1',
    flushTaskComposerPersist: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('sync');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.selectRepositoryById('repo-1');

  assert.equal(workspace.taskPaneSelectedRepositoryId, 'repo-1');
  assert.equal(workspace.taskRepositoryDropdownOpen, false);
  assert.equal(workspace.taskPaneSelectionFocus, 'repository');
  assert.deepEqual(workspace.taskEditorTarget, { kind: 'draft' });
  assert.equal(workspace.taskPaneNotice, null);
  assert.deepEqual(calls, ['flush:task-1', 'sync', 'markDirty']);
});
