import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type {
  ControlPlaneConversationRecord,
  ControlPlaneDirectoryRecord,
  ControlPlaneTaskRecord,
} from '../src/core/contracts/records.ts';
import {
  applyObservedEventToHarnessSyncedStore,
  createHarnessSyncedStore,
} from '../src/core/store/harness-synced-store.ts';
import {
  createWebConversationListSelector,
  createWebTaskListSelector,
  selectWebConversationById,
  selectWebDirectoryList,
  subscribeStoreSelector,
} from '../src/clients/web/synced-selectors.ts';

function directoryRecord(directoryId: string): ControlPlaneDirectoryRecord {
  return {
    directoryId,
    tenantId: 'tenant',
    userId: 'user',
    workspaceId: 'workspace',
    path: `/tmp/${directoryId}`,
    createdAt: null,
    archivedAt: null,
  };
}

function conversationRecord(conversationId: string): ControlPlaneConversationRecord {
  return {
    conversationId,
    directoryId: 'directory-a',
    tenantId: 'tenant',
    userId: 'user',
    workspaceId: 'workspace',
    title: conversationId,
    agentType: 'codex',
    adapterState: {},
    runtimeStatus: 'running',
    runtimeStatusModel: {
      runtimeStatus: 'running',
      phase: 'working',
      glyph: '◔',
      badge: 'RUN ',
      detailText: 'active',
      attentionReason: null,
      lastKnownWork: null,
      lastKnownWorkAt: null,
      activityHint: 'working',
      observedAt: '2026-02-22T00:00:00.000Z',
    },
    runtimeLive: true,
  };
}

function taskRecord(taskId: string, orderIndex: number): ControlPlaneTaskRecord {
  return {
    taskId,
    tenantId: 'tenant',
    userId: 'user',
    workspaceId: 'workspace',
    repositoryId: null,
    scopeKind: 'global',
    projectId: null,
    title: taskId,
    body: 'task body',
    status: 'ready',
    orderIndex,
    claimedByControllerId: null,
    claimedByDirectoryId: null,
    branchName: null,
    baseBranch: null,
    claimedAt: null,
    completedAt: null,
    createdAt: '2026-02-22T00:00:00.000Z',
    updatedAt: '2026-02-22T00:00:00.000Z',
  };
}

void test('web conversation selector is memoized per conversations-by-id identity', () => {
  const store = createHarnessSyncedStore({
    synced: {
      directoriesById: {},
      conversationsById: {
        'session-b': conversationRecord('session-b'),
      },
      repositoriesById: {},
      tasksById: {},
    },
  });
  const selector = createWebConversationListSelector();

  const first = selector(store.getState());
  const second = selector(store.getState());
  assert.equal(first === second, true);
  assert.equal(first[0]?.conversationId, 'session-b');

  store.setState({
    ...store.getState(),
    synced: {
      ...store.getState().synced,
      conversationsById: {
        ...store.getState().synced.conversationsById,
        'session-a': conversationRecord('session-a'),
      },
    },
  });

  const third = selector(store.getState());
  assert.equal(third === second, false);
  assert.deepEqual(
    third.map((entry) => entry.conversationId),
    ['session-a', 'session-b'],
  );
});

void test('web task selector sorts by order index then task id', () => {
  const selector = createWebTaskListSelector();
  const store = createHarnessSyncedStore({
    synced: {
      directoriesById: {},
      conversationsById: {},
      repositoriesById: {},
      tasksById: {
        'task-b': taskRecord('task-b', 1),
        'task-a': taskRecord('task-a', 1),
        'task-c': taskRecord('task-c', 0),
      },
    },
  });

  const tasks = selector(store.getState());
  assert.deepEqual(
    tasks.map((task) => task.taskId),
    ['task-c', 'task-a', 'task-b'],
  );
});

void test('web directory and by-id selectors read synced state consistently', () => {
  const store = createHarnessSyncedStore({
    synced: {
      directoriesById: {
        'directory-b': directoryRecord('directory-b'),
        'directory-a': directoryRecord('directory-a'),
      },
      conversationsById: {
        'session-a': conversationRecord('session-a'),
      },
      repositoriesById: {},
      tasksById: {},
    },
  });

  const directories = selectWebDirectoryList(store.getState());
  assert.deepEqual(
    directories.map((entry) => entry.directoryId),
    ['directory-a', 'directory-b'],
  );
  assert.equal(selectWebConversationById(store.getState(), 'session-a')?.conversationId, 'session-a');
  assert.equal(selectWebConversationById(store.getState(), 'session-missing'), null);
});

void test('web selector subscription only emits when selected result changes', () => {
  const store = createHarnessSyncedStore();
  const selector = createWebConversationListSelector();
  const changes: Array<{ nextSize: number; previousSize: number }> = [];
  const unsubscribe = subscribeStoreSelector(
    store,
    selector,
    (next, previous) => {
      changes.push({
        nextSize: next.length,
        previousSize: previous.length,
      });
    },
  );

  applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-1',
    cursor: 1,
    event: {
      type: 'directory-upserted',
      directory: directoryRecord('directory-a') as unknown as Record<string, unknown>,
    },
  });

  applyObservedEventToHarnessSyncedStore(store, {
    subscriptionId: 'sub-1',
    cursor: 2,
    event: {
      type: 'conversation-created',
      conversation: conversationRecord('session-a') as unknown as Record<string, unknown>,
    },
  });

  unsubscribe();
  assert.deepEqual(changes, [
    {
      previousSize: 0,
      nextSize: 1,
    },
  ]);
});
