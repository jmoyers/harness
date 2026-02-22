import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  archiveRepositoryById,
  openRepositoryPromptForCreate,
  openRepositoryPromptForEdit,
  queueRepositoryPriorityOrder,
  reorderRepositoryByDrop,
  upsertRepositoryByRemoteUrl,
} from '../../../../src/mux/live-mux/actions-repository.ts';

interface TestRepository {
  repositoryId: string;
  remoteUrl: string;
  metadata: Record<string, unknown>;
}

void test('repository prompt open helpers clear modal state and preserve missing-edit guard', () => {
  const calls: string[] = [];
  openRepositoryPromptForCreate({
    clearNewThreadPrompt: () => calls.push('clearNewThreadPrompt'),
    clearAddDirectoryPrompt: () => calls.push('clearAddDirectoryPrompt'),
    hasConversationTitleEdit: true,
    stopConversationTitleEdit: () => calls.push('stopConversationTitleEdit'),
    clearConversationTitleEditClickState: () => calls.push('clearConversationTitleEditClickState'),
    setRepositoryPrompt: (prompt) =>
      calls.push(`setRepositoryPrompt:${prompt.mode}:${prompt.value}`),
    markDirty: () => calls.push('markDirty'),
  });
  assert.deepEqual(calls, [
    'clearNewThreadPrompt',
    'clearAddDirectoryPrompt',
    'stopConversationTitleEdit',
    'clearConversationTitleEditClickState',
    'setRepositoryPrompt:add:',
    'markDirty',
  ]);

  calls.length = 0;
  openRepositoryPromptForCreate({
    clearNewThreadPrompt: () => calls.push('clearNewThreadPrompt'),
    clearAddDirectoryPrompt: () => calls.push('clearAddDirectoryPrompt'),
    hasConversationTitleEdit: false,
    stopConversationTitleEdit: () => calls.push('stopConversationTitleEdit'),
    clearConversationTitleEditClickState: () => calls.push('clearConversationTitleEditClickState'),
    setRepositoryPrompt: (prompt) =>
      calls.push(`setRepositoryPrompt:${prompt.mode}:${prompt.value}`),
    markDirty: () => calls.push('markDirty'),
  });
  assert.equal(calls.includes('stopConversationTitleEdit'), false);

  const repositories = new Map<string, TestRepository>([
    [
      'repo-a',
      {
        repositoryId: 'repo-a',
        remoteUrl: 'https://github.com/org/repo-a',
        metadata: {},
      },
    ],
  ]);
  calls.length = 0;
  openRepositoryPromptForEdit({
    repositoryId: 'missing',
    repositories,
    clearNewThreadPrompt: () => calls.push('clearNewThreadPrompt'),
    clearAddDirectoryPrompt: () => calls.push('clearAddDirectoryPrompt'),
    hasConversationTitleEdit: true,
    stopConversationTitleEdit: () => calls.push('stopConversationTitleEdit'),
    clearConversationTitleEditClickState: () => calls.push('clearConversationTitleEditClickState'),
    setRepositoryPrompt: (prompt) =>
      calls.push(`setRepositoryPrompt:${prompt.mode}:${prompt.value}`),
    setTaskPaneSelectionFocusRepository: () => calls.push('setTaskPaneSelectionFocusRepository'),
    markDirty: () => calls.push('markDirty'),
  });
  assert.equal(calls.length, 0);

  openRepositoryPromptForEdit({
    repositoryId: 'repo-a',
    repositories,
    clearNewThreadPrompt: () => calls.push('clearNewThreadPrompt'),
    clearAddDirectoryPrompt: () => calls.push('clearAddDirectoryPrompt'),
    hasConversationTitleEdit: true,
    stopConversationTitleEdit: () => calls.push('stopConversationTitleEdit'),
    clearConversationTitleEditClickState: () => calls.push('clearConversationTitleEditClickState'),
    setRepositoryPrompt: (prompt) =>
      calls.push(`setRepositoryPrompt:${prompt.mode}:${prompt.value}`),
    setTaskPaneSelectionFocusRepository: () => calls.push('setTaskPaneSelectionFocusRepository'),
    markDirty: () => calls.push('markDirty'),
  });
  assert.equal(calls.includes('setRepositoryPrompt:edit:https://github.com/org/repo-a'), true);
  assert.equal(calls.includes('setTaskPaneSelectionFocusRepository'), true);
  assert.equal(calls.includes('markDirty'), true);
});

void test('repository priority queue and drag reorder logic are deterministic', async () => {
  const noQueueCalls: string[] = [];
  queueRepositoryPriorityOrder({
    orderedRepositoryIds: ['repo-a'],
    repositories: new Map([
      [
        'repo-a',
        {
          repositoryId: 'repo-a',
          remoteUrl: 'https://github.com/org/repo-a',
          metadata: { homePriority: 0 },
        },
      ],
    ]),
    queueControlPlaneOp: () => noQueueCalls.push('queue'),
    updateRepositoryMetadata: async () => {
      throw new Error('should not run');
    },
    upsertRepository: () => noQueueCalls.push('upsert'),
    syncTaskPaneRepositorySelection: () => noQueueCalls.push('sync'),
    markDirty: () => noQueueCalls.push('dirty'),
    label: 'noop',
  });
  assert.deepEqual(noQueueCalls, []);

  const queuedTasks: Array<() => Promise<void>> = [];
  const calls: string[] = [];
  const repositories = new Map<string, TestRepository>([
    [
      'repo-a',
      {
        repositoryId: 'repo-a',
        remoteUrl: 'https://github.com/org/repo-a',
        metadata: { homePriority: 4 },
      },
    ],
    [
      'repo-b',
      {
        repositoryId: 'repo-b',
        remoteUrl: 'https://github.com/org/repo-b',
        metadata: { homePriority: -1 },
      },
    ],
    [
      'repo-c',
      {
        repositoryId: 'repo-c',
        remoteUrl: 'https://github.com/org/repo-c',
        metadata: { homePriority: '2' },
      },
    ],
  ]);
  queueRepositoryPriorityOrder({
    orderedRepositoryIds: ['repo-a', 'repo-b', 'repo-c', 'missing'],
    repositories,
    queueControlPlaneOp: (task, label) => {
      calls.push(`queue:${label}`);
      queuedTasks.push(task);
    },
    updateRepositoryMetadata: async (repositoryId, metadata) => {
      calls.push(`update:${repositoryId}:${metadata['homePriority'] as number}`);
      return {
        repositoryId,
        remoteUrl: `https://github.com/org/${repositoryId}`,
        metadata,
      };
    },
    upsertRepository: (repository) => {
      calls.push(
        `upsert:${repository.repositoryId}:${repository.metadata['homePriority'] as number}`,
      );
    },
    syncTaskPaneRepositorySelection: () => calls.push('sync'),
    markDirty: () => calls.push('dirty'),
    label: 'repositories-reorder',
  });
  assert.equal(calls.includes('queue:repositories-reorder'), true);
  while (queuedTasks.length > 0) {
    await queuedTasks.shift()?.();
  }
  assert.equal(calls.includes('update:repo-a:0'), true);
  assert.equal(calls.includes('update:repo-b:1'), true);
  assert.equal(calls.includes('update:repo-c:2'), true);
  assert.equal(calls.includes('sync'), true);
  assert.equal(calls.includes('dirty'), true);

  const reorderCalls: string[] = [];
  reorderRepositoryByDrop({
    draggedRepositoryId: 'repo-a',
    targetRepositoryId: 'repo-b',
    orderedRepositoryIds: ['repo-a', 'repo-b'],
    reorderIdsByMove: () => null,
    queueRepositoryPriorityOrder: () => reorderCalls.push('queue'),
  });
  assert.equal(reorderCalls.length, 0);
  reorderRepositoryByDrop({
    draggedRepositoryId: 'repo-a',
    targetRepositoryId: 'repo-b',
    orderedRepositoryIds: ['repo-a', 'repo-b'],
    reorderIdsByMove: () => ['repo-b', 'repo-a'],
    queueRepositoryPriorityOrder: (orderedIds, label) =>
      reorderCalls.push(`${orderedIds.join(',')}:${label}`),
  });
  assert.deepEqual(reorderCalls, ['repo-b,repo-a:repositories-reorder-drag']);
});

void test('repository upsert and archive operations validate inputs and sync local state', async () => {
  const syncCalls: string[] = [];
  await assert.rejects(
    () =>
      upsertRepositoryByRemoteUrl<TestRepository>({
        remoteUrl: 'invalid',
        existingRepositoryId: null,
        normalizeGitHubRemoteUrl: () => null,
        repositoryNameFromGitHubRemoteUrl: () => 'repo',
        createRepositoryId: () => 'repo-new',
        scope: {
          tenantId: 'tenant-a',
          userId: 'user-a',
          workspaceId: 'workspace-a',
        },
        createRepository: async () => ({ repository: {} }),
        updateRepository: async () => ({ repository: {} }),
        parseRepositoryRecord: () => null,
        upsertRepository: () => syncCalls.push('upsert'),
        syncRepositoryAssociationsWithDirectorySnapshots: () => syncCalls.push('sync-associations'),
        syncTaskPaneRepositorySelection: () => syncCalls.push('sync-selection'),
        markDirty: () => syncCalls.push('dirty'),
      }),
    /github url required/,
  );

  await assert.rejects(
    () =>
      upsertRepositoryByRemoteUrl<TestRepository>({
        remoteUrl: 'https://github.com/org/repo-a',
        existingRepositoryId: null,
        normalizeGitHubRemoteUrl: (value) => value,
        repositoryNameFromGitHubRemoteUrl: () => 'repo-a',
        createRepositoryId: () => 'repo-a',
        scope: {
          tenantId: 'tenant-a',
          userId: 'user-a',
          workspaceId: 'workspace-a',
        },
        createRepository: async () => ({ repository: null }),
        updateRepository: async () => ({ repository: null }),
        parseRepositoryRecord: () => null,
        upsertRepository: () => syncCalls.push('upsert'),
        syncRepositoryAssociationsWithDirectorySnapshots: () => syncCalls.push('sync-associations'),
        syncTaskPaneRepositorySelection: () => syncCalls.push('sync-selection'),
        markDirty: () => syncCalls.push('dirty'),
      }),
    /malformed repository record/,
  );

  syncCalls.length = 0;
  await upsertRepositoryByRemoteUrl<TestRepository>({
    remoteUrl: 'https://github.com/org/repo-create',
    existingRepositoryId: null,
    normalizeGitHubRemoteUrl: (value) => value.trim(),
    repositoryNameFromGitHubRemoteUrl: (value) => value.split('/').at(-1) ?? 'repo-create',
    createRepositoryId: () => 'repo-create',
    scope: {
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
    },
    createRepository: async (payload) => ({
      repository: {
        repositoryId: payload.repositoryId,
        remoteUrl: payload.remoteUrl,
        metadata: payload.metadata,
      },
    }),
    updateRepository: async () => {
      throw new Error('unexpected update call');
    },
    parseRepositoryRecord: (value) => {
      const record = value as Record<string, unknown>;
      return {
        repositoryId: String(record['repositoryId']),
        remoteUrl: String(record['remoteUrl']),
        metadata: (record['metadata'] as Record<string, unknown>) ?? {},
      };
    },
    upsertRepository: (repository) => syncCalls.push(`upsert:${repository.repositoryId}`),
    syncRepositoryAssociationsWithDirectorySnapshots: () => syncCalls.push('sync-associations'),
    syncTaskPaneRepositorySelection: () => syncCalls.push('sync-selection'),
    markDirty: () => syncCalls.push('dirty'),
  });
  assert.deepEqual(syncCalls, [
    'upsert:repo-create',
    'sync-associations',
    'sync-selection',
    'dirty',
  ]);

  syncCalls.length = 0;
  await upsertRepositoryByRemoteUrl<TestRepository>({
    remoteUrl: 'https://github.com/org/repo-update',
    existingRepositoryId: 'repo-update',
    normalizeGitHubRemoteUrl: (value) => value,
    repositoryNameFromGitHubRemoteUrl: () => 'repo-update',
    createRepositoryId: () => 'unused',
    scope: {
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
    },
    createRepository: async () => {
      throw new Error('unexpected create call');
    },
    updateRepository: async (payload) => ({
      repository: {
        repositoryId: payload.repositoryId,
        remoteUrl: payload.remoteUrl,
        metadata: {},
      },
    }),
    parseRepositoryRecord: (value) => {
      const record = value as Record<string, unknown>;
      return {
        repositoryId: String(record['repositoryId']),
        remoteUrl: String(record['remoteUrl']),
        metadata: (record['metadata'] as Record<string, unknown>) ?? {},
      };
    },
    upsertRepository: (repository) => syncCalls.push(`upsert:${repository.repositoryId}`),
    syncRepositoryAssociationsWithDirectorySnapshots: () => syncCalls.push('sync-associations'),
    syncTaskPaneRepositorySelection: () => syncCalls.push('sync-selection'),
    markDirty: () => syncCalls.push('dirty'),
  });
  assert.deepEqual(syncCalls, [
    'upsert:repo-update',
    'sync-associations',
    'sync-selection',
    'dirty',
  ]);

  syncCalls.length = 0;
  await archiveRepositoryById({
    repositoryId: 'repo-archive',
    archiveRepository: async (repositoryId) => {
      syncCalls.push(`archive:${repositoryId}`);
      return null;
    },
    deleteRepository: (repositoryId) => syncCalls.push(`delete:${repositoryId}`),
    syncRepositoryAssociationsWithDirectorySnapshots: () => syncCalls.push('sync-associations'),
    syncTaskPaneRepositorySelection: () => syncCalls.push('sync-selection'),
    markDirty: () => syncCalls.push('dirty'),
  });
  assert.deepEqual(syncCalls, [
    'archive:repo-archive',
    'delete:repo-archive',
    'sync-associations',
    'sync-selection',
    'dirty',
  ]);
});
