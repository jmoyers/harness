import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel } from '../src/domain/workspace.ts';
import { resolveTaskScreenKeybindings } from '../src/mux/task-screen-keybindings.ts';
import { RuntimeTaskPane } from '../src/services/runtime-task-pane.ts';

interface TaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly status: string;
  readonly title: string;
  readonly body: string;
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

void test('runtime task pane composes task actions and shortcuts behind one surface', async () => {
  const workspace = createWorkspace();
  workspace.taskPaneSelectedRepositoryId = 'repo-1';
  workspace.taskDraftComposer = {
    text: 'Draft task\nDetails',
    cursor: 16,
  };
  const calls: string[] = [];
  const queuedOps: Promise<void>[] = [];
  const tasksById = new Map<string, TaskRecord>();
  tasksById.set('task-a', {
    taskId: 'task-a',
    repositoryId: 'repo-1',
    status: 'ready',
    title: 'Task A',
    body: '',
  });
  tasksById.set('task-b', {
    taskId: 'task-b',
    repositoryId: 'repo-1',
    status: 'ready',
    title: 'Task B',
    body: '',
  });

  const runtimeTaskPane = new RuntimeTaskPane<TaskRecord>({
    actions: {
      workspace,
      controlPlaneService: {
        reorderTasks: async (orderedTaskIds) => {
          calls.push(`reorderTasks:${orderedTaskIds.join(',')}`);
          return orderedTaskIds.map((taskId) => ({
            taskId,
            repositoryId: 'repo-1',
            status: 'ready',
            title: taskId,
            body: '',
          }));
        },
        deleteTask: async () => {},
        taskReady: async (taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'ready',
          title: taskId,
          body: '',
        }),
        taskDraft: async (taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'draft',
          title: taskId,
          body: '',
        }),
        taskComplete: async (taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'completed',
          title: taskId,
          body: '',
        }),
      },
      repositoriesHas: (repositoryId) => repositoryId === 'repo-1',
      setTask: (task) => {
        calls.push(`setTask:${task.taskId}:${task.status}`);
        tasksById.set(task.taskId, task);
      },
      getTask: (taskId) => tasksById.get(taskId),
      taskReorderPayloadIds: (orderedActiveTaskIds) => orderedActiveTaskIds,
      reorderedActiveTaskIdsForDrop: () => ['task-b', 'task-a'],
      clearTaskAutosaveTimer: () => {},
      deleteTask: (taskId) => {
        tasksById.delete(taskId);
      },
      deleteTaskComposer: () => {},
      focusDraftComposer: () => {
        calls.push('focusDraftComposer');
      },
      focusTaskComposer: (taskId) => {
        calls.push(`focusTaskComposer:${taskId}`);
      },
      selectedTask: () => tasksById.get('task-a') ?? null,
      orderedTaskRecords: () => [tasksById.get('task-a')!, tasksById.get('task-b')!],
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
      openRepositoryPromptForCreate: () => {},
      openRepositoryPromptForEdit: () => {},
      archiveRepositoryById: async () => {},
      markDirty: () => {
        calls.push('markDirty');
      },
      runTaskPaneAction: (options) => {
        calls.push('runTaskPaneActionFrame');
        options.openTaskEditPrompt('task-a');
      },
    },
    shortcuts: {
      workspace,
      taskScreenKeybindings: resolveTaskScreenKeybindings(),
      repositoriesHas: () => true,
      activeRepositoryIds: () => ['repo-1'],
      selectRepositoryById: () => {},
      taskComposerForTask: () => null,
      setTaskComposerForTask: () => {},
      scheduleTaskComposerPersist: () => {},
      selectedRepositoryTaskRecords: () => [],
      focusTaskComposer: () => {},
      focusDraftComposer: () => {},
      queueControlPlaneOp: (task, label) => {
        calls.push(`shortcutQueueControlPlaneOp:${label ?? ''}`);
        queuedOps.push(task());
      },
      createTask: async () => ({
        taskId: 'task-created',
        repositoryId: 'repo-1',
        status: 'ready',
        title: 'Created',
        body: '',
      }),
      taskReady: async (taskId) => ({
        taskId,
        repositoryId: 'repo-1',
        status: 'ready',
        title: taskId,
        body: '',
      }),
      syncTaskPaneSelection: () => {},
      markDirty: () => {},
      handleTaskPaneShortcutInput: ({ runTaskPaneAction }) => {
        calls.push('handleTaskPaneShortcutInput');
        runTaskPaneAction('task.ready');
        return true;
      },
    },
  });

  const runtimeTaskPaneWithCreate = new RuntimeTaskPane<TaskRecord>({
    actions: {
      workspace,
      controlPlaneService: {
        reorderTasks: async (orderedTaskIds) => {
          return orderedTaskIds.map((taskId) => ({
            taskId,
            repositoryId: 'repo-1',
            status: 'ready',
            title: taskId,
            body: '',
          }));
        },
        deleteTask: async () => {},
        taskReady: async (taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'ready',
          title: taskId,
          body: '',
        }),
        taskDraft: async (taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'draft',
          title: taskId,
          body: '',
        }),
        taskComplete: async (taskId) => ({
          taskId,
          repositoryId: 'repo-1',
          status: 'completed',
          title: taskId,
          body: '',
        }),
      },
      repositoriesHas: (repositoryId) => repositoryId === 'repo-1',
      setTask: (task) => {
        tasksById.set(task.taskId, task);
      },
      getTask: (taskId) => tasksById.get(taskId),
      taskReorderPayloadIds: (orderedActiveTaskIds) => orderedActiveTaskIds,
      reorderedActiveTaskIdsForDrop: () => ['task-b', 'task-a'],
      clearTaskAutosaveTimer: () => {},
      deleteTask: (taskId) => {
        tasksById.delete(taskId);
      },
      deleteTaskComposer: () => {},
      focusDraftComposer: () => {},
      focusTaskComposer: () => {},
      selectedTask: () => tasksById.get('task-a') ?? null,
      orderedTaskRecords: () => [tasksById.get('task-a')!, tasksById.get('task-b')!],
      queueControlPlaneOp: (task) => {
        queuedOps.push(task());
      },
      syncTaskPaneSelection: () => {},
      syncTaskPaneRepositorySelection: () => {},
      openRepositoryPromptForCreate: () => {},
      openRepositoryPromptForEdit: () => {},
      archiveRepositoryById: async () => {},
      markDirty: () => {},
      runTaskPaneAction: () => {},
    },
    shortcuts: {
      workspace,
      taskScreenKeybindings: resolveTaskScreenKeybindings(),
      repositoriesHas: () => true,
      activeRepositoryIds: () => ['repo-1'],
      selectRepositoryById: () => {},
      taskComposerForTask: () => null,
      setTaskComposerForTask: () => {},
      scheduleTaskComposerPersist: () => {},
      selectedRepositoryTaskRecords: () => [],
      focusTaskComposer: () => {},
      focusDraftComposer: () => {},
      queueControlPlaneOp: (task) => {
        queuedOps.push(task());
      },
      createTask: async () => ({
        taskId: 'task-created-via-shortcut',
        repositoryId: 'repo-1',
        status: 'ready',
        title: 'Created',
        body: '',
      }),
      taskReady: async () => ({
        taskId: 'task-created-via-shortcut',
        repositoryId: 'repo-1',
        status: 'ready',
        title: 'Created',
        body: '',
      }),
      syncTaskPaneSelection: () => {},
      markDirty: () => {},
      handleTaskPaneShortcutInput: (options) => {
        options.submitDraftTaskFromComposer('ready');
        options.runTaskPaneAction('task.ready');
        return true;
      },
    },
  });

  const applied = runtimeTaskPane.applyTaskRecord({
    taskId: 'task-new',
    repositoryId: 'repo-1',
    status: 'ready',
    title: 'Task New',
    body: '',
  });
  assert.equal(applied.taskId, 'task-new');

  runtimeTaskPane.runTaskPaneAction('task.edit');
  runtimeTaskPane.openTaskEditPrompt('task-a');
  runtimeTaskPane.reorderTaskByDrop('task-a', 'task-b');
  const handled = runtimeTaskPane.handleInput(Buffer.from('x', 'utf8'));
  assert.equal(handled, true);
  assert.equal(runtimeTaskPaneWithCreate.handleInput(Buffer.from('x', 'utf8')), true);

  while (queuedOps.length > 0) {
    const queued = queuedOps.shift();
    if (queued !== undefined) {
      await queued;
    }
  }

  const callSet = new Set(calls);
  assert.equal(callSet.has('syncTaskPaneSelection'), true);
  assert.equal(callSet.has('markDirty'), true);
  assert.equal(callSet.has('runTaskPaneActionFrame'), true);
  assert.equal(callSet.has('focusTaskComposer:task-a'), true);
  assert.equal(callSet.has('queueControlPlaneOp:tasks-reorder-drag'), true);
  assert.equal(callSet.has('reorderTasks:task-b,task-a'), true);
  assert.equal(callSet.has('handleTaskPaneShortcutInput'), true);
});
