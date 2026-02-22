import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SqliteControlPlaneStore } from '../../../src/store/control-plane-store.ts';
import {
  normalizeGitHubPrJobRow,
  normalizeGitHubPullRequestRow,
  normalizeGitHubSyncStateRow,
} from '../../../src/store/control-plane-store-normalize.ts';

const FIXED_TS = '2026-02-19T00:00:00.000Z';

function seedRepositoryScope(store: SqliteControlPlaneStore): {
  directoryId: string;
  repositoryId: string;
} {
  const directory = store.upsertDirectory({
    directoryId: 'directory-github-1',
    tenantId: 'tenant-github-1',
    userId: 'user-github-1',
    workspaceId: 'workspace-github-1',
    path: '/tmp/harness-github-1',
  });
  const repository = store.upsertRepository({
    repositoryId: 'repository-github-1',
    tenantId: directory.tenantId,
    userId: directory.userId,
    workspaceId: directory.workspaceId,
    name: 'Harness',
    remoteUrl: 'https://github.com/acme/harness.git',
    defaultBranch: 'main',
    metadata: {
      provider: 'github',
    },
  });
  return {
    directoryId: directory.directoryId,
    repositoryId: repository.repositoryId,
  };
}

void test('control-plane store github tables support upsert/list/update flows', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const scope = seedRepositoryScope(store);

    const inserted = store.upsertGitHubPullRequest({
      prRecordId: 'pr-record-1',
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      owner: 'acme',
      repo: 'harness',
      number: 101,
      title: 'Add github control plane integration',
      url: 'https://github.com/acme/harness/pull/101',
      authorLogin: 'jmoyers',
      headBranch: 'feature/github-control-plane',
      headSha: 'deadbeef01',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      ciRollup: 'none',
      observedAt: FIXED_TS,
    });
    assert.equal(inserted.prRecordId, 'pr-record-1');
    assert.equal(inserted.closedAt, null);

    const fetchedInserted = store.getGitHubPullRequest('pr-record-1');
    assert.equal(fetchedInserted?.number, 101);

    const listedFull = store.listGitHubPullRequests({
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      headBranch: 'feature/github-control-plane',
      state: 'open',
      limit: 10,
    });
    assert.equal(listedFull.length, 1);

    const updated = store.upsertGitHubPullRequest({
      prRecordId: 'ignored-on-update',
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      owner: 'acme',
      repo: 'harness',
      number: 101,
      title: 'Add github control plane integration v2',
      url: 'https://github.com/acme/harness/pull/101',
      authorLogin: 'jmoyers',
      headBranch: 'feature/github-control-plane',
      headSha: 'deadbeef02',
      baseBranch: 'main',
      state: 'closed',
      isDraft: true,
      ciRollup: 'pending',
      closedAt: '2026-02-20T00:00:00.000Z',
      observedAt: '2026-02-20T00:00:00.000Z',
    });
    assert.equal(updated.prRecordId, 'pr-record-1');
    assert.equal(updated.state, 'closed');
    assert.equal(updated.isDraft, true);
    assert.equal(updated.ciRollup, 'pending');
    assert.equal(updated.closedAt, '2026-02-20T00:00:00.000Z');

    const rollupUpdated = store.updateGitHubPullRequestCiRollup(
      updated.prRecordId,
      'failure',
      '2026-02-20T00:01:00.000Z',
    );
    assert.equal(rollupUpdated?.ciRollup, 'failure');
    assert.equal(
      store.updateGitHubPullRequestCiRollup('missing-pr', 'success', '2026-02-20T00:01:00.000Z'),
      null,
    );

    const storedJobs = store.replaceGitHubPrJobs({
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      prRecordId: updated.prRecordId,
      observedAt: '2026-02-20T00:02:00.000Z',
      jobs: [
        {
          jobRecordId: 'job-1',
          provider: 'check-run',
          externalId: 'cr-1',
          name: 'unit-tests',
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/acme/harness/actions/runs/1',
          startedAt: '2026-02-20T00:00:10.000Z',
          completedAt: '2026-02-20T00:01:10.000Z',
        },
        {
          jobRecordId: 'job-2',
          provider: 'status-context',
          externalId: 'sc-1',
          name: 'buildkite',
          status: 'in_progress',
          conclusion: null,
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });
    assert.equal(storedJobs.length, 2);

    const filteredJobs = store.listGitHubPrJobs({
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      prRecordId: updated.prRecordId,
      limit: 1,
    });
    assert.equal(filteredJobs.length, 1);

    const noJobs = store.replaceGitHubPrJobs({
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      prRecordId: updated.prRecordId,
      observedAt: '2026-02-20T00:03:00.000Z',
      jobs: [],
    });
    assert.deepEqual(noJobs, []);

    const insertedSyncState = store.upsertGitHubSyncState({
      stateId: 'sync-1',
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      branchName: 'feature/github-control-plane',
      lastSyncAt: '2026-02-20T00:05:00.000Z',
      lastSuccessAt: '2026-02-20T00:05:00.000Z',
      lastError: null,
      lastErrorAt: null,
    });
    assert.equal(insertedSyncState.stateId, 'sync-1');

    const updatedSyncState = store.upsertGitHubSyncState({
      stateId: 'sync-1',
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      branchName: 'feature/github-control-plane',
      lastSyncAt: '2026-02-20T00:06:00.000Z',
      lastSuccessAt: null,
      lastError: 'rate limited',
      lastErrorAt: '2026-02-20T00:06:00.000Z',
    });
    assert.equal(updatedSyncState.lastError, 'rate limited');
    assert.equal(store.getGitHubSyncState('missing-sync'), null);

    const listedSyncStates = store.listGitHubSyncState({
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      branchName: 'feature/github-control-plane',
      limit: 5,
    });
    assert.equal(listedSyncStates.length, 1);
    assert.equal(store.getGitHubPullRequest('missing-pr'), null);
  } finally {
    store.close();
  }
});

void test('control-plane store github guards reject scope and repository mismatches', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const scope = seedRepositoryScope(store);
    const inserted = store.upsertGitHubPullRequest({
      prRecordId: 'pr-record-guard',
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      repositoryId: scope.repositoryId,
      directoryId: scope.directoryId,
      owner: 'acme',
      repo: 'harness',
      number: 102,
      title: 'Guard checks',
      url: 'https://github.com/acme/harness/pull/102',
      authorLogin: null,
      headBranch: 'feature/guards',
      headSha: 'deadbeef03',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      observedAt: FIXED_TS,
    });

    assert.throws(
      () =>
        store.upsertGitHubPullRequest({
          prRecordId: 'pr-record-bad-scope',
          tenantId: 'tenant-mismatch',
          userId: 'user-github-1',
          workspaceId: 'workspace-github-1',
          repositoryId: scope.repositoryId,
          directoryId: scope.directoryId,
          owner: 'acme',
          repo: 'harness',
          number: 103,
          title: 'Bad scope',
          url: 'https://github.com/acme/harness/pull/103',
          authorLogin: null,
          headBranch: 'feature/bad-scope',
          headSha: 'deadbeef04',
          baseBranch: 'main',
          state: 'open',
          isDraft: false,
          observedAt: FIXED_TS,
        }),
      /scope mismatch/,
    );

    assert.throws(
      () =>
        store.replaceGitHubPrJobs({
          tenantId: 'tenant-github-1',
          userId: 'user-github-1',
          workspaceId: 'workspace-github-1',
          repositoryId: scope.repositoryId,
          prRecordId: 'missing-pr',
          observedAt: FIXED_TS,
          jobs: [],
        }),
      /github pr not found/,
    );

    const secondRepo = store.upsertRepository({
      repositoryId: 'repository-github-2',
      tenantId: 'tenant-github-1',
      userId: 'user-github-1',
      workspaceId: 'workspace-github-1',
      name: 'Harness-2',
      remoteUrl: 'https://github.com/acme/harness-2.git',
      defaultBranch: 'main',
    });
    assert.throws(
      () =>
        store.replaceGitHubPrJobs({
          tenantId: 'tenant-github-1',
          userId: 'user-github-1',
          workspaceId: 'workspace-github-1',
          repositoryId: secondRepo.repositoryId,
          prRecordId: inserted.prRecordId,
          observedAt: FIXED_TS,
          jobs: [],
        }),
      /repository mismatch/,
    );

    assert.throws(
      () =>
        store.upsertGitHubSyncState({
          stateId: 'sync-bad-scope',
          tenantId: 'tenant-mismatch',
          userId: 'user-github-1',
          workspaceId: 'workspace-github-1',
          repositoryId: scope.repositoryId,
          directoryId: scope.directoryId,
          branchName: 'feature/bad-scope',
          lastSyncAt: FIXED_TS,
          lastSuccessAt: null,
          lastError: 'bad scope',
          lastErrorAt: FIXED_TS,
        }),
      /scope mismatch/,
    );
  } finally {
    store.close();
  }
});

void test('control-plane store github rollback guards cover impossible null branches', () => {
  const store = new SqliteControlPlaneStore(':memory:');
  try {
    const scope = seedRepositoryScope(store);

    const originalGetGitHubPullRequest = store.getGitHubPullRequest.bind(store);
    (
      store as unknown as {
        getGitHubPullRequest(
          prRecordId: string,
        ): ReturnType<SqliteControlPlaneStore['getGitHubPullRequest']>;
      }
    ).getGitHubPullRequest = () => null;
    assert.throws(
      () =>
        store.upsertGitHubPullRequest({
          prRecordId: 'pr-impossible',
          tenantId: 'tenant-github-1',
          userId: 'user-github-1',
          workspaceId: 'workspace-github-1',
          repositoryId: scope.repositoryId,
          directoryId: scope.directoryId,
          owner: 'acme',
          repo: 'harness',
          number: 104,
          title: 'Impossible branch',
          url: 'https://github.com/acme/harness/pull/104',
          authorLogin: null,
          headBranch: 'feature/impossible',
          headSha: 'deadbeef05',
          baseBranch: 'main',
          state: 'open',
          isDraft: false,
          observedAt: FIXED_TS,
        }),
      /missing after upsert/,
    );
    (
      store as unknown as {
        getGitHubPullRequest(
          prRecordId: string,
        ): ReturnType<SqliteControlPlaneStore['getGitHubPullRequest']>;
      }
    ).getGitHubPullRequest = originalGetGitHubPullRequest;

    const originalGetGitHubSyncState = store.getGitHubSyncState.bind(store);
    (
      store as unknown as {
        getGitHubSyncState(
          stateId: string,
        ): ReturnType<SqliteControlPlaneStore['getGitHubSyncState']>;
      }
    ).getGitHubSyncState = () => null;
    assert.throws(
      () =>
        store.upsertGitHubSyncState({
          stateId: 'sync-impossible',
          tenantId: 'tenant-github-1',
          userId: 'user-github-1',
          workspaceId: 'workspace-github-1',
          repositoryId: scope.repositoryId,
          directoryId: scope.directoryId,
          branchName: 'feature/impossible',
          lastSyncAt: FIXED_TS,
          lastSuccessAt: null,
          lastError: 'impossible',
          lastErrorAt: FIXED_TS,
        }),
      /missing after upsert/,
    );
    (
      store as unknown as {
        getGitHubSyncState(
          stateId: string,
        ): ReturnType<SqliteControlPlaneStore['getGitHubSyncState']>;
      }
    ).getGitHubSyncState = originalGetGitHubSyncState;
  } finally {
    store.close();
  }
});

void test('control-plane store github normalizers enforce enum guards', () => {
  const rawPrRow = {
    pr_record_id: 'pr-record-201',
    tenant_id: 'tenant-github-1',
    user_id: 'user-github-1',
    workspace_id: 'workspace-github-1',
    repository_id: 'repository-github-1',
    directory_id: 'directory-github-1',
    owner: 'acme',
    repo: 'harness',
    number: 201,
    title: 'Valid normalized pr',
    url: 'https://github.com/acme/harness/pull/201',
    author_login: 'jmoyers',
    head_branch: 'feature/normalize',
    head_sha: 'deadbeef06',
    base_branch: 'main',
    state: 'open',
    is_draft: 0,
    ci_rollup: 'none',
    created_at: FIXED_TS,
    updated_at: FIXED_TS,
    closed_at: null,
    observed_at: FIXED_TS,
  };
  const normalizedPr = normalizeGitHubPullRequestRow(rawPrRow);
  assert.equal(normalizedPr.state, 'open');

  assert.throws(
    () =>
      normalizeGitHubPullRequestRow({
        ...rawPrRow,
        state: 'unknown',
      }),
    /github pr state enum/,
  );
  assert.throws(
    () =>
      normalizeGitHubPullRequestRow({
        ...rawPrRow,
        state: 'closed',
        ci_rollup: 'unknown',
      }),
    /github ci rollup enum/,
  );

  const rawJobRow = {
    job_record_id: 'job-record-201',
    tenant_id: 'tenant-github-1',
    user_id: 'user-github-1',
    workspace_id: 'workspace-github-1',
    repository_id: 'repository-github-1',
    pr_record_id: 'pr-record-201',
    provider: 'check-run',
    external_id: 'check-run-201',
    name: 'lint',
    status: 'completed',
    conclusion: 'success',
    url: null,
    started_at: null,
    completed_at: null,
    observed_at: FIXED_TS,
    updated_at: FIXED_TS,
  };
  const normalizedJob = normalizeGitHubPrJobRow(rawJobRow);
  assert.equal(normalizedJob.provider, 'check-run');
  assert.throws(
    () =>
      normalizeGitHubPrJobRow({
        ...rawJobRow,
        provider: 'other',
      }),
    /job provider enum/,
  );

  const normalizedSyncState = normalizeGitHubSyncStateRow({
    state_id: 'sync-record-201',
    tenant_id: 'tenant-github-1',
    user_id: 'user-github-1',
    workspace_id: 'workspace-github-1',
    repository_id: 'repository-github-1',
    directory_id: null,
    branch_name: 'feature/normalize',
    last_sync_at: FIXED_TS,
    last_success_at: null,
    last_error: null,
    last_error_at: null,
  });
  assert.equal(normalizedSyncState.branchName, 'feature/normalize');
});
