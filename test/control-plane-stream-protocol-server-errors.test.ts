import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  encodeStreamEnvelope,
  parseClientEnvelope,
  parseServerEnvelope,
  type StreamClientEnvelope,
  type StreamServerEnvelope,
} from '../src/control-plane/stream-protocol.ts';
void test('parseServerEnvelope rejects malformed envelopes', () => {
  const invalidValues: unknown[] = [
    null,
    {
      kind: 'auth.error',
      error: 1,
    },
    {
      kind: 'command.accepted',
      commandId: 1,
    },
    {
      kind: 'command.completed',
      commandId: 'c1',
      result: 'not-record',
    },
    {
      kind: 'command.failed',
      commandId: 'c1',
      error: 9,
    },
    {
      kind: 'pty.output',
      sessionId: 's1',
      cursor: 'x',
      chunkBase64: 'abc',
    },
    {
      kind: 'pty.exit',
      sessionId: 's1',
      exit: null,
    },
    {
      kind: 'pty.exit',
      sessionId: 's1',
      exit: {
        code: 'x',
        signal: null,
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'notify',
        record: {
          ts: 5,
          payload: {},
        },
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'attention-required',
        record: {
          ts: new Date(0).toISOString(),
          payload: {},
        },
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'session-exit',
        exit: null,
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'session-exit',
        exit: {
          code: null,
          signal: '9',
        },
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's1',
      event: {
        type: 'session-exit',
        exit: {
          code: 'x',
          signal: null,
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 'x',
      event: {
        type: 'directory-upserted',
        directory: {},
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: null,
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {},
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'directory-upserted',
        directory: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 99,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'directory-archived',
        directoryId: 'directory-1',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'directory-git-updated',
        directoryId: 'directory-1',
        summary: {
          branch: 'main',
          changedFiles: 1,
          additions: 1,
          deletions: 1,
        },
        repositorySnapshot: {
          normalizedRemoteUrl: null,
          commitCount: null,
          lastCommitAt: null,
          shortCommitHash: null,
          inferredName: null,
          defaultBranch: null,
        },
        repositoryId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'directory-git-updated',
        directoryId: 'directory-1',
        summary: {
          branch: 'main',
          changedFiles: 1,
          additions: null,
          deletions: 1,
        },
        repositorySnapshot: {
          normalizedRemoteUrl: null,
          commitCount: null,
          lastCommitAt: null,
          shortCommitHash: null,
          inferredName: null,
          defaultBranch: null,
        },
        repositoryId: null,
        repository: null,
        observedAt: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'directory-git-updated',
        directoryId: 'directory-1',
        summary: {
          branch: 'main',
          changedFiles: 1,
          additions: 1,
          deletions: 1,
        },
        repositorySnapshot: {
          normalizedRemoteUrl: 42,
          commitCount: null,
          lastCommitAt: null,
          shortCommitHash: null,
          inferredName: null,
          defaultBranch: null,
        },
        repositoryId: null,
        repository: null,
        observedAt: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'repository-upserted',
        repository: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'repository-updated',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'repository-archived',
        repositoryId: 'repository-1',
        ts: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'task-created',
        task: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'task-updated',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'task-deleted',
        taskId: null,
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'task-reordered',
        tasks: {},
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'task-reordered',
        tasks: [null],
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'task-reordered',
        tasks: [],
        ts: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: 7,
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: true,
        telemetry: null,
        controller: 'bad-controller',
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: true,
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: 'yes',
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'session-exit',
          exit: {
            code: 0,
            signal: null,
          },
        },
        ts: new Date(0).toISOString(),
        directoryId: 7,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'session-exit',
          exit: {
            code: 0,
            signal: null,
          },
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: 7,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-control',
        sessionId: 's1',
        action: 'claimed',
        controller: {
          controllerId: 'agent-1',
          controllerType: 'agent',
          controllerLabel: 'agent one',
          claimedAt: new Date(0).toISOString(),
        },
        previousController: null,
        reason: null,
        ts: new Date(0).toISOString(),
        directoryId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-control',
        sessionId: 's1',
        action: 'claimed',
        controller: {
          controllerId: 'agent-1',
          controllerType: 'bad-type',
          controllerLabel: 'agent one',
          claimedAt: new Date(0).toISOString(),
        },
        previousController: null,
        reason: null,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-control',
        sessionId: 's1',
        action: 'invalid-action',
        controller: null,
        previousController: null,
        reason: null,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-output',
        sessionId: 's1',
        outputCursor: 1,
        chunkBase64: 'x',
        ts: new Date(0).toISOString(),
        directoryId: 4,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'unknown-source',
          eventName: null,
          severity: null,
          summary: 'bad source',
          observedAt: new Date(0).toISOString(),
          statusHint: null,
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-created',
        conversation: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-created',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-updated',
        conversation: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-archived',
        conversationId: null,
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-archived',
        conversationId: 'conversation-1',
        ts: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-deleted',
        conversationId: null,
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'conversation-deleted',
        conversationId: 'conversation-1',
        ts: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'bad',
        attentionReason: null,
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: 'bad',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: {
          source: 'otlp-log',
          eventName: 123,
          severity: null,
          summary: null,
          observedAt: new Date(0).toISOString(),
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: {
          source: 'otlp-log',
          eventName: null,
          severity: null,
          summary: 123,
          observedAt: new Date(0).toISOString(),
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-status',
        sessionId: 's1',
        status: 'running',
        attentionReason: null,
        live: true,
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
        telemetry: {
          source: 'invalid-source',
          eventName: null,
          severity: null,
          summary: 'bad source',
          observedAt: new Date(0).toISOString(),
        },
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'otlp-log',
          eventName: 'codex.sse_event',
          severity: null,
          summary: null,
          observedAt: new Date(0).toISOString(),
          statusHint: 'bad',
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: 'bad',
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-key-event',
        sessionId: 's1',
        keyEvent: {
          source: 'history',
          eventName: null,
          severity: null,
          summary: 'history.entry',
          observedAt: new Date(0).toISOString(),
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'notify',
          record: {
            ts: new Date(0).toISOString(),
            payload: {
              type: 'notify',
            },
          },
        },
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-output',
        sessionId: 's1',
        outputCursor: 1,
        chunkBase64: 'x',
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'unknown-observed-event',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-output',
        sessionId: 's1',
        outputCursor: 'x',
        chunkBase64: 'x',
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-1',
      cursor: 1,
      event: {
        type: 'session-event',
        sessionId: 's1',
        event: {
          type: 'unknown',
        },
        ts: new Date(0).toISOString(),
        directoryId: null,
        conversationId: null,
      },
    },
    {
      kind: 'unknown',
    },
  ];

  for (const value of invalidValues) {
    assert.equal(parseServerEnvelope(value), null);
  }
});

void test('parseServerEnvelope rejects directory git updates with malformed summary fields', () => {
  const parsed = parseServerEnvelope({
    kind: 'stream.event',
    subscriptionId: 'subscription-1',
    cursor: 1,
    event: {
      type: 'directory-git-updated',
      directoryId: 'directory-1',
      summary: {
        branch: null,
        changedFiles: 1,
        additions: 1,
        deletions: 1,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: null,
        commitCount: null,
        lastCommitAt: null,
        shortCommitHash: null,
        inferredName: null,
        defaultBranch: null,
      },
      repositoryId: null,
      repository: null,
      observedAt: new Date(0).toISOString(),
    },
  });
  assert.equal(parsed, null);
});

void test('parseServerEnvelope rejects directory git updates with malformed repository snapshot fields', () => {
  const parsed = parseServerEnvelope({
    kind: 'stream.event',
    subscriptionId: 'subscription-1',
    cursor: 1,
    event: {
      type: 'directory-git-updated',
      directoryId: 'directory-1',
      summary: {
        branch: 'main',
        changedFiles: 1,
        additions: 1,
        deletions: 1,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: null,
        commitCount: 'bad-commit-count',
        lastCommitAt: null,
        shortCommitHash: null,
        inferredName: null,
        defaultBranch: null,
      },
      repositoryId: null,
      repository: null,
      observedAt: new Date(0).toISOString(),
    },
  });
  assert.equal(parsed, null);
});

void test('protocol parse helpers round-trip encoded envelopes', () => {
  const client: StreamClientEnvelope = {
    kind: 'pty.signal',
    sessionId: 'session-1',
    signal: 'terminate',
  };
  const server: StreamServerEnvelope = {
    kind: 'pty.event',
    sessionId: 'session-1',
    event: {
      type: 'session-exit',
      exit: {
        code: 130,
        signal: 'SIGINT',
      },
    },
  };

  const clientParsed = parseClientEnvelope(JSON.parse(encodeStreamEnvelope(client).trim()));
  const serverParsed = parseServerEnvelope(JSON.parse(encodeStreamEnvelope(server).trim()));

  assert.deepEqual(clientParsed, client);
  assert.deepEqual(serverParsed, server);
});

void test('protocol parsers cover remaining guard branches', () => {
  const extraInvalidClient: unknown[] = [
    {
      kind: 'command',
      commandId: 'c-guard',
      command: null,
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {},
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
      },
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
        initialRows: 24,
        env: 3,
      },
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
        initialRows: 24,
        terminalForegroundHex: 10,
      },
    },
    {
      kind: 'command',
      commandId: 'c-guard',
      command: {
        type: 'pty.start',
        sessionId: 's-guard',
        args: [],
        initialCols: 80,
        initialRows: 24,
        terminalBackgroundHex: 10,
      },
    },
    {
      kind: 'mystery-kind',
      sessionId: 's-guard',
    },
  ];

  for (const value of extraInvalidClient) {
    assert.equal(parseClientEnvelope(value), null);
  }

  const extraInvalidServer: unknown[] = [
    {
      kind: 5,
    },
    {
      kind: 'command.completed',
      commandId: 9,
      result: {},
    },
    {
      kind: 'command.failed',
      commandId: 9,
      error: 'bad',
    },
    {
      kind: 'pty.output',
      cursor: 1,
      chunkBase64: 'abc',
    },
    {
      kind: 'pty.exit',
      exit: {
        code: 0,
        signal: null,
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: null,
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: {},
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: {
        type: 'notify',
      },
    },
    {
      kind: 'pty.event',
      sessionId: 's-guard',
      event: {
        type: 'unknown-event',
        record: {
          ts: new Date(0).toISOString(),
          payload: {},
        },
      },
    },
    {
      kind: 'pty.exit',
      sessionId: 's-guard',
      exit: {
        code: null,
        signal: 9,
      },
    },
    {
      kind: 'mystery-kind',
      sessionId: 's-guard',
    },
  ];

  for (const value of extraInvalidServer) {
    assert.equal(parseServerEnvelope(value), null);
  }
});

void test('parseServerEnvelope parses github observed stream events', () => {
  const upserted = parseServerEnvelope({
    kind: 'stream.event',
    subscriptionId: 'subscription-github',
    cursor: 11,
    event: {
      type: 'github-pr-upserted',
      pr: {
        prRecordId: 'pr-1',
        repositoryId: 'repository-1',
      },
    },
  });
  assert.deepEqual(upserted, {
    kind: 'stream.event',
    subscriptionId: 'subscription-github',
    cursor: 11,
    event: {
      type: 'github-pr-upserted',
      pr: {
        prRecordId: 'pr-1',
        repositoryId: 'repository-1',
      },
    },
  });

  const closed = parseServerEnvelope({
    kind: 'stream.event',
    subscriptionId: 'subscription-github',
    cursor: 12,
    event: {
      type: 'github-pr-closed',
      prRecordId: 'pr-1',
      repositoryId: 'repository-1',
      ts: new Date(0).toISOString(),
    },
  });
  assert.deepEqual(closed, {
    kind: 'stream.event',
    subscriptionId: 'subscription-github',
    cursor: 12,
    event: {
      type: 'github-pr-closed',
      prRecordId: 'pr-1',
      repositoryId: 'repository-1',
      ts: new Date(0).toISOString(),
    },
  });

  const jobs = parseServerEnvelope({
    kind: 'stream.event',
    subscriptionId: 'subscription-github',
    cursor: 13,
    event: {
      type: 'github-pr-jobs-updated',
      prRecordId: 'pr-1',
      repositoryId: 'repository-1',
      ciRollup: 'pending',
      jobs: [
        {
          jobRecordId: 'job-1',
        },
      ],
      ts: new Date(0).toISOString(),
    },
  });
  assert.deepEqual(jobs, {
    kind: 'stream.event',
    subscriptionId: 'subscription-github',
    cursor: 13,
    event: {
      type: 'github-pr-jobs-updated',
      prRecordId: 'pr-1',
      repositoryId: 'repository-1',
      ciRollup: 'pending',
      jobs: [
        {
          jobRecordId: 'job-1',
        },
      ],
      ts: new Date(0).toISOString(),
    },
  });
});

void test('parseServerEnvelope rejects malformed github observed stream events', () => {
  const invalidEvents: unknown[] = [
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-github',
      cursor: 21,
      event: {
        type: 'github-pr-upserted',
        pr: null,
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-github',
      cursor: 22,
      event: {
        type: 'github-pr-closed',
        prRecordId: 'pr-1',
        repositoryId: 'repository-1',
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-github',
      cursor: 23,
      event: {
        type: 'github-pr-jobs-updated',
        prRecordId: 'pr-1',
        repositoryId: 'repository-1',
        ciRollup: 'invalid',
        jobs: [],
        ts: new Date(0).toISOString(),
      },
    },
    {
      kind: 'stream.event',
      subscriptionId: 'subscription-github',
      cursor: 24,
      event: {
        type: 'github-pr-jobs-updated',
        prRecordId: 'pr-1',
        repositoryId: 'repository-1',
        ciRollup: 'success',
        jobs: [null],
        ts: new Date(0).toISOString(),
      },
    },
  ];
  for (const value of invalidEvents) {
    assert.equal(parseServerEnvelope(value), null);
  }
});
