import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import type { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';
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

void test('stream server github request/parser internals normalize api payloads', async () => {
  const fetchCalls: Array<{
    url: string;
    init: RequestInit | undefined;
  }> = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: 'token-test',
      apiBaseUrl: 'https://api.github.test',
    },
    githubTokenResolver: async () => null,
    githubFetch: async (input, init) => {
      const url = String(input);
      fetchCalls.push({
        url,
        init,
      });
      if (url.endsWith('/error')) {
        return new Response('boom', {
          status: 500,
        });
      }
      if (url.includes('/pulls?')) {
        return new Response(
          JSON.stringify([
            {
              number: 501,
              title: 'Remote open pr',
              html_url: 'https://github.com/acme/harness/pull/501',
              state: 'open',
              draft: false,
              head: {
                ref: 'feature/github-poll',
                sha: 'deadbeef501',
              },
              base: {
                ref: 'main',
              },
              user: {
                login: 'jmoyers',
              },
              updated_at: FIXED_TS,
              created_at: FIXED_TS,
              closed_at: null,
            },
          ]),
        );
      }
      if (url.endsWith('/pulls')) {
        return new Response(
          JSON.stringify({
            number: 502,
            title: 'Remote created pr',
            html_url: 'https://github.com/acme/harness/pull/502',
            state: 'open',
            draft: true,
            head: {
              ref: 'feature/github-create',
              sha: 'deadbeef502',
            },
            base: {
              ref: 'main',
            },
            user: {
              login: 'jmoyers',
            },
            updated_at: FIXED_TS,
            created_at: FIXED_TS,
            closed_at: null,
          }),
        );
      }
      if (url.includes('/check-runs')) {
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                id: 1,
                name: 'lint',
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/acme/harness/actions/runs/1',
                started_at: FIXED_TS,
                completed_at: FIXED_TS,
              },
              {
                id: 'invalid-id',
                name: 7,
                status: 'completed',
                conclusion: null,
              },
            ],
          }),
        );
      }
      if (url.includes('/status')) {
        return new Response(
          JSON.stringify({
            statuses: [
              {
                id: 2,
                context: 'buildkite',
                state: 'pending',
                target_url: 'https://buildkite.com/acme/builds/1',
                created_at: FIXED_TS,
                updated_at: FIXED_TS,
              },
              {
                id: 'invalid-status-id',
                context: 7,
                state: null,
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
      });
    },
  });
  const internals = server as unknown as {
    github: {
      token: string | null;
    };
    githubJsonRequest: (
      path: string,
      init?: Omit<RequestInit, 'headers'> & {
        headers?: Record<string, string>;
      },
    ) => Promise<unknown>;
    parseGitHubPullRequest: (value: unknown) => Record<string, unknown> | null;
    openGitHubPullRequestForBranch: (input: {
      owner: string;
      repo: string;
      headBranch: string;
    }) => Promise<Record<string, unknown> | null>;
    createGitHubPullRequest: (input: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      head: string;
      base: string;
      draft: boolean;
    }) => Promise<Record<string, unknown>>;
    listGitHubPrJobsForCommit: (input: { owner: string; repo: string; headSha: string }) => Promise<
      readonly {
        provider: string;
        externalId: string;
        name: string;
        status: string;
        conclusion: string | null;
        url: string | null;
      }[]
    >;
    githubApi: {
      openPullRequestForBranch: (input: {
        owner: string;
        repo: string;
        headBranch: string;
      }) => Promise<Record<string, unknown> | null>;
      createPullRequest: (input: {
        owner: string;
        repo: string;
        title: string;
        body: string;
        head: string;
        base: string;
        draft: boolean;
      }) => Promise<Record<string, unknown>>;
    };
  };

  try {
    assert.equal(internals.parseGitHubPullRequest(null), null);
    assert.equal(
      internals.parseGitHubPullRequest({
        number: 1,
        title: 'invalid',
      }),
      null,
    );
    const parsed = internals.parseGitHubPullRequest({
      number: 600,
      title: 'parsed',
      html_url: 'https://github.com/acme/harness/pull/600',
      state: 'closed',
      draft: false,
      head: {
        ref: 'feature/parsed',
        sha: 'deadbeef600',
      },
      base: {
        ref: 'main',
      },
      user: {
        login: 'jmoyers',
      },
      updated_at: FIXED_TS,
      created_at: FIXED_TS,
      closed_at: FIXED_TS,
    });
    assert.notEqual(parsed, null);

    const opened = await internals.openGitHubPullRequestForBranch({
      owner: 'acme',
      repo: 'harness',
      headBranch: 'feature/github-poll',
    });
    assert.equal(opened?.['number'], 501);

    const created = await internals.createGitHubPullRequest({
      owner: 'acme',
      repo: 'harness',
      title: 'create',
      body: 'body',
      head: 'feature/github-create',
      base: 'main',
      draft: true,
    });
    assert.equal(created['number'], 502);
    const openedViaApi = await internals.githubApi.openPullRequestForBranch({
      owner: 'acme',
      repo: 'harness',
      headBranch: 'feature/github-poll',
    });
    assert.equal(openedViaApi?.['number'], 501);
    const createdViaApi = await internals.githubApi.createPullRequest({
      owner: 'acme',
      repo: 'harness',
      title: 'create-via-api',
      body: 'body',
      head: 'feature/github-create',
      base: 'main',
      draft: false,
    });
    assert.equal(createdViaApi['number'], 502);

    const jobs = await internals.listGitHubPrJobsForCommit({
      owner: 'acme',
      repo: 'harness',
      headSha: 'deadbeef503',
    });
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0]?.provider, 'check-run');
    assert.equal(jobs[1]?.provider, 'status-context');

    await assert.rejects(() => internals.githubJsonRequest('/error'), /github api request failed/);
    internals.github.token = null;
    await assert.rejects(
      () =>
        internals.githubJsonRequest('/repos/acme/harness/pulls', {
          method: 'GET',
        }),
      /set GITHUB_TOKEN or run gh auth login/,
    );

    assert.equal(
      fetchCalls.some((entry) => entry.url.includes('/check-runs?per_page=100')),
      true,
    );
  } finally {
    await server.close();
  }
});

void test('stream server github resolves token via gh fallback when env token is absent', async () => {
  const fetchCalls: Array<{ url: string; authorization: string | null }> = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: null,
      apiBaseUrl: 'https://api.github.test',
    },
    githubExecFile: (file, args, _options, callback) => {
      assert.equal(file, 'gh');
      assert.deepEqual(args, ['auth', 'token']);
      callback(null, 'gh-token-test\n', '');
    },
    githubFetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      fetchCalls.push({
        url: String(input),
        authorization: headers.get('authorization'),
      });
      return new Response(JSON.stringify([]), {
        status: 200,
      });
    },
  });
  const internals = server as unknown as {
    github: {
      token: string | null;
    };
    githubJsonRequest: (
      path: string,
      init?: Omit<RequestInit, 'headers'> & {
        headers?: Record<string, string>;
      },
    ) => Promise<unknown>;
  };

  try {
    const payload = await internals.githubJsonRequest('/repos/acme/harness/pulls?state=open');
    assert.equal(Array.isArray(payload), true);
    assert.equal(internals.github.token, 'gh-token-test');
    assert.equal(fetchCalls[0]?.authorization, 'Bearer gh-token-test');
  } finally {
    await server.close();
  }
});

void test('stream server github token fallback is graceful when token and gh are unavailable', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: null,
      pollMs: 10,
    },
    githubExecFile: (_file, _args, _options, callback) => {
      callback(new Error('gh unavailable'), '', '');
    },
    githubFetch: async () => {
      throw new Error('should not be called when token resolution fails');
    },
  });
  const internals = server as unknown as {
    githubPollTimer: NodeJS.Timeout | null;
    startGitHubPollingIfEnabled: () => void;
    gitStatusPollTimer: NodeJS.Timeout | null;
    stopGitStatusPolling: () => void;
    githubJsonRequest: (
      path: string,
      init?: Omit<RequestInit, 'headers'> & {
        headers?: Record<string, string>;
      },
    ) => Promise<unknown>;
  };

  try {
    internals.startGitHubPollingIfEnabled();
    await delay(20);
    assert.notEqual(internals.githubPollTimer, null);
    await assert.rejects(
      () => internals.githubJsonRequest('/repos/acme/harness/pulls?state=open'),
      /set GITHUB_TOKEN or run gh auth login/,
    );
    internals.gitStatusPollTimer = setInterval(() => undefined, 1000);
    internals.stopGitStatusPolling();
    assert.equal(internals.gitStatusPollTimer, null);
  } finally {
    await server.close();
  }
});

void test('stream server github polling selects tracked branch targets and deduplicates by repository+branch', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: 'token-test',
      pollMs: 10,
      branchStrategy: 'pinned-then-current',
    },
    githubTokenResolver: async () => null,
    githubFetch: async () => new Response(JSON.stringify([]), { status: 200 }),
  });
  const internals = server as unknown as {
    github: {
      enabled: boolean;
      token: string | null;
      branchStrategy: 'pinned-then-current' | 'current-only' | 'pinned-only';
    };
    stateStore: SqliteControlPlaneStore;
    githubPollTimer: NodeJS.Timeout | null;
    githubPollInFlight: boolean;
    startGitHubPollingIfEnabled: () => void;
    stopGitHubPolling: () => void;
    pollGitHub: () => Promise<void>;
    syncGitHubBranch: (input: {
      directory: {
        directoryId: string;
      };
      repository: {
        repositoryId: string;
      };
      owner: string;
      repo: string;
      branchName: string;
    }) => Promise<void>;
    gitStatusByDirectoryId: Map<string, GitStatusCacheEntryLike>;
  };

  try {
    assert.notEqual(internals.githubPollTimer, null);
    const dirOne = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-poll-1',
      tenantId: 'tenant-github-poll',
      userId: 'user-github-poll',
      workspaceId: 'workspace-github-poll',
      path: '/tmp/harness-github-poll-1',
    });
    const dirTwo = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-poll-2',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      path: '/tmp/harness-github-poll-2',
    });
    const dirThree = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-poll-3',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      path: '/tmp/harness-github-poll-3',
    });
    const dirFour = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-poll-4',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      path: '/tmp/harness-github-poll-4',
    });

    const repoOne = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-poll-1',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      name: 'Harness-1',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
    });
    const repoTwo = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-poll-2',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      name: 'Harness-2',
      remoteUrl: 'git@github.com:acme/harness-2.git',
      defaultBranch: 'main',
    });
    const repoArchived = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-poll-archived',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      name: 'Archived',
      remoteUrl: 'https://github.com/acme/archived.git',
      defaultBranch: 'main',
    });
    internals.stateStore.archiveRepository(repoArchived.repositoryId);
    const repoNonGitHub = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-poll-non-github',
      tenantId: dirOne.tenantId,
      userId: dirOne.userId,
      workspaceId: dirOne.workspaceId,
      name: 'NonGitHub',
      remoteUrl: 'https://gitlab.com/acme/non-github.git',
      defaultBranch: 'main',
    });

    internals.gitStatusByDirectoryId.set(dirOne.directoryId, {
      summary: {
        branch: 'feature/one',
        changedFiles: 1,
        additions: 1,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: repoOne.remoteUrl,
        commitCount: 1,
        lastCommitAt: FIXED_TS,
        shortCommitHash: 'a1',
        inferredName: repoOne.name,
        defaultBranch: repoOne.defaultBranch,
      },
      repositoryId: repoOne.repositoryId,
      lastRefreshedAtMs: 1,
      lastRefreshDurationMs: 1,
    });
    internals.gitStatusByDirectoryId.set(dirTwo.directoryId, {
      summary: {
        branch: 'feature/one',
        changedFiles: 2,
        additions: 3,
        deletions: 1,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: repoOne.remoteUrl,
        commitCount: 2,
        lastCommitAt: FIXED_TS,
        shortCommitHash: 'a2',
        inferredName: repoOne.name,
        defaultBranch: repoOne.defaultBranch,
      },
      repositoryId: repoOne.repositoryId,
      lastRefreshedAtMs: 1,
      lastRefreshDurationMs: 1,
    });
    internals.gitStatusByDirectoryId.set(dirThree.directoryId, {
      summary: {
        branch: 'feature/three',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: repoTwo.remoteUrl,
        commitCount: 1,
        lastCommitAt: FIXED_TS,
        shortCommitHash: 'b1',
        inferredName: repoTwo.name,
        defaultBranch: repoTwo.defaultBranch,
      },
      repositoryId: repoTwo.repositoryId,
      lastRefreshedAtMs: 1,
      lastRefreshDurationMs: 1,
    });
    internals.stateStore.updateProjectSettings({
      directoryId: dirThree.directoryId,
      pinnedBranch: 'release/1.0',
    });
    internals.gitStatusByDirectoryId.set(dirFour.directoryId, {
      summary: {
        branch: 'feature/four',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: repoNonGitHub.remoteUrl,
        commitCount: 1,
        lastCommitAt: FIXED_TS,
        shortCommitHash: 'c1',
        inferredName: repoNonGitHub.name,
        defaultBranch: repoNonGitHub.defaultBranch,
      },
      repositoryId: repoNonGitHub.repositoryId,
      lastRefreshedAtMs: 1,
      lastRefreshDurationMs: 1,
    });

    const targets: string[] = [];
    const originalSyncGitHubBranch = internals.syncGitHubBranch.bind(internals);
    internals.syncGitHubBranch = async (input) => {
      targets.push(`${input.repository.repositoryId}:${input.branchName}`);
    };
    await internals.pollGitHub();
    assert.deepEqual(targets.sort(), [
      'repository-github-poll-1:feature/one',
      'repository-github-poll-2:release/1.0',
    ]);

    internals.githubPollInFlight = true;
    await internals.pollGitHub();
    assert.equal(targets.length, 2);
    internals.githubPollInFlight = false;

    internals.github.token = null;
    await internals.pollGitHub();
    assert.equal(targets.length, 2);
    internals.github.token = 'token-test';

    internals.github.enabled = false;
    await internals.pollGitHub();
    assert.equal(targets.length, 2);
    internals.github.enabled = true;

    internals.syncGitHubBranch = originalSyncGitHubBranch;
    internals.stopGitHubPolling();
    assert.equal(internals.githubPollTimer, null);
    internals.startGitHubPollingIfEnabled();
    assert.notEqual(internals.githubPollTimer, null);
    await delay(1200);
  } finally {
    await server.close();
    assert.equal(internals.githubPollTimer, null);
  }
});

void test('stream server github poll trigger catches and reports unexpected poll failures', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: 'token-test',
      pollMs: 60_000,
    },
    githubFetch: async () => new Response(JSON.stringify([]), { status: 200 }),
  });
  const internals = server as unknown as {
    triggerGitHubPoll: () => void;
    pollGitHub: () => Promise<void>;
  };
  const writableInternals = internals as unknown as {
    pollGitHub: () => Promise<void>;
  };
  const originalPollGitHub = internals.pollGitHub.bind(internals);
  writableInternals.pollGitHub = async () => {
    throw new Error('forced github poll failure');
  };
  try {
    internals.triggerGitHubPoll();
    await delay(10);
  } finally {
    writableInternals.pollGitHub = originalPollGitHub;
    await server.close();
  }
});

void test('stream server github polling settles cleanly when server closes mid-poll', async () => {
  let releaseFetch: () => void = () => undefined;
  let markFetchStarted: () => void = () => undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  const fetchRelease = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: 'token-test',
      pollMs: 60_000,
      branchStrategy: 'current-only',
    },
    githubFetch: async () => {
      markFetchStarted();
      await fetchRelease;
      return new Response(JSON.stringify([]), { status: 200 });
    },
  });
  const internals = server as unknown as {
    stateStore: SqliteControlPlaneStore;
    gitStatusByDirectoryId: Map<string, GitStatusCacheEntryLike>;
    pollGitHub: () => Promise<void>;
  };
  let closed = false;
  try {
    const directory = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-close-race',
      tenantId: 'tenant-github-close-race',
      userId: 'user-github-close-race',
      workspaceId: 'workspace-github-close-race',
      path: '/tmp/harness-github-close-race',
    });
    const repository = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-close-race',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
    });
    internals.gitStatusByDirectoryId.set(directory.directoryId, {
      summary: {
        branch: 'main',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: repository.remoteUrl,
        commitCount: 1,
        lastCommitAt: FIXED_TS,
        shortCommitHash: 'deadbeef',
        inferredName: repository.name,
        defaultBranch: repository.defaultBranch,
      },
      repositoryId: repository.repositoryId,
      lastRefreshedAtMs: Date.now(),
      lastRefreshDurationMs: 1,
    });

    const pollPromise = internals.pollGitHub();
    await fetchStarted;
    const closePromise = server.close();
    releaseFetch();
    await closePromise;
    closed = true;
    await assert.doesNotReject(async () => await pollPromise);
  } finally {
    if (!closed) {
      releaseFetch();
      await server.close();
    }
  }
});

void test('stream server github sync updates PR state jobs and sync-status error handling', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    github: {
      enabled: true,
      token: 'token-test',
    },
    githubFetch: async () => new Response(JSON.stringify([]), { status: 200 }),
  });
  const internals = server as unknown as {
    stateStore: SqliteControlPlaneStore;
    syncGitHubBranch: (input: {
      directory: {
        directoryId: string;
        tenantId: string;
        userId: string;
        workspaceId: string;
      };
      repository: {
        repositoryId: string;
      };
      owner: string;
      repo: string;
      branchName: string;
    }) => Promise<void>;
    openGitHubPullRequestForBranch: (input: {
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
    listGitHubPrJobsForCommit: (input: { owner: string; repo: string; headSha: string }) => Promise<
      readonly {
        provider: 'check-run' | 'status-context';
        externalId: string;
        name: string;
        status: string;
        conclusion: string | null;
        url: string | null;
        startedAt: string | null;
        completedAt: string | null;
      }[]
    >;
    publishObservedEvent: (scope: Record<string, unknown>, event: Record<string, unknown>) => void;
  };

  try {
    const directory = internals.stateStore.upsertDirectory({
      directoryId: 'directory-github-sync',
      tenantId: 'tenant-github-sync',
      userId: 'user-github-sync',
      workspaceId: 'workspace-github-sync',
      path: '/tmp/harness-github-sync',
    });
    const repository = internals.stateStore.upsertRepository({
      repositoryId: 'repository-github-sync',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
    });

    internals.stateStore.upsertGitHubPullRequest({
      prRecordId: 'stale-pr-record',
      tenantId: directory.tenantId,
      userId: directory.userId,
      workspaceId: directory.workspaceId,
      repositoryId: repository.repositoryId,
      directoryId: directory.directoryId,
      owner: 'acme',
      repo: 'harness',
      number: 700,
      title: 'Stale open',
      url: 'https://github.com/acme/harness/pull/700',
      authorLogin: 'jmoyers',
      headBranch: 'feature/sync',
      headSha: 'deadbeef700',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      ciRollup: 'none',
      observedAt: FIXED_TS,
    });

    const observedEvents: string[] = [];
    const originalPublishObservedEvent = internals.publishObservedEvent.bind(internals);
    internals.publishObservedEvent = (_scope, event) => {
      observedEvents.push(String(event['type'] ?? 'unknown'));
    };

    internals.openGitHubPullRequestForBranch = async () => null;
    await internals.syncGitHubBranch({
      directory,
      repository,
      owner: 'acme',
      repo: 'harness',
      branchName: 'feature/sync',
    });
    const closedPr = internals.stateStore.listGitHubPullRequests({
      repositoryId: repository.repositoryId,
      headBranch: 'feature/sync',
      state: 'closed',
      limit: 1,
    })[0];
    assert.notEqual(closedPr, undefined);
    assert.equal(observedEvents.includes('github-pr-closed'), true);

    (
      internals as unknown as {
        listGitHubPrJobsForCommit(input: {
          owner: string;
          repo: string;
          headSha: string;
        }): ReturnType<typeof internals.listGitHubPrJobsForCommit>;
      }
    ).listGitHubPrJobsForCommit = async () => [
      {
        provider: 'check-run',
        externalId: 'check-fail',
        name: 'tests',
        status: 'completed',
        conclusion: 'failure',
        url: null,
        startedAt: null,
        completedAt: null,
      },
    ];
    internals.openGitHubPullRequestForBranch = async () => ({
      number: 701,
      title: 'Synced open',
      url: 'https://github.com/acme/harness/pull/701',
      authorLogin: 'jmoyers',
      headBranch: 'feature/sync',
      headSha: 'deadbeef701',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      updatedAt: FIXED_TS,
      createdAt: FIXED_TS,
      closedAt: null,
    });
    await internals.syncGitHubBranch({
      directory,
      repository,
      owner: 'acme',
      repo: 'harness',
      branchName: 'feature/sync',
    });
    const prsAfterSync = internals.stateStore.listGitHubPullRequests({
      repositoryId: repository.repositoryId,
      headBranch: 'feature/sync',
      limit: 10,
    });
    const openPr = prsAfterSync.find((entry) => entry.state === 'open') ?? null;
    assert.notEqual(openPr, null, JSON.stringify(prsAfterSync));
    assert.equal(openPr?.ciRollup, 'failure');
    assert.equal(observedEvents.includes('github-pr-upserted'), true);
    assert.equal(observedEvents.includes('github-pr-jobs-updated'), true);
    assert.equal(
      internals.stateStore.listGitHubPrJobs({
        prRecordId: openPr?.prRecordId,
      }).length,
      1,
    );

    internals.openGitHubPullRequestForBranch = async () => {
      throw new Error('sync boom');
    };
    await internals.syncGitHubBranch({
      directory,
      repository,
      owner: 'acme',
      repo: 'harness',
      branchName: 'feature/sync',
    });
    const syncState = internals.stateStore.getGitHubSyncState(
      `github-sync:${repository.repositoryId}:${directory.directoryId}:feature/sync`,
    );
    assert.equal(syncState?.lastError, 'sync boom');
    internals.publishObservedEvent = originalPublishObservedEvent;
  } finally {
    await server.close();
  }
});
