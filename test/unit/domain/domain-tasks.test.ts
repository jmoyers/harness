import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TaskManager } from '../../../src/domain/tasks.ts';

interface TestTaskRecord {
  readonly taskId: string;
  readonly title: string;
  readonly status: 'draft' | 'ready' | 'completed';
  readonly repositoryId: string | null;
  readonly order: number;
}

interface TestComposerBuffer {
  readonly text: string;
  readonly cursor: number;
}

interface TestAutosaveTimer {
  readonly id: string;
}

void test('task manager owns task-map lifecycle helpers', () => {
  const manager = new TaskManager<TestTaskRecord, TestComposerBuffer, TestAutosaveTimer>();
  const map = manager.readonlyTasks();
  const composers = manager.readonlyTaskComposers();

  assert.equal(manager.hasTask('task-a'), false);
  assert.equal(manager.getTask('task-a'), undefined);
  assert.equal(map.size, 0);

  manager.setTask({
    taskId: 'task-a',
    title: 'Task A',
    status: 'draft',
    repositoryId: 'repo-a',
    order: 1,
  });
  manager.setTask({
    taskId: 'task-b',
    title: 'Task B',
    status: 'ready',
    repositoryId: 'repo-b',
    order: 2,
  });

  assert.equal(manager.hasTask('task-a'), true);
  assert.equal(manager.getTask('task-a')?.title, 'Task A');
  assert.deepEqual(
    [...manager.values()].map((task) => task.taskId),
    ['task-a', 'task-b'],
  );

  manager.setTask({
    taskId: 'task-a',
    title: 'Task A edited',
    status: 'completed',
    repositoryId: 'repo-a',
    order: 1,
  });
  assert.equal(manager.getTask('task-a')?.title, 'Task A edited');
  assert.equal(manager.getTask('task-a')?.status, 'completed');

  assert.equal(manager.getTaskComposer('task-a'), undefined);
  manager.setTaskComposer('task-a', {
    text: 'Task A edited',
    cursor: 1,
  });
  assert.equal(manager.getTaskComposer('task-a')?.text, 'Task A edited');
  assert.equal(manager.deleteTaskComposer('task-a'), true);
  assert.equal(manager.deleteTaskComposer('task-a'), false);

  assert.equal(manager.getTaskAutosaveTimer('task-a'), undefined);
  manager.setTaskAutosaveTimer('task-a', { id: 'timer-a' });
  assert.equal(manager.getTaskAutosaveTimer('task-a')?.id, 'timer-a');
  assert.deepEqual([...manager.autosaveTaskIds()], ['task-a']);
  assert.equal(manager.deleteTaskAutosaveTimer('task-a'), true);
  assert.equal(manager.deleteTaskAutosaveTimer('task-a'), false);

  assert.equal(manager.deleteTask('task-a'), true);
  assert.equal(manager.deleteTask('task-missing'), false);
  assert.equal(manager.hasTask('task-a'), false);

  manager.clearTasks();
  manager.clearTaskComposers();
  manager.clearTaskAutosaveTimers();
  assert.equal(map.size, 0);
  assert.equal(composers.size, 0);
  assert.deepEqual([...manager.autosaveTaskIds()], []);
  assert.deepEqual([...manager.values()], []);
});

void test('task manager owns ordering, repository filtering, and reorder payload semantics', () => {
  const manager = new TaskManager<TestTaskRecord, TestComposerBuffer, TestAutosaveTimer>();
  const sortByOrder = (tasks: readonly TestTaskRecord[]): readonly TestTaskRecord[] =>
    [...tasks].sort((left, right) => left.order - right.order);

  manager.setTask({
    taskId: 'task-1',
    title: 'One',
    status: 'ready',
    repositoryId: 'repo-a',
    order: 2,
  });
  manager.setTask({
    taskId: 'task-2',
    title: 'Two',
    status: 'draft',
    repositoryId: 'repo-a',
    order: 1,
  });
  manager.setTask({
    taskId: 'task-3',
    title: 'Three',
    status: 'completed',
    repositoryId: 'repo-a',
    order: 3,
  });
  manager.setTask({
    taskId: 'task-4',
    title: 'Four',
    status: 'ready',
    repositoryId: 'repo-b',
    order: 4,
  });

  assert.deepEqual(
    manager.orderedTasks(sortByOrder).map((task) => task.taskId),
    ['task-2', 'task-1', 'task-3', 'task-4'],
  );
  assert.deepEqual(
    manager
      .tasksForRepository({
        repositoryId: 'repo-a',
        sortTasks: sortByOrder,
        taskRepositoryId: (task) => task.repositoryId,
      })
      .map((task) => task.taskId),
    ['task-2', 'task-1', 'task-3'],
  );
  assert.deepEqual(
    manager.tasksForRepository({
      repositoryId: null,
      sortTasks: sortByOrder,
      taskRepositoryId: (task) => task.repositoryId,
    }),
    [],
  );

  assert.deepEqual(
    manager.taskReorderPayloadIds({
      orderedActiveTaskIds: ['task-1', 'task-2', 'task-4'],
      sortTasks: sortByOrder,
      isCompleted: (task) => task.status === 'completed',
    }),
    ['task-1', 'task-2', 'task-4', 'task-3'],
  );

  assert.equal(
    manager.reorderedActiveTaskIdsForDrop({
      draggedTaskId: 'task-3',
      targetTaskId: 'task-2',
      sortTasks: sortByOrder,
      isCompleted: (task) => task.status === 'completed',
    }),
    'cannot-reorder-completed',
  );
  assert.deepEqual(
    manager.reorderedActiveTaskIdsForDrop({
      draggedTaskId: 'task-1',
      targetTaskId: 'task-2',
      sortTasks: sortByOrder,
      isCompleted: (task) => task.status === 'completed',
    }),
    ['task-1', 'task-2', 'task-4'],
  );
  assert.equal(
    manager.reorderedActiveTaskIdsForDrop({
      draggedTaskId: 'task-1',
      targetTaskId: 'task-1',
      sortTasks: sortByOrder,
      isCompleted: (task) => task.status === 'completed',
    }),
    null,
  );
  assert.equal(
    manager.reorderedActiveTaskIdsForDrop({
      draggedTaskId: 'task-1',
      targetTaskId: 'task-missing',
      sortTasks: sortByOrder,
      isCompleted: (task) => task.status === 'completed',
    }),
    null,
  );
});
