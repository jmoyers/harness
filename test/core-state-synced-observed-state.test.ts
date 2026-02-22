import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamObservedEvent } from '../src/control-plane/stream-protocol.ts';
import {
  applyObservedEventToSyncedState,
  createHarnessSyncedState,
} from '../src/core/state/synced-observed-state.ts';

function directoryRecord(directoryId: string): Record<string, unknown> {
  return {
    directoryId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    path: `/tmp/${directoryId}`,
    createdAt: '2026-02-21T00:00:00.000Z',
    archivedAt: null,
  };
}

function conversationRecord(conversationId: string, directoryId: string): Record<string, unknown> {
  return {
    conversationId,
    directoryId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    title: 'Conversation',
    agentType: 'codex',
    adapterState: {},
    runtimeStatus: 'running',
    runtimeStatusModel: null,
    runtimeLive: true,
  };
}

function repositoryRecord(repositoryId: string): Record<string, unknown> {
  return {
    repositoryId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    name: `Repo ${repositoryId}`,
    remoteUrl: `https://example.com/${repositoryId}.git`,
    defaultBranch: 'main',
    metadata: {},
    createdAt: '2026-02-21T00:00:00.000Z',
    archivedAt: null,
  };
}

function taskRecord(taskId: string, repositoryId: string): Record<string, unknown> {
  return {
    taskId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    repositoryId,
    scopeKind: 'repository',
    projectId: null,
    title: 'Task',
    body: 'Body',
    status: 'ready',
    orderIndex: 1,
    claimedByControllerId: null,
    claimedByDirectoryId: null,
    branchName: null,
    baseBranch: null,
    claimedAt: null,
    completedAt: null,
    createdAt: '2026-02-21T00:00:00.000Z',
    updatedAt: '2026-02-21T00:00:00.000Z',
  };
}

void test('synced observed state applies directory and conversation lifecycle', () => {
  let state = createHarnessSyncedState();
  const upsertDirectory = applyObservedEventToSyncedState(state, {
    type: 'directory-upserted',
    directory: directoryRecord('directory-1'),
  } as StreamObservedEvent);
  assert.equal(upsertDirectory.changed, true);
  assert.deepEqual(upsertDirectory.upsertedDirectoryIds, ['directory-1']);
  state = upsertDirectory.state;

  const upsertConversation = applyObservedEventToSyncedState(state, {
    type: 'conversation-created',
    conversation: conversationRecord('conversation-1', 'directory-1'),
  } as StreamObservedEvent);
  assert.equal(upsertConversation.changed, true);
  assert.deepEqual(upsertConversation.upsertedConversationIds, ['conversation-1']);
  state = upsertConversation.state;

  const archiveDirectory = applyObservedEventToSyncedState(state, {
    type: 'directory-archived',
    directoryId: 'directory-1',
    ts: '2026-02-21T00:01:00.000Z',
  } as StreamObservedEvent);
  assert.equal(archiveDirectory.changed, true);
  assert.deepEqual(archiveDirectory.removedDirectoryIds, ['directory-1']);
  assert.deepEqual(archiveDirectory.removedConversationIds, ['conversation-1']);
  assert.equal(archiveDirectory.state.directoriesById['directory-1'], undefined);
  assert.equal(archiveDirectory.state.conversationsById['conversation-1'], undefined);
});

void test('synced observed state applies repository/task updates and delete', () => {
  let state = createHarnessSyncedState();
  state = applyObservedEventToSyncedState(state, {
    type: 'repository-upserted',
    repository: repositoryRecord('repository-1'),
  } as StreamObservedEvent).state;

  const taskCreated = applyObservedEventToSyncedState(state, {
    type: 'task-created',
    task: taskRecord('task-1', 'repository-1'),
  } as StreamObservedEvent);
  assert.equal(taskCreated.changed, true);
  assert.deepEqual(taskCreated.upsertedTaskIds, ['task-1']);
  state = taskCreated.state;

  const taskDeleted = applyObservedEventToSyncedState(state, {
    type: 'task-deleted',
    taskId: 'task-1',
    ts: '2026-02-21T00:02:00.000Z',
  } as StreamObservedEvent);
  assert.equal(taskDeleted.changed, true);
  assert.deepEqual(taskDeleted.removedTaskIds, ['task-1']);
  assert.equal(taskDeleted.state.tasksById['task-1'], undefined);
});

void test('synced observed state applies task-reordered upserts for valid tasks only', () => {
  const state = createHarnessSyncedState();
  const reordered = applyObservedEventToSyncedState(state, {
    type: 'task-reordered',
    tasks: [
      { invalid: true },
      taskRecord('task-1', 'repository-1'),
      {
        ...taskRecord('task-2', 'repository-1'),
        orderIndex: 2,
      },
    ],
    ts: '2026-02-21T00:02:30.000Z',
  } as unknown as StreamObservedEvent);

  assert.equal(reordered.changed, true);
  assert.deepEqual(reordered.upsertedTaskIds, ['task-1', 'task-2']);
  assert.equal(reordered.state.tasksById['task-1']?.orderIndex, 1);
  assert.equal(reordered.state.tasksById['task-2']?.orderIndex, 2);
});

void test('synced observed state applies session-status to existing conversation only', () => {
  let state = createHarnessSyncedState();
  state = applyObservedEventToSyncedState(state, {
    type: 'conversation-created',
    conversation: conversationRecord('conversation-1', 'directory-1'),
  } as StreamObservedEvent).state;

  const statusApplied = applyObservedEventToSyncedState(state, {
    type: 'session-status',
    sessionId: 'conversation-1',
    status: 'needs-input',
    attentionReason: 'awaiting-user-input',
    statusModel: {
      runtimeStatus: 'needs-input',
      phase: 'needs-action',
      glyph: '▲',
      badge: 'NEED',
      detailText: 'awaiting input',
      attentionReason: 'awaiting-user-input',
      lastKnownWork: null,
      lastKnownWorkAt: null,
      activityHint: 'needs-action',
      observedAt: '2026-02-21T00:03:00.000Z',
    },
    live: true,
    ts: '2026-02-21T00:03:00.000Z',
    directoryId: 'directory-1',
    conversationId: 'conversation-1',
    telemetry: null,
    controller: null,
  } as StreamObservedEvent);
  assert.equal(statusApplied.changed, true);
  assert.equal(
    statusApplied.state.conversationsById['conversation-1']?.runtimeStatus,
    'needs-input',
  );

  const statusIgnored = applyObservedEventToSyncedState(state, {
    type: 'session-status',
    sessionId: 'conversation-missing',
    status: 'running',
    attentionReason: null,
    statusModel: null,
    live: true,
    ts: '2026-02-21T00:04:00.000Z',
    directoryId: null,
    conversationId: null,
    telemetry: null,
    controller: null,
  } as StreamObservedEvent);
  assert.equal(statusIgnored.changed, false);
});

void test('synced observed state covers malformed and no-op branches', () => {
  let state = createHarnessSyncedState();

  const malformedDirectory = applyObservedEventToSyncedState(state, {
    type: 'directory-upserted',
    directory: {
      invalid: true,
    },
  } as unknown as StreamObservedEvent);
  assert.equal(malformedDirectory.changed, false);

  const missingArchivedDirectory = applyObservedEventToSyncedState(state, {
    type: 'directory-archived',
    directoryId: 'directory-missing',
    ts: '2026-02-21T00:05:00.000Z',
  } as StreamObservedEvent);
  assert.equal(missingArchivedDirectory.changed, false);

  state = applyObservedEventToSyncedState(state, {
    type: 'directory-upserted',
    directory: directoryRecord('directory-2'),
  } as StreamObservedEvent).state;
  state = applyObservedEventToSyncedState(state, {
    type: 'conversation-created',
    conversation: conversationRecord('conversation-2', 'directory-2'),
  } as StreamObservedEvent).state;
  state = applyObservedEventToSyncedState(state, {
    type: 'repository-upserted',
    repository: repositoryRecord('repository-2'),
  } as StreamObservedEvent).state;
  state = applyObservedEventToSyncedState(state, {
    type: 'task-created',
    task: taskRecord('task-2', 'repository-2'),
  } as StreamObservedEvent).state;

  const malformedConversationUpdate = applyObservedEventToSyncedState(state, {
    type: 'conversation-updated',
    conversation: {
      invalid: true,
    },
  } as unknown as StreamObservedEvent);
  assert.equal(malformedConversationUpdate.changed, false);

  const missingConversationArchive = applyObservedEventToSyncedState(state, {
    type: 'conversation-archived',
    conversationId: 'conversation-missing',
    ts: '2026-02-21T00:06:00.000Z',
  } as StreamObservedEvent);
  assert.equal(missingConversationArchive.changed, false);

  const existingConversationDelete = applyObservedEventToSyncedState(state, {
    type: 'conversation-deleted',
    conversationId: 'conversation-2',
    ts: '2026-02-21T00:06:01.000Z',
  } as StreamObservedEvent);
  assert.equal(existingConversationDelete.changed, true);
  assert.deepEqual(existingConversationDelete.removedConversationIds, ['conversation-2']);
  state = existingConversationDelete.state;

  const malformedRepositoryUpdate = applyObservedEventToSyncedState(state, {
    type: 'repository-updated',
    repository: {
      invalid: true,
    },
  } as unknown as StreamObservedEvent);
  assert.equal(malformedRepositoryUpdate.changed, false);

  const missingRepositoryArchive = applyObservedEventToSyncedState(state, {
    type: 'repository-archived',
    repositoryId: 'repository-missing',
    ts: '2026-02-21T00:07:00.000Z',
  } as StreamObservedEvent);
  assert.equal(missingRepositoryArchive.changed, false);

  const existingRepositoryArchive = applyObservedEventToSyncedState(state, {
    type: 'repository-archived',
    repositoryId: 'repository-2',
    ts: '2026-02-21T00:07:01.000Z',
  } as StreamObservedEvent);
  assert.equal(existingRepositoryArchive.changed, true);
  assert.equal(
    existingRepositoryArchive.state.repositoriesById['repository-2']?.archivedAt,
    '2026-02-21T00:07:01.000Z',
  );
  state = existingRepositoryArchive.state;

  const malformedTaskUpdate = applyObservedEventToSyncedState(state, {
    type: 'task-updated',
    task: {
      invalid: true,
    },
  } as unknown as StreamObservedEvent);
  assert.equal(malformedTaskUpdate.changed, false);

  const missingTaskDelete = applyObservedEventToSyncedState(state, {
    type: 'task-deleted',
    taskId: 'task-missing',
    ts: '2026-02-21T00:08:00.000Z',
  } as StreamObservedEvent);
  assert.equal(missingTaskDelete.changed, false);

  const emptyTaskReorder = applyObservedEventToSyncedState(state, {
    type: 'task-reordered',
    tasks: [{ invalid: true }],
    ts: '2026-02-21T00:08:01.000Z',
  } as unknown as StreamObservedEvent);
  assert.equal(emptyTaskReorder.changed, false);

  const missingSessionStatus = applyObservedEventToSyncedState(state, {
    type: 'session-status',
    sessionId: 'conversation-missing',
    status: 'running',
    attentionReason: null,
    statusModel: null,
    live: true,
    ts: '2026-02-21T00:08:02.000Z',
    directoryId: null,
    conversationId: null,
    telemetry: null,
    controller: null,
  } as StreamObservedEvent);
  assert.equal(missingSessionStatus.changed, false);

  const unrelated = applyObservedEventToSyncedState(state, {
    type: 'session-control',
    sessionId: 'conversation-missing',
    action: 'claimed',
    controller: null,
    previousController: null,
    reason: null,
    ts: '2026-02-21T00:08:03.000Z',
    directoryId: null,
    conversationId: null,
  } as StreamObservedEvent);
  assert.equal(unrelated.changed, false);
});
