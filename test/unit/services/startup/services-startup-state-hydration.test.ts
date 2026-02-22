import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupStateHydrationService } from '../../../../src/services/startup-state-hydration.ts';

interface RepositoryRecord {
  readonly repositoryId: string;
}

interface DirectoryGitStatusRecord {
  readonly directoryId: string;
  readonly summary: string;
  readonly repositorySnapshot: string;
  readonly repositoryId: string | null;
  readonly repository: RepositoryRecord | null;
}

void test('startup state hydration service hydrates startup state and enters home pane even when active conversation exists', async () => {
  const calls: string[] = [];
  const repositories = new Map<string, RepositoryRecord>();
  const gitSummaries = new Map<string, string>();
  const gitSnapshots = new Map<string, string>();
  const gitAssociations = new Map<string, string | null>();
  let activeConversationId: string | null = 'session-active';

  const service = new StartupStateHydrationService<
    RepositoryRecord,
    string,
    string,
    DirectoryGitStatusRecord
  >({
    hydrateConversationList: async () => {
      calls.push('hydrateConversationList');
    },
    listRepositories: async () => {
      calls.push('listRepositories');
      return [{ repositoryId: 'repo-1' }];
    },
    clearRepositories: () => {
      calls.push('clearRepositories');
      repositories.clear();
    },
    setRepository: (repositoryId, repository) => {
      calls.push(`setRepository:${repositoryId}`);
      repositories.set(repositoryId, repository);
    },
    syncRepositoryAssociationsWithDirectorySnapshots: () => {
      calls.push('syncRepositoryAssociations');
    },
    gitHydrationEnabled: true,
    listDirectoryGitStatuses: async () => {
      calls.push('listDirectoryGitStatuses');
      return [
        {
          directoryId: 'dir-1',
          summary: 'dirty',
          repositorySnapshot: 'snapshot-1',
          repositoryId: 'repo-1',
          repository: { repositoryId: 'repo-1' },
        },
        {
          directoryId: 'dir-2',
          summary: 'clean',
          repositorySnapshot: 'snapshot-2',
          repositoryId: null,
          repository: null,
        },
      ];
    },
    setDirectoryGitSummary: (directoryId, summary) => {
      calls.push(`setGitSummary:${directoryId}`);
      gitSummaries.set(directoryId, summary);
    },
    setDirectoryRepositorySnapshot: (directoryId, snapshot) => {
      calls.push(`setGitSnapshot:${directoryId}`);
      gitSnapshots.set(directoryId, snapshot);
    },
    setDirectoryRepositoryAssociation: (directoryId, repositoryId) => {
      calls.push(`setGitAssociation:${directoryId}:${repositoryId ?? 'null'}`);
      gitAssociations.set(directoryId, repositoryId);
    },
    hydrateTaskPlanningState: async () => {
      calls.push('hydrateTaskPlanningState');
    },
    subscribeTaskPlanningEvents: async (afterCursor) => {
      calls.push(`subscribeTaskPlanningEvents:${afterCursor ?? 'null'}`);
    },
    ensureActiveConversationId: () => {
      calls.push('ensureActiveConversationId');
    },
    activeConversationId: () => activeConversationId,
    selectLeftNavConversation: (sessionId) => {
      calls.push(`selectLeftNavConversation:${sessionId}`);
    },
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
  });

  await service.hydrateStartupState(42);

  assert.equal(activeConversationId, 'session-active');
  assert.equal(repositories.has('repo-1'), true);
  assert.equal(gitSummaries.get('dir-1'), 'dirty');
  assert.equal(gitSnapshots.get('dir-1'), 'snapshot-1');
  assert.equal(gitSnapshots.get('dir-2'), 'snapshot-2');
  assert.equal(gitAssociations.get('dir-2'), null);
  assert.deepEqual(calls, [
    'hydrateConversationList',
    'listRepositories',
    'clearRepositories',
    'setRepository:repo-1',
    'syncRepositoryAssociations',
    'hydrateTaskPlanningState',
    'listDirectoryGitStatuses',
    'setGitSummary:dir-1',
    'setGitSnapshot:dir-1',
    'setGitAssociation:dir-1:repo-1',
    'setRepository:repo-1',
    'setGitSummary:dir-2',
    'setGitSnapshot:dir-2',
    'setGitAssociation:dir-2:null',
    'syncRepositoryAssociations',
    'subscribeTaskPlanningEvents:42',
    'ensureActiveConversationId',
    'enterHomePane',
  ]);
  assert.equal(calls.includes('selectLeftNavConversation:session-active'), false);
});

void test('startup state hydration service falls back to home pane when no active conversation exists', async () => {
  const calls: string[] = [];
  let activeConversationId: string | null = null;
  const service = new StartupStateHydrationService<
    RepositoryRecord,
    string,
    string,
    DirectoryGitStatusRecord
  >({
    hydrateConversationList: async () => {
      calls.push('hydrateConversationList');
    },
    listRepositories: async () => [],
    clearRepositories: () => {},
    setRepository: () => {},
    syncRepositoryAssociationsWithDirectorySnapshots: () => {},
    gitHydrationEnabled: false,
    listDirectoryGitStatuses: async () => {
      calls.push('listDirectoryGitStatuses');
      return [];
    },
    setDirectoryGitSummary: () => {},
    setDirectoryRepositorySnapshot: () => {},
    setDirectoryRepositoryAssociation: () => {},
    hydrateTaskPlanningState: async () => {
      calls.push('hydrateTaskPlanningState');
    },
    subscribeTaskPlanningEvents: async () => {
      calls.push('subscribeTaskPlanningEvents');
    },
    ensureActiveConversationId: () => {
      calls.push('ensureActiveConversationId');
      activeConversationId = null;
    },
    activeConversationId: () => activeConversationId,
    selectLeftNavConversation: () => {
      calls.push('selectLeftNavConversation');
    },
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
  });

  await service.hydrateStartupState(null);

  assert.deepEqual(calls, [
    'hydrateConversationList',
    'hydrateTaskPlanningState',
    'subscribeTaskPlanningEvents',
    'ensureActiveConversationId',
    'enterHomePane',
  ]);
});

void test('startup state hydration service supports no active conversation and enters home pane', async () => {
  const calls: string[] = [];
  const service = new StartupStateHydrationService<
    RepositoryRecord,
    string,
    string,
    DirectoryGitStatusRecord
  >({
    hydrateConversationList: async () => {},
    listRepositories: async () => [],
    clearRepositories: () => {},
    setRepository: () => {},
    syncRepositoryAssociationsWithDirectorySnapshots: () => {},
    gitHydrationEnabled: false,
    listDirectoryGitStatuses: async () => [],
    setDirectoryGitSummary: () => {},
    setDirectoryRepositorySnapshot: () => {},
    setDirectoryRepositoryAssociation: () => {},
    hydrateTaskPlanningState: async () => {},
    subscribeTaskPlanningEvents: async () => {
      calls.push('subscribeTaskPlanningEvents');
    },
    ensureActiveConversationId: () => {},
    activeConversationId: () => null,
    selectLeftNavConversation: () => {
      calls.push('selectLeftNavConversation');
    },
    enterHomePane: () => {
      calls.push('enterHomePane');
    },
  });

  await service.hydrateStartupState(7);

  assert.deepEqual(calls, ['subscribeTaskPlanningEvents', 'enterHomePane']);
});
