import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TaskPlanningHydrationService } from '../src/services/task-planning-hydration.ts';

interface RepositoryRecord {
  readonly repositoryId: string;
}

interface TaskRecord {
  readonly taskId: string;
}

void test('task planning hydration service hydrates repositories/tasks and syncs in order', async () => {
  const calls: string[] = [];
  const service = new TaskPlanningHydrationService<RepositoryRecord, TaskRecord>({
    controlPlaneService: {
      listRepositories: async () => {
        calls.push('listRepositories');
        return [{ repositoryId: 'repo-1' }];
      },
      listTasks: async (limit) => {
        calls.push(`listTasks:${String(limit)}`);
        return [{ taskId: 'task-1' }];
      },
    },
    clearRepositories: () => {
      calls.push('clearRepositories');
    },
    setRepository: (repository) => {
      calls.push(`setRepository:${repository.repositoryId}`);
    },
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncRepositorySelection');
    },
    clearTasks: () => {
      calls.push('clearTasks');
    },
    setTask: (task) => {
      calls.push(`setTask:${task.taskId}`);
    },
    syncTaskPaneSelection: () => {
      calls.push('syncTaskSelection');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    taskLimit: 1000,
  });

  await service.hydrate();

  assert.deepEqual(calls, [
    'clearRepositories',
    'listRepositories',
    'setRepository:repo-1',
    'syncRepositorySelection',
    'clearTasks',
    'listTasks:1000',
    'setTask:task-1',
    'syncTaskSelection',
    'syncRepositorySelection',
    'markDirty',
  ]);
});

void test('task planning hydration service handles empty hydration payloads', async () => {
  const calls: string[] = [];
  const service = new TaskPlanningHydrationService<RepositoryRecord, TaskRecord>({
    controlPlaneService: {
      listRepositories: async () => [],
      listTasks: async () => [],
    },
    clearRepositories: () => {
      calls.push('clearRepositories');
    },
    setRepository: () => {
      calls.push('setRepository');
    },
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncRepositorySelection');
    },
    clearTasks: () => {
      calls.push('clearTasks');
    },
    setTask: () => {
      calls.push('setTask');
    },
    syncTaskPaneSelection: () => {
      calls.push('syncTaskSelection');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
    taskLimit: 5,
  });

  await service.hydrate();

  assert.deepEqual(calls, [
    'clearRepositories',
    'syncRepositorySelection',
    'clearTasks',
    'syncTaskSelection',
    'syncRepositorySelection',
    'markDirty',
  ]);
});
