import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TaskPlanningSyncedProjection } from '../src/services/task-planning-observed-events.ts';

interface RepositoryRecord {
  readonly repositoryId: string;
  readonly archivedAt: string | null;
}

interface TaskRecord {
  readonly taskId: string;
}

void test('task planning synced projection applies repository upserts', () => {
  const calls: string[] = [];
  const repositories = new Map<string, RepositoryRecord>([
    ['repo-1', { repositoryId: 'repo-1', archivedAt: null }],
  ]);
  const service = new TaskPlanningSyncedProjection<RepositoryRecord, TaskRecord>({
    setRepository: (repositoryId, repository) => {
      repositories.set(repositoryId, repository);
      calls.push(`setRepository:${repositoryId}:${repository.archivedAt ?? 'null'}`);
    },
    setTask: () => {
      calls.push('setTask');
    },
    deleteTask: () => false,
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncRepositorySelection');
    },
    syncTaskPaneSelection: () => {
      calls.push('syncTaskSelection');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  service.apply({
    changed: true,
    state: {
      repositoriesById: {
        'repo-1': {
          repositoryId: 'repo-1',
          archivedAt: '2026-01-01T00:00:00.000Z',
        },
        'repo-2': {
          repositoryId: 'repo-2',
          archivedAt: null,
        },
      },
      tasksById: {},
    },
    removedTaskIds: [],
    upsertedRepositoryIds: ['repo-2', 'repo-1', 'repo-missing'],
    upsertedTaskIds: [],
  });
  service.apply({
    changed: false,
    state: {
      repositoriesById: {},
      tasksById: {},
    },
    removedTaskIds: [],
    upsertedRepositoryIds: [],
    upsertedTaskIds: [],
  });

  assert.deepEqual(calls, [
    'setRepository:repo-2:null',
    'setRepository:repo-1:2026-01-01T00:00:00.000Z',
    'syncRepositorySelection',
    'markDirty',
  ]);
  assert.equal(repositories.get('repo-1')?.archivedAt, '2026-01-01T00:00:00.000Z');
});

void test('task planning synced projection applies task removals and upserts', () => {
  const calls: string[] = [];
  const tasks = new Map<string, TaskRecord>([['task-2', { taskId: 'task-2' }]]);
  const service = new TaskPlanningSyncedProjection<RepositoryRecord, TaskRecord>({
    setRepository: () => {},
    setTask: (task) => {
      tasks.set(task.taskId, task);
      calls.push(`setTask:${task.taskId}`);
    },
    deleteTask: (taskId) => {
      const deleted = tasks.delete(taskId);
      calls.push(`deleteTask:${taskId}:${String(deleted)}`);
      return deleted;
    },
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncRepositorySelection');
    },
    syncTaskPaneSelection: () => {
      calls.push('syncTaskSelection');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  service.apply({
    changed: true,
    state: {
      repositoriesById: {},
      tasksById: {
        'task-1': { taskId: 'task-1' },
        'task-3': { taskId: 'task-3' },
      },
    },
    removedTaskIds: ['task-missing', 'task-2'],
    upsertedRepositoryIds: [],
    upsertedTaskIds: ['task-1', 'task-3', 'task-missing'],
  });
  service.apply({
    changed: false,
    state: {
      repositoriesById: {},
      tasksById: {},
    },
    removedTaskIds: [],
    upsertedRepositoryIds: [],
    upsertedTaskIds: [],
  });

  assert.deepEqual(calls, [
    'deleteTask:task-missing:false',
    'deleteTask:task-2:true',
    'setTask:task-1',
    'setTask:task-3',
    'syncTaskSelection',
    'markDirty',
  ]);
  assert.deepEqual([...tasks.keys()].sort(), ['task-1', 'task-3']);
});
