import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import type { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';
import { streamServerCommandTestInternals } from '../src/control-plane/stream-server-command.ts';
import { FakeLiveSession } from './control-plane-stream-server-test-helpers.ts';

const FIXED_TS = '2026-02-19T00:00:00.000Z';

interface GitStatusCacheEntryLike {
  readonly summary: {
    branch: string | null;
    changedFiles: number;
    additions: number;
    deletions: number;
  };
  readonly repositorySnapshot: {
    normalizedRemoteUrl: string | null;
    commitCount: number | null;
    lastCommitAt: string | null;
    shortCommitHash: string | null;
    inferredName: string | null;
    defaultBranch: string | null;
  };
  readonly repositoryId: string | null;
  readonly lastRefreshedAtMs: number;
  readonly lastRefreshDurationMs: number;
}

void test('stream server command github helper internals cover owner/branch/rollup logic', () => {
  assert.deepEqual(
    streamServerCommandTestInternals.parseGitHubOwnerRepo('https://github.com/acme/harness.git'),
    {
      owner: 'acme',
      repo: 'harness',
    },
  );
  assert.deepEqual(
    streamServerCommandTestInternals.parseGitHubOwnerRepo('git@github.com:acme/harness.git'),
    {
      owner: 'acme',
      repo: 'harness',
    },
  );
  assert.equal(streamServerCommandTestInternals.parseGitHubOwnerRepo('https://gitlab.com/acme/harness'), null);
  assert.equal(streamServerCommandTestInternals.parseGitHubOwnerRepo('   '), null);

  assert.deepEqual(
    streamServerCommandTestInternals.resolveTrackedBranch({
      strategy: 'pinned-only',
      pinnedBranch: 'release/1.0',
      currentBranch: 'feature/xyz',
    }),
    {
      branchName: 'release/1.0',
      source: 'pinned',
    },
  );
  assert.deepEqual(
    streamServerCommandTestInternals.resolveTrackedBranch({
      strategy: 'pinned-only',
      pinnedBranch: null,
      currentBranch: 'feature/xyz',
    }),
    {
      branchName: null,
      source: null,
    },
  );
  assert.deepEqual(
    streamServerCommandTestInternals.resolveTrackedBranch({
      strategy: 'current-only',
      pinnedBranch: 'release/1.0',
      currentBranch: 'feature/xyz',
    }),
    {
      branchName: 'feature/xyz',
      source: 'current',
    },
  );
  assert.deepEqual(
    streamServerCommandTestInternals.resolveTrackedBranch({
      strategy: 'pinned-then-current',
      pinnedBranch: 'release/2.0',
      currentBranch: 'feature/xyz',
    }),
    {
      branchName: 'release/2.0',
      source: 'pinned',
    },
  );
  assert.deepEqual(
    streamServerCommandTestInternals.resolveTrackedBranch({
      strategy: 'pinned-then-current',
      pinnedBranch: null,
      currentBranch: 'feature/xyz',
    }),
    {
      branchName: 'feature/xyz',
      source: 'current',
    },
  );

  assert.equal(streamServerCommandTestInternals.ciRollupFromJobs([]), 'none');
  assert.equal(
    streamServerCommandTestInternals.ciRollupFromJobs([
      {
        status: 'completed',
        conclusion: 'failure',
      },
    ]),
    'failure',
  );
  assert.equal(
    streamServerCommandTestInternals.ciRollupFromJobs([
      {
        status: 'in_progress',
        conclusion: null,
      },
    ]),
    'pending',
  );
  assert.equal(
    streamServerCommandTestInternals.ciRollupFromJobs([
      {
        status: 'completed',
        conclusion: 'cancelled',
      },
    ]),
    'cancelled',
  );
  assert.equal(
    streamServerCommandTestInternals.ciRollupFromJobs([
      {
        status: 'completed',
        conclusion: 'success',
      },
    ]),
    'success',
  );
  assert.equal(
    streamServerCommandTestInternals.ciRollupFromJobs([
      {
        status: 'completed',
        conclusion: 'neutral',
      },
    ]),
    'neutral',
  );
});

void test('stream server executes github command set and error branches', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: 'token-test',
      branchStrategy: 'pinned-then-current',
      viewerLogin: null,
    },
  });
  const internals = server as unknown as {
    stateStore: SqliteControlPlaneStore;
    gitStatusByDirectoryId: Map<string, GitStatusCacheEntryLike>;
    executeCommand: (
      connection: {
        id: string;
      },
      command: unknown,
    ) => Promise<Record<string, unknown>>;
    github: {
      enabled: boolean;
      branchStrategy: 'pinned-then-current' | 'current-only' | 'pinned-only';
      viewerLogin: string | null;
    };
    githubApi: {
      openPullRequestForBranch: (input: {
        owner: string;
        repo: string;
        headBranch: string;
      }) => Promise<{
        number: number;
        title: string;
        url: string;
        authorLogin: string | null;
        headBranch: string;
        headSha: string;
        baseBranch: string;
        state: 'open' | 'closed';
        isDraft: boolean;
        updatedAt: string;
        createdAt: string;
        closedAt: string | null;
      } | null>;
      createPullRequest: (input: {
        owner: string;
        repo: string;
        title: string;
        body: string;
        head: string;
        base: string;
        draft: boolean;
      }) => Promise<{
        number: number;
        title: string;
        url: string;
        authorLogin: string | null;
        headBranch: string;
        headSha: string;
        baseBranch: string;
        state: 'open' | 'closed';
        isDraft: boolean;
        updatedAt: string;
        createdAt: string;
        closedAt: string | null;
      }>;
    };
  };

  try {
    const directory = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-command',
      tenantId: 'tenant-github-command',
      userId: 'user-github-command',
      workspaceId: 'workspace-github-command',
      path: '/tmp/harness-github-command',
    });
    const repository = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-command',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
    });
    internals.gitStatusByDirectoryId.set(directory.directoryId, {
      summary: {
        branch: 'feature/github-command',
        changedFiles: 3,
        additions: 6,
        deletions: 1,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: repository.remoteUrl,
        commitCount: 10,
        lastCommitAt: FIXED_TS,
        shortCommitHash: 'abc1234',
        inferredName: repository.name,
        defaultBranch: repository.defaultBranch,
      },
      repositoryId: repository.repositoryId,
      lastRefreshedAtMs: 1,
      lastRefreshDurationMs: 1,
    });

    const projectPr = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.project-pr',
        directoryId: directory.directoryId,
      },
    );
    assert.equal(projectPr['directoryId'], directory.directoryId);
    assert.equal(projectPr['repositoryId'], repository.repositoryId);
    assert.equal(projectPr['branchName'], 'feature/github-command');
    assert.equal(projectPr['pr'], null);
    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.project-pr',
          directoryId: 'missing-directory',
        },
      ),
      /directory not found/,
    );

    const existingPr = internals.stateStore.upsertGitHubPullRequest({
      prRecordId: 'pr-existing',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      repositoryId: repository.repositoryId,
      directoryId: directory.directoryId,
      owner: 'acme',
      repo: 'harness',
      number: 901,
      title: 'Existing PR',
      url: 'https://github.com/acme/harness/pull/901',
      authorLogin: 'jmoyers',
      headBranch: 'feature/github-command',
      headSha: 'deadbeef901',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      ciRollup: 'none',
      observedAt: FIXED_TS,
    });
    const listed = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.pr-list',
        tenantId: directory.tenantId,
        userId: directory.userId,
        workspaceId: directory.workspaceId,
        repositoryId: repository.repositoryId,
        directoryId: directory.directoryId,
        headBranch: existingPr.headBranch,
        state: 'open',
        limit: 5,
      },
    );
    assert.equal(Array.isArray(listed['prs']), true);
    assert.equal((listed['prs'] as unknown[]).length, 1);

    const createExisting = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.pr-create',
        directoryId: directory.directoryId,
        headBranch: 'feature/github-command',
      },
    );
    assert.equal(createExisting['created'], false);
    assert.equal(createExisting['existing'], true);

    internals.githubApi.createPullRequest = async () => ({
      number: 902,
      title: 'Create PR',
      url: 'https://github.com/acme/harness/pull/902',
      authorLogin: 'jmoyers',
      headBranch: 'feature/github-create',
      headSha: 'deadbeef902',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      updatedAt: FIXED_TS,
      createdAt: FIXED_TS,
      closedAt: null,
    });
    internals.githubApi.openPullRequestForBranch = async () => null;
    const createFresh = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.pr-create',
        directoryId: directory.directoryId,
        headBranch: 'feature/github-create',
        title: 'Create PR',
        body: 'Create branch PR',
        baseBranch: 'main',
      },
    );
    assert.equal(createFresh['created'], true);
    assert.equal(createFresh['existing'], false);

    internals.githubApi.createPullRequest = async () => {
      throw new Error('create failed');
    };
    internals.githubApi.openPullRequestForBranch = async () => ({
      number: 903,
      title: 'Fallback PR',
      url: 'https://github.com/acme/harness/pull/903',
      authorLogin: 'jmoyers',
      headBranch: 'feature/github-fallback',
      headSha: 'deadbeef903',
      baseBranch: 'main',
      state: 'open',
      isDraft: true,
      updatedAt: FIXED_TS,
      createdAt: FIXED_TS,
      closedAt: null,
    });
    const createFallback = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.pr-create',
        directoryId: directory.directoryId,
        headBranch: 'feature/github-fallback',
      },
    );
    assert.equal(createFallback['created'], true);

    internals.githubApi.openPullRequestForBranch = async () => null;
    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.pr-create',
          directoryId: directory.directoryId,
          headBranch: 'feature/github-fallback-fail',
        },
      ),
      /creation failed/,
    );

    const createdPrRecord = internals.stateStore.listGitHubPullRequests({
      repositoryId: repository.repositoryId,
      headBranch: 'feature/github-create',
      state: 'open',
      limit: 1,
    })[0];
    assert.notEqual(createdPrRecord, undefined);
    internals.stateStore.replaceGitHubPrJobs({
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      repositoryId: repository.repositoryId,
      prRecordId: (createdPrRecord as { prRecordId: string }).prRecordId,
      observedAt: FIXED_TS,
      jobs: [
        {
          jobRecordId: 'job-github-command-1',
          provider: 'check-run',
          externalId: 'check-1',
          name: 'ci-tests',
          status: 'completed',
          conclusion: 'success',
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });
    const jobsResponse = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.pr-jobs-list',
        repositoryId: repository.repositoryId,
        prRecordId: (createdPrRecord as { prRecordId: string }).prRecordId,
        limit: 10,
      },
    );
    assert.equal(Array.isArray(jobsResponse['jobs']), true);
    assert.equal(jobsResponse['ciRollup'], 'success');

    const myPrsUrlDefault = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.repo-my-prs-url',
        repositoryId: repository.repositoryId,
      },
    );
    assert.equal(
      myPrsUrlDefault['url'],
      'https://github.com/acme/harness/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me',
    );
    internals.github.viewerLogin = 'jmoyers';
    const myPrsUrlNamed = await internals.executeCommand(
      {
        id: 'connection-github-command',
      },
      {
        type: 'github.repo-my-prs-url',
        repositoryId: repository.repositoryId,
      },
    );
    assert.equal(
      myPrsUrlNamed['url'],
      'https://github.com/acme/harness/pulls?q=is%3Apr%20is%3Aopen%20author%3Ajmoyers',
    );

    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.repo-my-prs-url',
          repositoryId: 'repository-missing',
        },
      ),
      /repository not found/,
    );

    const nonGitHubRepository = internals.stateStore.upsertRepository({
      repositoryId: 'repository-non-github',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      name: 'Other',
      remoteUrl: 'https://gitlab.com/acme/other.git',
      defaultBranch: 'main',
    });
    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.repo-my-prs-url',
          repositoryId: nonGitHubRepository.repositoryId,
        },
      ),
      /not a github remote/,
    );

    internals.github.enabled = false;
    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.pr-create',
          directoryId: directory.directoryId,
          headBranch: 'feature/github-disabled',
        },
      ),
      /disabled/,
    );
    internals.github.enabled = true;

    const directoryNoRepo = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-no-repo',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      path: '/tmp/harness-github-no-repo',
    });
    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.pr-create',
          directoryId: directoryNoRepo.directoryId,
        },
      ),
      /no tracked github repository/,
    );

    internals.github.branchStrategy = 'pinned-only';
    await assert.rejects(
      internals.executeCommand(
        {
          id: 'connection-github-command',
        },
        {
          type: 'github.pr-create',
          directoryId: directory.directoryId,
          headBranch: null,
        },
      ),
      /no tracked branch/,
    );
  } finally {
    await server.close();
  }
});
