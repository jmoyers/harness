import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TaskManager } from '../src/domain/tasks.ts';

interface TestTaskRecord {
  readonly taskId: string;
  readonly title: string;
  readonly status: 'draft' | 'ready' | 'completed';
}

interface TestComposerBuffer {
  readonly text: string;
  readonly cursor: number;
}

void test('task manager owns task-map lifecycle helpers', () => {
  const manager = new TaskManager<TestTaskRecord, TestComposerBuffer>();
  const map = manager.readonlyTasks();
  const composers = manager.readonlyTaskComposers();

  assert.equal(manager.hasTask('task-a'), false);
  assert.equal(manager.getTask('task-a'), undefined);
  assert.equal(map.size, 0);

  manager.setTask({
    taskId: 'task-a',
    title: 'Task A',
    status: 'draft',
  });
  manager.setTask({
    taskId: 'task-b',
    title: 'Task B',
    status: 'ready',
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

  assert.equal(manager.deleteTask('task-a'), true);
  assert.equal(manager.deleteTask('task-missing'), false);
  assert.equal(manager.hasTask('task-a'), false);

  manager.clearTasks();
  manager.clearTaskComposers();
  assert.equal(map.size, 0);
  assert.equal(composers.size, 0);
  assert.deepEqual([...manager.values()], []);
});
