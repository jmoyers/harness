import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamObservedEvent } from '../src/control-plane/stream-protocol.ts';
import { DirectoryManager } from '../src/domain/directories.ts';
import type { GitRepositorySnapshot, GitSummary } from '../src/mux/live-mux/git-state.ts';
import { RuntimeGitState } from '../src/services/runtime-git-state.ts';

interface RepositoryRecord {
  readonly repositoryId: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly defaultBranch: string;
  readonly archivedAt: string | null;
}

const LOADING_SUMMARY: GitSummary = {
  branch: '(loading)',
  changedFiles: 0,
  additions: 0,
  deletions: 0,
};

const EMPTY_REPOSITORY_SNAPSHOT: GitRepositorySnapshot = {
  normalizedRemoteUrl: null,
  commitCount: null,
  lastCommitAt: null,
  shortCommitHash: null,
  inferredName: null,
  defaultBranch: null,
};

function createHarness(overrides?: {
  enabled?: boolean;
  parseRepositoryRecord?: (input: unknown) => RepositoryRecord | null;
}) {
  const directoryManager = new DirectoryManager<{ directoryId: string }, GitSummary>();
  const directoryRepositorySnapshotByDirectoryId = new Map<string, GitRepositorySnapshot>();
  const repositoryAssociationByDirectoryId = new Map<string, string>();
  const repositories = new Map<string, RepositoryRecord>();
  const calls: string[] = [];
  const service = new RuntimeGitState<RepositoryRecord>({
    enabled: overrides?.enabled ?? true,
    directoryManager,
    directoryRepositorySnapshotByDirectoryId,
    repositoryAssociationByDirectoryId,
    repositories,
    parseRepositoryRecord:
      overrides?.parseRepositoryRecord ??
      ((input) => {
        const record = input as Record<string, unknown>;
        return {
          repositoryId: String(record['repositoryId']),
          name: String(record['name']),
          remoteUrl: String(record['remoteUrl']),
          defaultBranch: String(record['defaultBranch']),
          archivedAt:
            typeof record['archivedAt'] === 'string' || record['archivedAt'] === null
              ? (record['archivedAt'] as string | null)
              : null,
        };
      }),
    loadingSummary: LOADING_SUMMARY,
    emptyRepositorySnapshot: EMPTY_REPOSITORY_SNAPSHOT,
    syncRepositoryAssociationsWithDirectorySnapshots: () => {
      calls.push('syncRepositoryAssociations');
    },
    syncTaskPaneRepositorySelection: () => {
      calls.push('syncTaskPaneRepositorySelection');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });
  return {
    service,
    directoryManager,
    directoryRepositorySnapshotByDirectoryId,
    repositoryAssociationByDirectoryId,
    repositories,
    calls,
  };
}

void test('runtime git state noteGitActivity handles null/missing and existing directory branches', () => {
  const harness = createHarness();

  harness.service.noteGitActivity(null);
  harness.service.noteGitActivity('missing');
  assert.equal(harness.directoryManager.mutableGitSummaries().size, 0);

  harness.directoryManager.setDirectory('directory-a', { directoryId: 'directory-a' });
  harness.service.noteGitActivity('directory-a');
  assert.deepEqual(harness.directoryManager.mutableGitSummaries().get('directory-a'), LOADING_SUMMARY);
});

void test('runtime git state deleteDirectoryGitState clears git summary, snapshot, and association maps', () => {
  const harness = createHarness();
  harness.directoryManager.mutableGitSummaries().set('directory-a', LOADING_SUMMARY);
  harness.directoryRepositorySnapshotByDirectoryId.set('directory-a', EMPTY_REPOSITORY_SNAPSHOT);
  harness.repositoryAssociationByDirectoryId.set('directory-a', 'repo-a');

  harness.service.deleteDirectoryGitState('directory-a');

  assert.equal(harness.directoryManager.mutableGitSummaries().has('directory-a'), false);
  assert.equal(harness.directoryRepositorySnapshotByDirectoryId.has('directory-a'), false);
  assert.equal(harness.repositoryAssociationByDirectoryId.has('directory-a'), false);
});

void test('runtime git state syncGitStateWithDirectories seeds loading summaries and prunes stale map entries', () => {
  const harness = createHarness();
  harness.directoryManager.setDirectory('directory-a', { directoryId: 'directory-a' });
  harness.directoryManager.setDirectory('directory-b', { directoryId: 'directory-b' });
  harness.directoryManager.mutableGitSummaries().set('directory-stale', LOADING_SUMMARY);

  harness.service.syncGitStateWithDirectories();

  assert.equal(harness.directoryManager.mutableGitSummaries().has('directory-a'), true);
  assert.equal(harness.directoryManager.mutableGitSummaries().has('directory-b'), true);
  assert.equal(harness.directoryManager.mutableGitSummaries().has('directory-stale'), false);
  assert.deepEqual(harness.calls, ['syncRepositoryAssociations']);
});

void test('runtime git state applyObservedGitStatusEvent skips disabled and non-git events', () => {
  const disabled = createHarness({ enabled: false });
  const observedGit: StreamObservedEvent = {
    type: 'directory-git-updated',
    directoryId: 'directory-a',
    summary: {
      branch: 'main',
      changedFiles: 1,
      additions: 1,
      deletions: 0,
    },
    repositorySnapshot: {
      normalizedRemoteUrl: 'https://github.com/org/repo-a',
      commitCount: 1,
      lastCommitAt: '2026-02-18T00:00:00.000Z',
      shortCommitHash: 'abc123',
      inferredName: 'repo-a',
      defaultBranch: 'main',
    },
    repositoryId: 'repo-a',
    repository: {
      repositoryId: 'repo-a',
      name: 'repo-a',
      remoteUrl: 'https://github.com/org/repo-a',
      defaultBranch: 'main',
      archivedAt: null,
    },
    observedAt: '2026-02-18T00:00:00.000Z',
  };
  disabled.service.applyObservedGitStatusEvent(observedGit);
  assert.deepEqual(disabled.calls, []);

  const nonGit = createHarness();
  const observedNonGit: StreamObservedEvent = {
    type: 'repository-archived',
    repositoryId: 'repo-a',
    ts: '2026-02-18T00:00:00.000Z',
  };
  nonGit.service.applyObservedGitStatusEvent(observedNonGit);
  assert.deepEqual(nonGit.calls, []);
});

void test('runtime git state applyObservedGitStatusEvent updates maps and triggers sync/dirty on changed repository records', () => {
  const harness = createHarness();
  const observed: StreamObservedEvent = {
    type: 'directory-git-updated',
    directoryId: 'directory-a',
    summary: {
      branch: 'main',
      changedFiles: 2,
      additions: 2,
      deletions: 0,
    },
    repositorySnapshot: {
      normalizedRemoteUrl: 'https://github.com/org/repo-a',
      commitCount: 5,
      lastCommitAt: '2026-02-18T00:00:00.000Z',
      shortCommitHash: 'abc123',
      inferredName: 'repo-a',
      defaultBranch: 'main',
    },
    repositoryId: 'repo-a',
    repository: {
      repositoryId: 'repo-a',
      name: 'repo-a',
      remoteUrl: 'https://github.com/org/repo-a',
      defaultBranch: 'main',
      archivedAt: null,
    },
    observedAt: '2026-02-18T00:00:00.000Z',
  };

  harness.service.applyObservedGitStatusEvent(observed);

  assert.equal(harness.directoryManager.mutableGitSummaries().has('directory-a'), true);
  assert.equal(harness.repositoryAssociationByDirectoryId.get('directory-a'), 'repo-a');
  assert.equal(harness.repositories.has('repo-a'), true);
  assert.deepEqual(harness.calls, [
    'syncRepositoryAssociations',
    'syncTaskPaneRepositorySelection',
    'markDirty',
  ]);
});

void test('runtime git state applyObservedGitStatusEvent handles parse-null and unchanged repository branches', () => {
  const parseNull = createHarness({
    parseRepositoryRecord: () => null,
  });
  parseNull.repositories.set('repo-a', {
    repositoryId: 'repo-a',
    name: 'repo-a',
    remoteUrl: 'https://github.com/org/repo-a',
    defaultBranch: 'main',
    archivedAt: null,
  });
  const observedParseNull: StreamObservedEvent = {
    type: 'directory-git-updated',
    directoryId: 'directory-a',
    summary: LOADING_SUMMARY,
    repositorySnapshot: EMPTY_REPOSITORY_SNAPSHOT,
    repositoryId: null,
    repository: {
      repositoryId: 'repo-a',
      name: 'repo-a',
      remoteUrl: 'https://github.com/org/repo-a',
      defaultBranch: 'main',
      archivedAt: null,
    },
    observedAt: '2026-02-18T00:00:00.000Z',
  };
  parseNull.service.applyObservedGitStatusEvent(observedParseNull);
  assert.deepEqual(parseNull.calls, []);

  const unchanged = createHarness();
  unchanged.directoryManager.mutableGitSummaries().set('directory-a', LOADING_SUMMARY);
  unchanged.directoryRepositorySnapshotByDirectoryId.set(
    'directory-a',
    EMPTY_REPOSITORY_SNAPSHOT,
  );
  unchanged.repositories.set('repo-a', {
    repositoryId: 'repo-a',
    name: 'repo-a',
    remoteUrl: 'https://github.com/org/repo-a',
    defaultBranch: 'main',
    archivedAt: null,
  });
  const observedUnchanged: StreamObservedEvent = {
    type: 'directory-git-updated',
    directoryId: 'directory-a',
    summary: LOADING_SUMMARY,
    repositorySnapshot: EMPTY_REPOSITORY_SNAPSHOT,
    repositoryId: null,
    repository: {
      repositoryId: 'repo-a',
      name: 'repo-a',
      remoteUrl: 'https://github.com/org/repo-a',
      defaultBranch: 'main',
      archivedAt: null,
    },
    observedAt: '2026-02-18T00:00:00.000Z',
  };
  unchanged.service.applyObservedGitStatusEvent(observedUnchanged);
  assert.deepEqual(unchanged.calls, []);
});
