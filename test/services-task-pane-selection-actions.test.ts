import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { TaskPaneSelectionActions } from '../src/services/task-pane-selection-actions.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
}

interface RepositoryRecord {
  readonly archivedAt: string | null;
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

function createActions(
  workspace: WorkspaceModel,
  options?: {
    readonly tasks?: ReadonlyMap<string, TaskRecord>;
    readonly repositories?: ReadonlyMap<string, RepositoryRecord>;
    readonly selectedRepositoryTasks?: readonly TaskRecord[];
    readonly activeRepositoryIds?: readonly string[];
    readonly onFlush?: (taskId: string) => void;
    readonly onMarkDirty?: () => void;
  },
): TaskPaneSelectionActions<TaskRecord> {
  const tasks = options?.tasks ?? new Map<string, TaskRecord>();
  const repositories = options?.repositories ?? new Map<string, RepositoryRecord>();
  return new TaskPaneSelectionActions<TaskRecord>({
    workspace,
    taskRecordById: (taskId) => tasks.get(taskId),
    hasTask: (taskId) => tasks.has(taskId),
    hasRepository: (repositoryId) => repositories.has(repositoryId),
    repositoryById: (repositoryId) => repositories.get(repositoryId),
    selectedRepositoryTasks: () => options?.selectedRepositoryTasks ?? [...tasks.values()],
    activeRepositoryIds: () => options?.activeRepositoryIds ?? [...repositories.keys()],
    flushTaskComposerPersist: (taskId) => {
      options?.onFlush?.(taskId);
    },
    markDirty: () => {
      options?.onMarkDirty?.();
    },
  });
}

void test('task pane selection actions focusDraftComposer flushes task target and marks dirty', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-1',
  };

  const actions = createActions(workspace, {
    onFlush: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    onMarkDirty: () => {
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

  const actions = createActions(workspace, {
    tasks: new Map<string, TaskRecord>([
      ['task-1', { taskId: 'task-1', repositoryId: null }],
      ['task-2', { taskId: 'task-2', repositoryId: null }],
    ]),
    onFlush: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    onMarkDirty: () => {
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

void test('task pane selection actions syncTaskPaneSelectionFocus keeps valid focus and chooses fallback focus', () => {
  const workspace = createWorkspace();
  const tasks = new Map<string, TaskRecord>([['task-1', { taskId: 'task-1', repositoryId: null }]]);
  const repositories = new Map<string, RepositoryRecord>([['repo-1', { archivedAt: null }]]);
  const actions = createActions(workspace, {
    tasks,
    repositories,
  });

  workspace.taskPaneSelectionFocus = 'task';
  workspace.taskPaneSelectedTaskId = 'task-1';
  actions.syncTaskPaneSelectionFocus();
  assert.equal(workspace.taskPaneSelectionFocus, 'task');

  workspace.taskPaneSelectionFocus = 'repository';
  workspace.taskPaneSelectedTaskId = null;
  workspace.taskPaneSelectedRepositoryId = 'repo-1';
  actions.syncTaskPaneSelectionFocus();
  assert.equal(workspace.taskPaneSelectionFocus, 'repository');

  workspace.taskPaneSelectionFocus = 'repository';
  workspace.taskPaneSelectedRepositoryId = null;
  workspace.taskPaneSelectedTaskId = 'task-1';
  actions.syncTaskPaneSelectionFocus();
  assert.equal(workspace.taskPaneSelectionFocus, 'task');

  workspace.taskPaneSelectedTaskId = null;
  workspace.taskPaneSelectedRepositoryId = null;
  actions.syncTaskPaneSelectionFocus();
  assert.equal(workspace.taskPaneSelectionFocus, 'task');
});

void test('task pane selection actions syncTaskPaneSelection selects first scoped task and resets invalid editor target', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  workspace.taskPaneSelectedTaskId = 'task-unknown';
  workspace.taskEditorTarget = {
    kind: 'task',
    taskId: 'task-unknown',
  };

  const actions = createActions(workspace, {
    tasks: new Map<string, TaskRecord>([
      ['task-1', { taskId: 'task-1', repositoryId: 'repo-1' }],
      ['task-2', { taskId: 'task-2', repositoryId: 'repo-1' }],
    ]),
    repositories: new Map<string, RepositoryRecord>([['repo-1', { archivedAt: null }]]),
    selectedRepositoryTasks: [
      { taskId: 'task-1', repositoryId: 'repo-1' },
      { taskId: 'task-2', repositoryId: 'repo-1' },
    ],
    onFlush: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    onMarkDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.syncTaskPaneSelection();

  assert.equal(workspace.taskPaneSelectedTaskId, 'task-1');
  assert.deepEqual(workspace.taskEditorTarget, { kind: 'draft' });
  assert.equal(workspace.taskPaneSelectionFocus, 'task');
  assert.deepEqual(calls, ['flush:task-unknown', 'markDirty']);
});

void test('task pane selection actions syncTaskPaneRepositorySelection normalizes invalid repository and updates task selection', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  workspace.taskPaneSelectedRepositoryId = 'repo-archived';
  workspace.taskRepositoryDropdownOpen = true;

  const actions = createActions(workspace, {
    repositories: new Map<string, RepositoryRecord>([
      ['repo-archived', { archivedAt: 'now' }],
      ['repo-active', { archivedAt: null }],
    ]),
    activeRepositoryIds: ['repo-active'],
    selectedRepositoryTasks: [{ taskId: 'task-1', repositoryId: 'repo-active' }],
    tasks: new Map<string, TaskRecord>([
      ['task-1', { taskId: 'task-1', repositoryId: 'repo-active' }],
    ]),
    onMarkDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.syncTaskPaneRepositorySelection();

  assert.equal(workspace.taskPaneSelectedRepositoryId, 'repo-active');
  assert.equal(workspace.taskPaneSelectedTaskId, 'task-1');
  assert.equal(workspace.taskRepositoryDropdownOpen, false);
  assert.deepEqual(calls, []);
});

void test('task pane selection actions selectTaskById applies repository when available', () => {
  const workspace = createWorkspace();
  const calls: string[] = [];
  const actions = createActions(workspace, {
    tasks: new Map<string, TaskRecord>([['task-1', { taskId: 'task-1', repositoryId: 'repo-1' }]]),
    repositories: new Map<string, RepositoryRecord>([['repo-1', { archivedAt: null }]]),
    onMarkDirty: () => {
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
  const actions = createActions(workspace, {
    onMarkDirty: () => {
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

  const actions = createActions(workspace, {
    repositories: new Map<string, RepositoryRecord>([['repo-1', { archivedAt: null }]]),
    selectedRepositoryTasks: [{ taskId: 'task-2', repositoryId: 'repo-1' }],
    tasks: new Map<string, TaskRecord>([
      ['task-1', { taskId: 'task-1', repositoryId: 'repo-1' }],
      ['task-2', { taskId: 'task-2', repositoryId: 'repo-1' }],
    ]),
    onFlush: (taskId) => {
      calls.push(`flush:${taskId}`);
    },
    onMarkDirty: () => {
      calls.push('markDirty');
    },
  });

  actions.selectRepositoryById('repo-1');

  assert.equal(workspace.taskPaneSelectedRepositoryId, 'repo-1');
  assert.equal(workspace.taskRepositoryDropdownOpen, false);
  assert.equal(workspace.taskPaneSelectionFocus, 'repository');
  assert.equal(workspace.taskPaneSelectedTaskId, 'task-2');
  assert.deepEqual(workspace.taskEditorTarget, { kind: 'draft' });
  assert.equal(workspace.taskPaneNotice, null);
  assert.deepEqual(calls, ['flush:task-1', 'markDirty']);
});
