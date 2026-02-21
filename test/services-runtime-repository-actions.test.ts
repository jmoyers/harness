import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { WorkspaceModel, type ConversationTitleEditState } from '../src/domain/workspace.ts';
import { createNewThreadPromptState } from '../src/mux/new-thread-prompt.ts';
import { RuntimeRepositoryActions } from '../src/services/runtime-repository-actions.ts';

interface RepositoryRecord {
  readonly repositoryId: string;
  readonly remoteUrl: string;
  readonly metadata: Record<string, unknown>;
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
  });
}

function titleEditState(conversationId: string): ConversationTitleEditState {
  return {
    conversationId,
    value: 'title',
    lastSavedValue: 'title',
    error: null,
    persistInFlight: false,
    debounceTimer: null,
  };
}

function createHarness() {
  const workspace = createWorkspace();
  const repositories = new Map<string, RepositoryRecord>();
  const calls: string[] = [];
  const queuedOps: Array<() => Promise<void>> = [];
  const service = new RuntimeRepositoryActions<RepositoryRecord>({
    workspace,
    repositories,
    controlPlaneService: {
      upsertRepository: async (input) => {
        calls.push(`upsertRepository:${input.repositoryId ?? 'auto'}:${input.remoteUrl}`);
        return {
          repositoryId: input.repositoryId ?? 'repo-auto',
          remoteUrl: input.remoteUrl,
          metadata: input.metadata ?? {},
        };
      },
      updateRepository: async (input) => {
        calls.push(`updateRepository:${input.repositoryId}`);
        return {
          repositoryId: input.repositoryId,
          remoteUrl: input.remoteUrl ?? `https://github.com/org/${input.repositoryId}`,
          metadata: input.metadata ?? {},
        };
      },
      archiveRepository: async (repositoryId) => {
        calls.push(`archiveRepository:${repositoryId}`);
      },
    },
    normalizeGitHubRemoteUrl: (value) => (value.startsWith('https://github.com/') ? value : null),
    repositoryNameFromGitHubRemoteUrl: (value) => value.split('/').at(-1) ?? 'repo',
    createRepositoryId: () => 'repository-created',
    stopConversationTitleEdit: () => {
      workspace.conversationTitleEdit = null;
      calls.push('stopConversationTitleEdit');
    },
    syncRepositoryAssociationsWithDirectorySnapshots: () => {
      calls.push('syncRepositoryAssociations');
    },
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncTaskPaneRepositorySelection');
    },
    queueControlPlaneOp: (task, label) => {
      calls.push(`queueControlPlaneOp:${label}`);
      queuedOps.push(task);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  return {
    service,
    workspace,
    repositories,
    calls,
    flushQueued: async () => {
      while (queuedOps.length > 0) {
        await queuedOps.shift()?.();
      }
    },
  };
}

void test('runtime repository actions create prompt clears modal state and handles title edit stop branch', () => {
  const harness = createHarness();
  harness.workspace.newThreadPrompt = createNewThreadPromptState('directory-a');
  harness.workspace.addDirectoryPrompt = {
    value: '/tmp',
    error: null,
  };
  harness.workspace.conversationTitleEdit = titleEditState('conversation-a');
  harness.workspace.conversationTitleEditClickState = {
    conversationId: 'conversation-a',
    atMs: 1,
  };

  harness.service.openRepositoryPromptForCreate();

  assert.equal(harness.workspace.newThreadPrompt, null);
  assert.equal(harness.workspace.addDirectoryPrompt, null);
  assert.equal(harness.workspace.conversationTitleEdit, null);
  assert.equal(harness.workspace.conversationTitleEditClickState, null);
  assert.deepEqual(harness.workspace.repositoryPrompt, {
    mode: 'add',
    repositoryId: null,
    value: '',
    error: null,
  });
  assert.deepEqual(harness.calls, ['stopConversationTitleEdit', 'markDirty']);

  harness.calls.length = 0;
  harness.service.openRepositoryPromptForCreate();
  assert.deepEqual(harness.calls, ['markDirty']);
});

void test('runtime repository actions edit prompt preserves missing guard and focuses repository selection', () => {
  const harness = createHarness();
  harness.repositories.set('repo-a', {
    repositoryId: 'repo-a',
    remoteUrl: 'https://github.com/org/repo-a',
    metadata: {},
  });
  harness.workspace.conversationTitleEdit = titleEditState('conversation-a');

  harness.service.openRepositoryPromptForEdit('missing');
  assert.deepEqual(harness.calls, []);

  harness.service.openRepositoryPromptForEdit('repo-a');
  assert.equal(harness.workspace.taskPaneSelectionFocus, 'repository');
  assert.deepEqual(harness.workspace.repositoryPrompt, {
    mode: 'edit',
    repositoryId: 'repo-a',
    value: 'https://github.com/org/repo-a',
    error: null,
  });
  assert.deepEqual(harness.calls, ['stopConversationTitleEdit', 'markDirty']);
});

void test('runtime repository actions queue priority order handles no-op and queued update branches', async () => {
  const harness = createHarness();
  harness.repositories.set('repo-a', {
    repositoryId: 'repo-a',
    remoteUrl: 'https://github.com/org/repo-a',
    metadata: { homePriority: 0 },
  });
  harness.repositories.set('repo-b', {
    repositoryId: 'repo-b',
    remoteUrl: 'https://github.com/org/repo-b',
    metadata: { homePriority: 1 },
  });

  harness.service.queueRepositoryPriorityOrder(['repo-a', 'repo-b'], 'repositories-reorder');
  assert.deepEqual(harness.calls, []);

  harness.repositories.set('repo-c', {
    repositoryId: 'repo-c',
    remoteUrl: 'https://github.com/org/repo-c',
    metadata: { homePriority: '2' },
  });
  harness.repositories.set('repo-d', {
    repositoryId: 'repo-d',
    remoteUrl: 'https://github.com/org/repo-d',
    metadata: { homePriority: Number.POSITIVE_INFINITY },
  });
  harness.repositories.set('repo-e', {
    repositoryId: 'repo-e',
    remoteUrl: 'https://github.com/org/repo-e',
    metadata: { homePriority: 0.5 },
  });
  harness.repositories.set('repo-f', {
    repositoryId: 'repo-f',
    remoteUrl: 'https://github.com/org/repo-f',
    metadata: { homePriority: -1 },
  });
  harness.service.queueRepositoryPriorityOrder(
    ['repo-f', 'repo-e', 'repo-d', 'repo-c'],
    'repositories-reorder',
  );
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0], 'queueControlPlaneOp:repositories-reorder');
  await harness.flushQueued();
  const queueCalls: string[] = harness.calls.map((call) => call);
  assert.equal(queueCalls.includes('updateRepository:repo-f'), true);
  assert.equal(queueCalls.includes('updateRepository:repo-e'), true);
  assert.equal(queueCalls.includes('updateRepository:repo-d'), true);
  assert.equal(queueCalls.includes('updateRepository:repo-c'), true);
  assert.equal(queueCalls.includes('syncTaskPaneRepositorySelection'), true);
  assert.equal(queueCalls.includes('markDirty'), true);
});

void test('runtime repository actions reorder by drop handles guard and success branches', async () => {
  const harness = createHarness();
  harness.repositories.set('repo-a', {
    repositoryId: 'repo-a',
    remoteUrl: 'https://github.com/org/repo-a',
    metadata: {},
  });
  harness.repositories.set('repo-b', {
    repositoryId: 'repo-b',
    remoteUrl: 'https://github.com/org/repo-b',
    metadata: {},
  });

  harness.service.reorderRepositoryByDrop('missing', 'repo-a', ['repo-a', 'repo-b']);
  harness.service.reorderRepositoryByDrop('repo-a', 'missing', ['repo-a', 'repo-b']);
  harness.service.reorderRepositoryByDrop('repo-a', 'repo-a', ['repo-a', 'repo-b']);
  assert.deepEqual(harness.calls, []);

  harness.service.reorderRepositoryByDrop('repo-a', 'repo-b', ['repo-a', 'repo-b']);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0], 'queueControlPlaneOp:repositories-reorder-drag');
  await harness.flushQueued();
  const reorderCalls: string[] = harness.calls.map((call) => call);
  assert.equal(reorderCalls.includes('updateRepository:repo-b'), true);
  assert.equal(reorderCalls.includes('updateRepository:repo-a'), true);
});

void test('runtime repository actions upsert validates URL and supports create/update flows', async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.service.upsertRepositoryByRemoteUrl('not-a-github-url'),
    /github url required/,
  );

  await harness.service.upsertRepositoryByRemoteUrl('https://github.com/org/repo-new');
  assert.equal(
    harness.calls.includes('upsertRepository:repository-created:https://github.com/org/repo-new'),
    true,
  );
  assert.equal(harness.repositories.has('repository-created'), true);

  harness.calls.length = 0;
  await harness.service.upsertRepositoryByRemoteUrl(
    'https://github.com/org/repo-updated',
    'repo-existing',
  );
  assert.deepEqual(harness.calls, [
    'updateRepository:repo-existing',
    'syncRepositoryAssociations',
    'syncTaskPaneRepositorySelection',
    'markDirty',
  ]);
  assert.equal(harness.repositories.has('repo-existing'), true);
});

void test('runtime repository actions archive removes repository and syncs selections', async () => {
  const harness = createHarness();
  harness.repositories.set('repo-a', {
    repositoryId: 'repo-a',
    remoteUrl: 'https://github.com/org/repo-a',
    metadata: {},
  });

  await harness.service.archiveRepositoryById('repo-a');

  assert.equal(harness.repositories.has('repo-a'), false);
  assert.deepEqual(harness.calls, [
    'archiveRepository:repo-a',
    'syncRepositoryAssociations',
    'syncTaskPaneRepositorySelection',
    'markDirty',
  ]);
});
