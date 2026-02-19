import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ControlPlaneStreamServer,
  resolveTerminalCommandForEnvironment,
  streamServerTestInternals,
  startControlPlaneStreamServer,
} from '../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import type { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';
import { FakeLiveSession, collectEnvelopes } from './control-plane-stream-server-test-helpers.ts';

void test('resolveTerminalCommandForEnvironment prefers shell then ComSpec then platform fallback', () => {
  assert.equal(
    resolveTerminalCommandForEnvironment(
      {
        SHELL: '/bin/zsh',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
      'linux',
    ),
    '/bin/zsh',
  );
  assert.equal(
    resolveTerminalCommandForEnvironment(
      {
        SHELL: '   ',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
      'linux',
    ),
    'C:\\Windows\\System32\\cmd.exe',
  );
  assert.equal(
    resolveTerminalCommandForEnvironment(
      {
        SHELL: '',
        ComSpec: ' ',
      },
      'win32',
    ),
    'cmd.exe',
  );
  assert.equal(
    resolveTerminalCommandForEnvironment(
      {
        SHELL: '',
        ComSpec: '',
      },
      'darwin',
    ),
    'sh',
  );
});

void test('stream server helper internals cover concurrency and git snapshot equality', async () => {
  const processed = new Set<string>();
  await streamServerTestInternals.runWithConcurrencyLimit(
    ['first', undefined, 'second'],
    8,
    async (value) => {
      if (value !== undefined) {
        processed.add(value);
      }
    },
  );
  assert.deepEqual([...processed].sort(), ['first', 'second']);

  assert.equal(
    streamServerTestInternals.gitSummaryEqual(
      {
        branch: 'main',
        changedFiles: 2,
        additions: 5,
        deletions: 1,
      },
      {
        branch: 'main',
        changedFiles: 2,
        additions: 5,
        deletions: 1,
      },
    ),
    true,
  );
  assert.equal(
    streamServerTestInternals.gitSummaryEqual(
      {
        branch: 'main',
        changedFiles: 2,
        additions: 5,
        deletions: 1,
      },
      {
        branch: 'dev',
        changedFiles: 2,
        additions: 5,
        deletions: 1,
      },
    ),
    false,
  );

  assert.equal(
    streamServerTestInternals.gitRepositorySnapshotEqual(
      {
        normalizedRemoteUrl: 'https://github.com/example/harness',
        commitCount: 12,
        lastCommitAt: '2026-02-16T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'harness',
        defaultBranch: 'main',
      },
      {
        normalizedRemoteUrl: 'https://github.com/example/harness',
        commitCount: 12,
        lastCommitAt: '2026-02-16T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'harness',
        defaultBranch: 'main',
      },
    ),
    true,
  );
  assert.equal(
    streamServerTestInternals.gitRepositorySnapshotEqual(
      {
        normalizedRemoteUrl: 'https://github.com/example/harness',
        commitCount: 12,
        lastCommitAt: '2026-02-16T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'harness',
        defaultBranch: 'main',
      },
      {
        normalizedRemoteUrl: 'https://github.com/example/harness-2',
        commitCount: 12,
        lastCommitAt: '2026-02-16T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'harness',
        defaultBranch: 'main',
      },
    ),
    false,
  );

  const originalGithubToken = process.env['GITHUB_TOKEN'];
  process.env['GITHUB_TOKEN'] = 'env-token';
  try {
    assert.deepEqual(
      streamServerTestInternals.parseGitHubOwnerRepoFromRemote(
        'https://github.com/acme/harness.git',
      ),
      {
        owner: 'acme',
        repo: 'harness',
      },
    );
    assert.deepEqual(
      streamServerTestInternals.parseGitHubOwnerRepoFromRemote('git@github.com:acme/harness.git'),
      {
        owner: 'acme',
        repo: 'harness',
      },
    );
    assert.equal(streamServerTestInternals.parseGitHubOwnerRepoFromRemote('https://gitlab.com/x/y'), null);
    assert.equal(streamServerTestInternals.parseGitHubOwnerRepoFromRemote('   '), null);

    assert.equal(
      streamServerTestInternals.resolveTrackedBranchName({
        strategy: 'pinned-only',
        pinnedBranch: 'release/1.0',
        currentBranch: 'feature/x',
      }),
      'release/1.0',
    );
    assert.equal(
      streamServerTestInternals.resolveTrackedBranchName({
        strategy: 'current-only',
        pinnedBranch: 'release/1.0',
        currentBranch: 'feature/x',
      }),
      'feature/x',
    );
    assert.equal(
      streamServerTestInternals.resolveTrackedBranchName({
        strategy: 'pinned-then-current',
        pinnedBranch: null,
        currentBranch: 'feature/x',
      }),
      'feature/x',
    );

    assert.equal(streamServerTestInternals.summarizeGitHubCiRollup([]), 'none');
    assert.equal(
      streamServerTestInternals.summarizeGitHubCiRollup([
        {
          provider: 'check-run',
          externalId: '1',
          name: 'ci',
          status: 'completed',
          conclusion: 'failure',
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ]),
      'failure',
    );
    assert.equal(
      streamServerTestInternals.summarizeGitHubCiRollup([
        {
          provider: 'check-run',
          externalId: '2',
          name: 'ci',
          status: 'in_progress',
          conclusion: null,
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ]),
      'pending',
    );
    assert.equal(
      streamServerTestInternals.summarizeGitHubCiRollup([
        {
          provider: 'check-run',
          externalId: '3',
          name: 'ci',
          status: 'completed',
          conclusion: 'cancelled',
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ]),
      'cancelled',
    );
    assert.equal(
      streamServerTestInternals.summarizeGitHubCiRollup([
        {
          provider: 'check-run',
          externalId: '4',
          name: 'ci',
          status: 'completed',
          conclusion: 'success',
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ]),
      'success',
    );
    assert.equal(
      streamServerTestInternals.summarizeGitHubCiRollup([
        {
          provider: 'status-context',
          externalId: '5',
          name: 'ci',
          status: 'completed',
          conclusion: 'neutral',
          url: null,
          startedAt: null,
          completedAt: null,
        },
      ]),
      'neutral',
    );

    const normalizedGitHubDefaults = streamServerTestInternals.normalizeGitHubIntegrationConfig({});
    assert.equal(normalizedGitHubDefaults.enabled, false);
    assert.equal(normalizedGitHubDefaults.token, 'env-token');
    assert.equal(normalizedGitHubDefaults.branchStrategy, 'pinned-then-current');
    assert.equal(normalizedGitHubDefaults.apiBaseUrl, 'https://api.github.com');
    const normalizedGitHubCustom = streamServerTestInternals.normalizeGitHubIntegrationConfig({
      enabled: true,
      tokenEnvVar: 'CUSTOM_GITHUB_TOKEN',
      token: 'direct-token',
      branchStrategy: 'current-only',
      viewerLogin: 'jmoyers',
      pollMs: 10,
      maxConcurrency: 0,
      apiBaseUrl: 'https://api.github.enterprise.local/',
    });
    assert.equal(normalizedGitHubCustom.enabled, true);
    assert.equal(normalizedGitHubCustom.token, 'direct-token');
    assert.equal(normalizedGitHubCustom.tokenEnvVar, 'CUSTOM_GITHUB_TOKEN');
    assert.equal(normalizedGitHubCustom.branchStrategy, 'current-only');
    assert.equal(normalizedGitHubCustom.viewerLogin, 'jmoyers');
    assert.equal(normalizedGitHubCustom.pollMs, 1000);
    assert.equal(normalizedGitHubCustom.maxConcurrency, 1);
    assert.equal(normalizedGitHubCustom.apiBaseUrl, 'https://api.github.enterprise.local');
    const normalizedGitHubFallback = streamServerTestInternals.normalizeGitHubIntegrationConfig({
      tokenEnvVar: ' ',
      branchStrategy: 'unsupported' as 'pinned-then-current',
      viewerLogin: '  ',
      pollMs: Number.NaN,
      maxConcurrency: Number.NaN,
      apiBaseUrl: '',
    });
    assert.equal(normalizedGitHubFallback.tokenEnvVar, 'GITHUB_TOKEN');
    assert.equal(normalizedGitHubFallback.branchStrategy, 'pinned-then-current');
    assert.equal(normalizedGitHubFallback.viewerLogin, null);
    assert.equal(normalizedGitHubFallback.pollMs, 15_000);
    assert.equal(normalizedGitHubFallback.maxConcurrency, 1);
    assert.equal(normalizedGitHubFallback.apiBaseUrl, 'https://api.github.com');
  } finally {
    if (originalGithubToken === undefined) {
      delete process.env['GITHUB_TOKEN'];
    } else {
      process.env['GITHUB_TOKEN'] = originalGithubToken;
    }
  }
});

void test('stream server telemetry/history private guard branches are stable', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/unused-history.jsonl',
      pollMs: 25,
    },
  });

  try {
    const internals = server as unknown as {
      stateStore: SqliteControlPlaneStore;
      resolveSessionIdByThreadId: (threadId: string) => string | null;
      updateSessionThreadId: (
        state: {
          id: string;
          agentType: string;
          adapterState: Record<string, unknown>;
        },
        threadId: string,
        observedAt: string,
      ) => void;
      codexLaunchArgsForSession: (
        sessionId: string,
        agentType: string,
        existingArgs: readonly string[],
      ) => string[];
      telemetryEndpointBaseUrl: () => string | null;
      telemetryAddress: {
        address: string;
        family: 'IPv4' | 'IPv6';
        port: number;
      } | null;
      handleTelemetryHttpRequestAsync: (
        request: {
          method?: string;
          url?: string;
        },
        response: {
          statusCode: number;
          end: () => void;
        },
      ) => Promise<void>;
      handleTelemetryHttpRequest: (
        request: {
          method?: string;
          url?: string;
          [Symbol.asyncIterator]?: () => AsyncIterableIterator<Uint8Array>;
        },
        response: {
          statusCode: number;
          writableEnded?: boolean;
          setHeader?: (name: string, value: string) => void;
          end: () => void;
        },
      ) => void;
      telemetryTokenToSessionId: Map<string, string>;
      ingestOtlpPayload: (
        kind: 'logs' | 'metrics' | 'traces',
        sessionId: string,
        payload: unknown,
      ) => void;
      ingestParsedTelemetryEvent: (
        fallbackSessionId: string | null,
        event: {
          source: 'otlp-log' | 'otlp-metric' | 'otlp-trace' | 'history';
          observedAt: string;
          eventName: string | null;
          severity: string | null;
          summary: string | null;
          providerThreadId: string | null;
          statusHint: 'running' | 'completed' | 'needs-input' | null;
          payload: Record<string, unknown>;
        },
      ) => void;
      pollHistoryFileUnsafe: () => Promise<boolean>;
      startTelemetryServer: () => Promise<void>;
    };
    const coldServer = new ControlPlaneStreamServer({
      startSession: (input) => new FakeLiveSession(input),
      codexTelemetry: {
        enabled: true,
        host: '127.0.0.1',
        port: 0,
        logUserPrompt: true,
        captureLogs: true,
        captureMetrics: true,
        captureTraces: true,
        captureVerboseEvents: true,
      },
      codexHistory: {
        enabled: false,
        filePath: '~/unused-history.jsonl',
        pollMs: 25,
      },
    });
    try {
      const coldInternals = coldServer as unknown as {
        codexLaunchArgsForSession: (
          sessionId: string,
          agentType: string,
          existingArgs: readonly string[],
        ) => string[];
        telemetryEndpointBaseUrl: () => string | null;
      };
      assert.deepEqual(coldInternals.codexLaunchArgsForSession('session-no-otel', 'codex', []), []);
      assert.equal(coldInternals.telemetryEndpointBaseUrl(), null);
    } finally {
      await coldServer.close();
    }
    await internals.startTelemetryServer();
    const codexArgsWithOtel = internals.codexLaunchArgsForSession('session-with-otel', 'codex', [
      '--foo',
    ]);
    assert.equal(codexArgsWithOtel.includes('history.persistence="none"'), true);
    const originalTelemetryAddress = internals.telemetryAddress;
    internals.telemetryAddress = {
      address: '::1',
      family: 'IPv6',
      port: 4318,
    };
    assert.equal(internals.telemetryEndpointBaseUrl(), 'http://[::1]:4318');
    internals.telemetryAddress = originalTelemetryAddress;
    const responseRecord = { statusCode: 0, ended: false };
    await internals.handleTelemetryHttpRequestAsync(
      {
        method: 'POST',
      },
      {
        get statusCode() {
          return responseRecord.statusCode;
        },
        set statusCode(value: number) {
          responseRecord.statusCode = value;
        },
        end() {
          responseRecord.ended = true;
        },
      },
    );
    assert.equal(responseRecord.statusCode, 404);
    assert.equal(responseRecord.ended, true);
    internals.telemetryTokenToSessionId.set('abort-token', 'missing-session');
    const abortedResponse = {
      statusCode: 0,
      writableEnded: false,
      ended: false,
      end() {
        this.ended = true;
        this.writableEnded = true;
      },
    };
    internals.handleTelemetryHttpRequest(
      {
        method: 'POST',
        url: '/v1/logs/abort-token',
        [Symbol.asyncIterator]() {
          const iterator: AsyncIterableIterator<Uint8Array> = {
            next() {
              const abortedError = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
              return Promise.reject(abortedError);
            },
            [Symbol.asyncIterator]() {
              return iterator;
            },
          };
          return iterator;
        },
      },
      abortedResponse,
    );
    await delay(20);
    assert.equal(abortedResponse.statusCode, 0);
    assert.equal(abortedResponse.ended, false);

    const fatalResponse = {
      statusCode: 0,
      writableEnded: false,
      ended: false,
      end() {
        this.ended = true;
        this.writableEnded = true;
      },
    };
    internals.handleTelemetryHttpRequest(
      {
        method: 'POST',
        url: '/v1/logs/abort-token',
        [Symbol.asyncIterator]() {
          const iterator: AsyncIterableIterator<Uint8Array> = {
            next() {
              return Promise.reject(new Error('unexpected read failure'));
            },
            [Symbol.asyncIterator]() {
              return iterator;
            },
          };
          return iterator;
        },
      },
      fatalResponse,
    );
    await delay(20);
    assert.equal(fatalResponse.statusCode, 500);
    assert.equal(fatalResponse.ended, true);
    internals.ingestOtlpPayload('metrics', 'missing-session', {});
    internals.ingestOtlpPayload('traces', 'missing-session', {});
    internals.ingestOtlpPayload('logs', 'missing-session', {});
    internals.ingestParsedTelemetryEvent(null, {
      source: 'otlp-log',
      observedAt: '2026-02-15T00:00:00.000Z',
      eventName: null,
      severity: null,
      summary: null,
      providerThreadId: null,
      statusHint: null,
      payload: {},
    });
    internals.ingestParsedTelemetryEvent(null, {
      source: 'otlp-log',
      observedAt: '2026-02-15T00:00:01.000Z',
      eventName: null,
      severity: null,
      summary: null,
      providerThreadId: 'thread-missing',
      statusHint: null,
      payload: {},
    });
    internals.stateStore.upsertDirectory({
      directoryId: 'directory-archived-thread',
      tenantId: 'tenant-archived-thread',
      userId: 'user-archived-thread',
      workspaceId: 'workspace-archived-thread',
      path: '/tmp/archived-thread',
    });
    internals.stateStore.createConversation({
      conversationId: 'conversation-archived-thread',
      directoryId: 'directory-archived-thread',
      title: 'archived thread',
      agentType: 'codex',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-archived',
        },
      },
    });
    internals.stateStore.archiveConversation('conversation-archived-thread');
    assert.equal(internals.resolveSessionIdByThreadId('thread-archived'), null);
    internals.ingestParsedTelemetryEvent('conversation-archived-thread', {
      source: 'history',
      observedAt: '2026-02-15T00:00:02.000Z',
      eventName: 'history.entry',
      severity: null,
      summary: 'archived telemetry should not republish',
      providerThreadId: 'thread-archived',
      statusHint: 'running',
      payload: {},
    });
    assert.equal(internals.resolveSessionIdByThreadId('   '), null);
    const nonCodexState = {
      id: 'missing-conversation-id',
      agentType: 'claude',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-keep',
        },
      },
    };
    internals.updateSessionThreadId(nonCodexState, 'thread-new', '2026-02-15T00:00:00.000Z');
    assert.equal(
      (nonCodexState.adapterState['codex'] as Record<string, unknown>)['resumeSessionId'] as string,
      'thread-keep',
    );

    const codexArrayState = {
      id: 'missing-conversation-id-2',
      agentType: 'codex',
      adapterState: {
        codex: [],
      },
    };
    internals.updateSessionThreadId(codexArrayState, 'thread-array', '2026-02-15T00:00:00.000Z');
    assert.deepEqual(codexArrayState.adapterState['codex'], {
      resumeSessionId: 'thread-array',
      lastObservedAt: '2026-02-15T00:00:00.000Z',
    });
    const codexObjectState = {
      id: 'missing-conversation-id-3',
      agentType: 'codex',
      adapterState: {
        codex: {
          existing: 'value',
        },
      },
    };
    internals.updateSessionThreadId(codexObjectState, 'thread-object', '2026-02-15T00:00:00.000Z');
    assert.deepEqual(codexObjectState.adapterState['codex'], {
      existing: 'value',
      resumeSessionId: 'thread-object',
      lastObservedAt: '2026-02-15T00:00:00.000Z',
    });

    await internals.pollHistoryFileUnsafe();
  } finally {
    await server.close();
  }

  const historyErrorServer = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~',
      pollMs: 25,
    },
  });
  try {
    const internals = historyErrorServer as unknown as {
      pollHistoryFile: () => Promise<void>;
      codexLaunchArgsForSession: (
        sessionId: string,
        agentType: string,
        existingArgs: readonly string[],
      ) => string[];
    };
    assert.deepEqual(internals.codexLaunchArgsForSession('history-only-session', 'codex', []), [
      '-c',
      'history.persistence="save-all"',
    ]);
    await internals.pollHistoryFile();
  } finally {
    await historyErrorServer.close();
  }

  const historyAndTelemetryServer = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/unused-history-with-otel.jsonl',
      pollMs: 25,
    },
  });
  try {
    const internals = historyAndTelemetryServer as unknown as {
      codexLaunchArgsForSession: (
        sessionId: string,
        agentType: string,
        existingArgs: readonly string[],
      ) => string[];
    };
    const args = internals.codexLaunchArgsForSession('history-and-otel-session', 'codex', []);
    assert.equal(args.includes('history.persistence="save-all"'), true);
  } finally {
    await historyAndTelemetryServer.close();
  }

  const historyTildeServer = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: true,
      filePath: '~/harness-missing-history-file.jsonl',
      pollMs: 25,
    },
  });
  try {
    const internals = historyTildeServer as unknown as {
      pollHistoryFile: () => Promise<void>;
    };
    await internals.pollHistoryFile();
  } finally {
    await historyTildeServer.close();
  }
});

void test('stream server telemetry listener handles close-before-start and port conflicts', async () => {
  const cold = new ControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 25,
    },
  });
  await cold.close();

  const first = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 25,
    },
  });

  const telemetryAddress = first.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);

  const conflict = new ControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: telemetryAddress!.port,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 25,
    },
  });

  try {
    await assert.rejects(conflict.start(), (error: unknown) => {
      if (!(error instanceof Error)) {
        return false;
      }
      const withCode = error as Error & { code?: string };
      return (
        withCode.code === 'EADDRINUSE' ||
        /EADDRINUSE|address already in use|port .* in use/i.test(error.message)
      );
    });
  } finally {
    await conflict.close();
    await first.close();
  }
});

void test('stream server exposes repository and task commands', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-task-1',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      path: '/tmp/harness-task-1',
    });
    const subscribedRepository = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      repositoryId: 'repository-1',
      includeOutput: false,
      afterCursor: 0,
    });
    const repositorySubscriptionId = subscribedRepository['subscriptionId'] as string;
    const subscribedTask = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      taskId: 'task-1',
      includeOutput: false,
      afterCursor: 0,
    });
    const taskSubscriptionId = subscribedTask['subscriptionId'] as string;
    const subscribedRepositoryMiss = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      repositoryId: 'repository-missing',
      includeOutput: false,
      afterCursor: 0,
    });
    const repositoryMissSubscriptionId = subscribedRepositoryMiss['subscriptionId'] as string;
    const subscribedTaskMiss = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      taskId: 'task-missing',
      includeOutput: false,
      afterCursor: 0,
    });
    const taskMissSubscriptionId = subscribedTaskMiss['subscriptionId'] as string;

    const upsertedRepository = await client.sendCommand({
      type: 'repository.upsert',
      repositoryId: 'repository-1',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      name: 'Harness',
      remoteUrl: 'https://github.com/acme/harness.git',
      defaultBranch: 'main',
      metadata: {
        owner: 'acme',
      },
    });
    const repositoryRecord = upsertedRepository['repository'] as Record<string, unknown>;
    assert.equal(repositoryRecord['repositoryId'], 'repository-1');
    assert.equal(repositoryRecord['defaultBranch'], 'main');

    const fetchedRepository = await client.sendCommand({
      type: 'repository.get',
      repositoryId: 'repository-1',
    });
    assert.equal((fetchedRepository['repository'] as Record<string, unknown>)['name'], 'Harness');

    const updatedRepository = await client.sendCommand({
      type: 'repository.update',
      repositoryId: 'repository-1',
      name: 'Harness Updated',
      remoteUrl: 'https://github.com/acme/harness-2.git',
      defaultBranch: 'develop',
    });
    assert.equal(
      (updatedRepository['repository'] as Record<string, unknown>)['remoteUrl'],
      'https://github.com/acme/harness-2.git',
    );

    const listedRepositories = await client.sendCommand({
      type: 'repository.list',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
    });
    const repositoryRows = listedRepositories['repositories'] as Array<Record<string, unknown>>;
    assert.equal(repositoryRows.length, 1);

    const createdTask = await client.sendCommand({
      type: 'task.create',
      taskId: 'task-1',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      repositoryId: 'repository-1',
      title: 'Implement repository API',
      description: 'Add stream commands for repositories',
      linear: {
        issueId: 'linear-1',
        identifier: 'ENG-10',
        teamId: 'team-eng',
        priority: 2,
        estimate: 3,
        dueDate: '2026-03-05',
        labelIds: ['backend'],
      },
    });
    assert.equal(
      ((createdTask['task'] as Record<string, unknown>)['linear'] as Record<string, unknown>)[
        'identifier'
      ],
      'ENG-10',
    );
    await client.sendCommand({
      type: 'task.create',
      taskId: 'task-2',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      title: 'Implement task API',
      description: 'Add stream commands for tasks',
    });

    const readyTask = await client.sendCommand({
      type: 'task.ready',
      taskId: 'task-1',
    });
    assert.equal((readyTask['task'] as Record<string, unknown>)['status'], 'ready');

    const claimedTask = await client.sendCommand({
      type: 'task.claim',
      taskId: 'task-1',
      controllerId: 'agent-1',
      directoryId: 'directory-task-1',
      branchName: 'feature/task-api',
      baseBranch: 'main',
    });
    const claimedTaskRecord = claimedTask['task'] as Record<string, unknown>;
    assert.equal(claimedTaskRecord['status'], 'in-progress');
    assert.equal(claimedTaskRecord['claimedByControllerId'], 'agent-1');
    assert.equal(claimedTaskRecord['claimedByDirectoryId'], 'directory-task-1');

    const completedTask = await client.sendCommand({
      type: 'task.complete',
      taskId: 'task-1',
    });
    assert.equal((completedTask['task'] as Record<string, unknown>)['status'], 'completed');

    const queuedTask = await client.sendCommand({
      type: 'task.queue',
      taskId: 'task-1',
    });
    assert.equal((queuedTask['task'] as Record<string, unknown>)['status'], 'ready');
    const draftedTask = await client.sendCommand({
      type: 'task.draft',
      taskId: 'task-1',
    });
    assert.equal((draftedTask['task'] as Record<string, unknown>)['status'], 'draft');

    const updatedTask = await client.sendCommand({
      type: 'task.update',
      taskId: 'task-2',
      repositoryId: 'repository-1',
      title: 'Implement task API v2',
      linear: {
        identifier: 'ENG-11',
        priority: 1,
      },
    });
    assert.equal((updatedTask['task'] as Record<string, unknown>)['repositoryId'], 'repository-1');
    assert.equal(
      ((updatedTask['task'] as Record<string, unknown>)['linear'] as Record<string, unknown>)[
        'identifier'
      ],
      'ENG-11',
    );
    const updatedTaskWithoutLinear = await client.sendCommand({
      type: 'task.update',
      taskId: 'task-2',
      description: 'Add stream commands for tasks and linear references',
    });
    assert.equal(
      (updatedTaskWithoutLinear['task'] as Record<string, unknown>)['description'],
      'Add stream commands for tasks and linear references',
    );
    assert.equal(
      (
        (updatedTaskWithoutLinear['task'] as Record<string, unknown>)['linear'] as Record<
          string,
          unknown
        >
      )['identifier'],
      'ENG-11',
    );

    const reordered = await client.sendCommand({
      type: 'task.reorder',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      orderedTaskIds: ['task-2', 'task-1'],
    });
    const reorderedTasks = reordered['tasks'] as Array<Record<string, unknown>>;
    assert.equal(reorderedTasks[0]?.['taskId'], 'task-2');
    assert.equal(reorderedTasks[0]?.['orderIndex'], 0);
    assert.equal(reorderedTasks[1]?.['taskId'], 'task-1');
    assert.equal(reorderedTasks[1]?.['orderIndex'], 1);

    const listedTasks = await client.sendCommand({
      type: 'task.list',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
    });
    const taskRows = listedTasks['tasks'] as Array<Record<string, unknown>>;
    assert.equal(taskRows.length, 2);

    const fetchedTask = await client.sendCommand({
      type: 'task.get',
      taskId: 'task-1',
    });
    assert.equal((fetchedTask['task'] as Record<string, unknown>)['taskId'], 'task-1');

    await client.sendCommand({
      type: 'task.delete',
      taskId: 'task-2',
    });
    await assert.rejects(
      client.sendCommand({
        type: 'task.get',
        taskId: 'task-2',
      }),
      /task not found/,
    );
    await assert.rejects(
      client.sendCommand({
        type: 'task.update',
        taskId: 'task-missing',
        title: 'missing',
      }),
      /task not found/,
    );
    await assert.rejects(
      client.sendCommand({
        type: 'task.delete',
        taskId: 'task-missing',
      }),
      /task not found/,
    );

    await client.sendCommand({
      type: 'repository.archive',
      repositoryId: 'repository-1',
    });
    const listedActiveRepositories = await client.sendCommand({
      type: 'repository.list',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
    });
    assert.deepEqual(listedActiveRepositories['repositories'], []);

    const listedArchivedRepositories = await client.sendCommand({
      type: 'repository.list',
      tenantId: 'tenant-task-1',
      userId: 'user-task-1',
      workspaceId: 'workspace-task-1',
      includeArchived: true,
    });
    const archivedRows = listedArchivedRepositories['repositories'] as Array<
      Record<string, unknown>
    >;
    assert.equal(archivedRows.length, 1);
    assert.equal(typeof archivedRows[0]?.['archivedAt'], 'string');

    await assert.rejects(
      client.sendCommand({
        type: 'repository.get',
        repositoryId: 'repository-missing',
      }),
      /repository not found/,
    );

    await delay(20);
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === repositorySubscriptionId &&
          envelope.event.type === 'repository-upserted',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === repositoryMissSubscriptionId &&
          envelope.event.type === 'task-reordered',
      ),
      false,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === taskMissSubscriptionId &&
          envelope.event.type === 'task-reordered',
      ),
      false,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === repositorySubscriptionId &&
          envelope.event.type === 'repository-updated',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === repositorySubscriptionId &&
          envelope.event.type === 'repository-archived',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === taskSubscriptionId &&
          envelope.event.type === 'task-created',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === taskSubscriptionId &&
          envelope.event.type === 'task-updated',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === taskSubscriptionId &&
          envelope.event.type === 'task-deleted',
      ),
      false,
    );
  } finally {
    client.close();
    await server.close();
  }
});
