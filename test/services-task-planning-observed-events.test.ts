import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamObservedEvent } from '../src/control-plane/stream-protocol.ts';
import { TaskPlanningObservedEvents } from '../src/services/task-planning-observed-events.ts';

interface RepositoryRecord {
  readonly repositoryId: string;
  readonly archivedAt: string | null;
}

interface TaskRecord {
  readonly taskId: string;
}

void test('task planning observed events applies repository upsert/update and archive flows', () => {
  const calls: string[] = [];
  const repositories = new Map<string, RepositoryRecord>([
    ['repo-1', { repositoryId: 'repo-1', archivedAt: null }],
  ]);
  const service = new TaskPlanningObservedEvents<RepositoryRecord, TaskRecord>({
    parseRepositoryRecord: (value) => {
      if (typeof value === 'object' && value !== null && 'repositoryId' in value) {
        const repositoryId = Reflect.get(value, 'repositoryId');
        if (typeof repositoryId === 'string') {
          return {
            repositoryId,
            archivedAt: null,
          };
        }
      }
      return null;
    },
    parseTaskRecord: () => null,
    getRepository: (repositoryId) => repositories.get(repositoryId),
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
    type: 'repository-upserted',
    repository: { repositoryId: 'repo-2' },
  } as StreamObservedEvent);
  service.apply({
    type: 'repository-updated',
    repository: { repositoryId: 'repo-3' },
  } as StreamObservedEvent);
  service.apply({
    type: 'repository-updated',
    repository: { invalid: true },
  } as StreamObservedEvent);
  service.apply({
    type: 'repository-archived',
    repositoryId: 'repo-1',
    ts: '2026-01-01T00:00:00.000Z',
  } as StreamObservedEvent);
  service.apply({
    type: 'repository-archived',
    repositoryId: 'repo-missing',
    ts: '2026-01-01T00:00:01.000Z',
  } as StreamObservedEvent);

  assert.deepEqual(calls, [
    'setRepository:repo-2:null',
    'syncRepositorySelection',
    'markDirty',
    'setRepository:repo-3:null',
    'syncRepositorySelection',
    'markDirty',
    'setRepository:repo-1:2026-01-01T00:00:00.000Z',
    'syncRepositorySelection',
    'markDirty',
  ]);
  assert.equal(repositories.get('repo-1')?.archivedAt, '2026-01-01T00:00:00.000Z');
});

void test('task planning observed events applies task create/update/delete/reorder flows', () => {
  const calls: string[] = [];
  const tasks = new Map<string, TaskRecord>();
  const service = new TaskPlanningObservedEvents<RepositoryRecord, TaskRecord>({
    parseRepositoryRecord: () => null,
    parseTaskRecord: (value) => {
      if (typeof value === 'object' && value !== null && 'taskId' in value) {
        const taskId = Reflect.get(value, 'taskId');
        if (typeof taskId === 'string') {
          return {
            taskId,
          };
        }
      }
      return null;
    },
    getRepository: () => undefined,
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
    type: 'task-created',
    task: { taskId: 'task-1' },
  } as StreamObservedEvent);
  service.apply({
    type: 'task-updated',
    task: { taskId: 'task-2' },
  } as StreamObservedEvent);
  service.apply({
    type: 'task-updated',
    task: { invalid: true },
  } as StreamObservedEvent);
  service.apply({
    type: 'task-deleted',
    taskId: 'task-missing',
  } as StreamObservedEvent);
  service.apply({
    type: 'task-deleted',
    taskId: 'task-2',
  } as StreamObservedEvent);
  service.apply({
    type: 'task-reordered',
    tasks: [{ invalid: true }],
    ts: '2026-01-01T00:00:00.000Z',
  } as StreamObservedEvent);
  service.apply({
    type: 'task-reordered',
    tasks: [{ taskId: 'task-3' }, { invalid: true }, { taskId: 'task-4' }],
    ts: '2026-01-01T00:00:01.000Z',
  } as StreamObservedEvent);
  service.apply({
    type: 'session-status',
  } as StreamObservedEvent);

  assert.deepEqual(calls, [
    'setTask:task-1',
    'syncTaskSelection',
    'markDirty',
    'setTask:task-2',
    'syncTaskSelection',
    'markDirty',
    'deleteTask:task-missing:false',
    'deleteTask:task-2:true',
    'syncTaskSelection',
    'markDirty',
    'setTask:task-3',
    'setTask:task-4',
    'syncTaskSelection',
    'markDirty',
  ]);
  assert.deepEqual([...tasks.keys()].sort(), ['task-1', 'task-3', 'task-4']);
});
