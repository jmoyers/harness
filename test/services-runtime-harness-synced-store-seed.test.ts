import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHarnessSyncedStore } from '../src/core/store/harness-synced-store.ts';
import { createConversationState } from '../src/mux/live-mux/conversation-state.ts';
import { seedRuntimeHarnessSyncedStore } from '../src/services/runtime-harness-synced-store-seed.ts';

void test('runtime harness synced store seed populates hydrated records and ignores non-persistable conversations', () => {
  const store = createHarnessSyncedStore();
  const directories = new Map([
    [
      'directory-1',
      {
        directoryId: 'directory-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        path: '/tmp/workspace-1',
        createdAt: null,
        archivedAt: null,
      },
    ],
  ]);
  const repositories = new Map([
    [
      'repository-1',
      {
        repositoryId: 'repository-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        name: 'repo-1',
        remoteUrl: 'git@github.com:owner/repo.git',
        defaultBranch: 'main',
        metadata: {},
        createdAt: null,
        archivedAt: null,
      },
    ],
  ]);
  const tasks = new Map([
    [
      'task-1',
      {
        taskId: 'task-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        repositoryId: 'repository-1',
        scopeKind: 'repository' as const,
        projectId: null,
        title: 'Task 1',
        body: 'Implement feature',
        status: 'ready' as const,
        orderIndex: 10,
        claimedByControllerId: null,
        claimedByDirectoryId: null,
        branchName: null,
        baseBranch: null,
        claimedAt: null,
        completedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  ]);

  const persistedConversation = createConversationState(
    'conversation-1',
    'directory-1',
    'Persisted',
    'codex',
    {},
    'turn-1',
    {
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      worktreeId: 'worktree-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    },
    120,
    40,
  );
  persistedConversation.status = 'needs-input';
  persistedConversation.live = false;

  const nonPersistedConversation = createConversationState(
    'conversation-transient',
    null,
    'Transient',
    'codex',
    {},
    'turn-2',
    {
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      worktreeId: 'worktree-1',
      conversationId: 'conversation-transient',
      turnId: 'turn-2',
    },
    120,
    40,
  );
  const conversations = new Map([
    ['conversation-1', persistedConversation],
    ['conversation-transient', nonPersistedConversation],
  ]);

  seedRuntimeHarnessSyncedStore({
    store,
    directories,
    conversations,
    repositories,
    tasks,
  });

  const synced = store.getState().synced;
  assert.equal(Object.keys(synced.directoriesById).length, 1);
  assert.equal(Object.keys(synced.repositoriesById).length, 1);
  assert.equal(Object.keys(synced.tasksById).length, 1);
  assert.equal(Object.keys(synced.conversationsById).length, 1);
  assert.equal(synced.conversationsById['conversation-1']?.runtimeStatus, 'needs-input');
  assert.equal(synced.conversationsById['conversation-1']?.runtimeLive, false);
  assert.equal(synced.conversationsById['conversation-transient'], undefined);
});
