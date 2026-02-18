import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { connect, type Socket } from 'node:net';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ControlPlaneStreamServer,
  resolveTerminalCommandForEnvironment,
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../src/control-plane/stream-server.ts';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { encodeStreamEnvelope } from '../src/control-plane/stream-protocol.ts';
import { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';
import {
  FakeLiveSession,
  collectEnvelopes,
  makeTempStateStorePath,
  writeRaw,
} from './control-plane-stream-server-test-helpers.ts';

void test('stream server executeCommand guards unsupported command types', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const internal = server as unknown as {
    executeCommand: (connection: unknown, command: unknown) => Record<string, unknown>;
  };

  try {
    assert.throws(
      () =>
        internal.executeCommand(
          {
            id: 'connection-test',
          },
          {
            type: 'unsupported.command',
          },
        ),
      /unsupported command type/,
    );
  } finally {
    await server.close();
  }
});

void test('stream server publishes directory git updates from control-plane monitor', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-git-status-'));
  let pollCalls = 0;
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    gitStatus: {
      enabled: true,
      pollMs: 25,
      maxConcurrency: 1,
      minDirectoryRefreshMs: 25,
    },
    readGitDirectorySnapshot: () => {
      pollCalls += 1;
      return Promise.resolve({
        summary: {
          branch: 'main',
          changedFiles: 1,
          additions: 2,
          deletions: 0,
        },
        repository: {
          normalizedRemoteUrl: 'https://github.com/example/harness',
          commitCount: 10,
          lastCommitAt: '2026-02-16T00:00:00.000Z',
          shortCommitHash: 'abc1234',
          inferredName: 'harness',
          defaultBranch: 'main',
        },
      });
    },
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
      directoryId: 'directory-git-1',
      tenantId: 'tenant-git-1',
      userId: 'user-git-1',
      workspaceId: 'workspace-git-1',
      path: workspace,
    });
    await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-git-1',
      userId: 'user-git-1',
      workspaceId: 'workspace-git-1',
    });

    await delay(120);

    const gitEvents = observed.flatMap((envelope) => {
      if (envelope.kind !== 'stream.event') {
        return [];
      }
      if (envelope.event.type !== 'directory-git-updated') {
        return [];
      }
      return [envelope.event];
    });
    assert.equal(gitEvents.length > 0, true);
    const latest = gitEvents.at(-1)!;
    assert.equal(latest.directoryId, 'directory-git-1');
    assert.equal(latest.summary.branch, 'main');
    assert.equal(latest.repositoryId !== null, true);
    assert.equal(typeof latest.repository?.['repositoryId'], 'string');
    assert.equal(pollCalls > 0, true);
  } finally {
    client.close();
    await server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('stream server publishes directory git snapshots on repeated directory upserts even when unchanged', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-git-upsert-refresh-'));
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    gitStatus: {
      enabled: true,
      pollMs: 1000,
      maxConcurrency: 1,
      minDirectoryRefreshMs: 1000,
    },
    readGitDirectorySnapshot: () =>
      Promise.resolve({
        summary: {
          branch: 'main',
          changedFiles: 0,
          additions: 0,
          deletions: 0,
        },
        repository: {
          normalizedRemoteUrl: 'https://github.com/example/harness',
          commitCount: 10,
          lastCommitAt: '2026-02-16T00:00:00.000Z',
          shortCommitHash: 'abc1234',
          inferredName: 'harness',
          defaultBranch: 'main',
        },
      }),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-git-upsert-refresh',
      userId: 'user-git-upsert-refresh',
      workspaceId: 'workspace-git-upsert-refresh',
    });

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-git-upsert-refresh',
      tenantId: 'tenant-git-upsert-refresh',
      userId: 'user-git-upsert-refresh',
      workspaceId: 'workspace-git-upsert-refresh',
      path: workspace,
    });
    await delay(80);

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-git-upsert-refresh',
      tenantId: 'tenant-git-upsert-refresh',
      userId: 'user-git-upsert-refresh',
      workspaceId: 'workspace-git-upsert-refresh',
      path: workspace,
    });
    await delay(80);

    const gitEvents = observed.flatMap((envelope) => {
      if (envelope.kind !== 'stream.event') {
        return [];
      }
      if (envelope.event.type !== 'directory-git-updated') {
        return [];
      }
      if (envelope.event.directoryId !== 'directory-git-upsert-refresh') {
        return [];
      }
      return [envelope.event];
    });
    assert.equal(gitEvents.length, 2);
    assert.equal(gitEvents[0]?.repositoryId === null, false);
    assert.equal(gitEvents[1]?.repositoryId === null, false);
    assert.equal(gitEvents[0]?.repositoryId, gitEvents[1]?.repositoryId);
  } finally {
    client.close();
    await server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('stream server deduplicates unchanged git snapshots when using default reader', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-git-default-'));
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    gitStatus: {
      enabled: false,
      pollMs: 100,
      maxConcurrency: 2,
      minDirectoryRefreshMs: 100,
    },
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
      directoryId: 'directory-git-default',
      tenantId: 'tenant-git-default',
      userId: 'user-git-default',
      workspaceId: 'workspace-git-default',
      path: workspace,
    });
    await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-git-default',
      userId: 'user-git-default',
      workspaceId: 'workspace-git-default',
    });

    const internals = server as unknown as {
      stateStore: SqliteControlPlaneStore;
      reloadGitStatusDirectoriesFromStore: () => void;
      pollGitStatus: () => Promise<void>;
      refreshGitStatusForDirectory: (directory: unknown) => Promise<void>;
    };
    internals.reloadGitStatusDirectoriesFromStore();
    await internals.pollGitStatus();

    const directory = internals.stateStore.getDirectory('directory-git-default');
    assert.notEqual(directory, null);
    await internals.refreshGitStatusForDirectory(directory as unknown);
    await delay(20);

    const gitEvents = observed.flatMap((envelope) => {
      if (envelope.kind !== 'stream.event') {
        return [];
      }
      if (envelope.event.type !== 'directory-git-updated') {
        return [];
      }
      return [envelope.event];
    });
    assert.equal(gitEvents.length, 1);
    const latest = gitEvents[0]!;
    assert.equal(latest.directoryId, 'directory-git-default');
    assert.equal(latest.summary.branch, '(not git)');
    assert.equal(latest.repositorySnapshot.commitCount, null);
    assert.equal(latest.repository, null);
  } finally {
    client.close();
    await server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('stream server lists cached directory git status snapshots for startup hydration', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-git-status-list-'));
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    gitStatus: {
      enabled: true,
      pollMs: 60_000,
      maxConcurrency: 1,
      minDirectoryRefreshMs: 60_000,
    },
    readGitDirectorySnapshot: () =>
      Promise.resolve({
        summary: {
          branch: 'main',
          changedFiles: 3,
          additions: 4,
          deletions: 1,
        },
        repository: {
          normalizedRemoteUrl: 'https://github.com/example/harness',
          commitCount: 42,
          lastCommitAt: '2026-02-16T00:00:00.000Z',
          shortCommitHash: '1a2b3c4',
          inferredName: 'harness',
          defaultBranch: 'main',
        },
      }),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-git-status-list-1',
      tenantId: 'tenant-git-status-list-1',
      userId: 'user-git-status-list-1',
      workspaceId: 'workspace-git-status-list-1',
      path: workspace,
    });
    await delay(100);
    const listed = await client.sendCommand({
      type: 'directory.git-status',
      tenantId: 'tenant-git-status-list-1',
      userId: 'user-git-status-list-1',
      workspaceId: 'workspace-git-status-list-1',
    });
    const rowsRaw = listed['gitStatuses'];
    assert.equal(Array.isArray(rowsRaw), true);
    if (!Array.isArray(rowsRaw)) {
      throw new Error('expected gitStatuses array');
    }
    assert.equal(rowsRaw.length, 1);
    const row = rowsRaw[0] as Record<string, unknown>;
    assert.equal(row['directoryId'], 'directory-git-status-list-1');
    const summary = row['summary'] as Record<string, unknown>;
    assert.equal(summary['branch'], 'main');
    assert.equal(summary['changedFiles'], 3);
    const repositorySnapshot = row['repositorySnapshot'] as Record<string, unknown>;
    assert.equal(repositorySnapshot['normalizedRemoteUrl'], 'https://github.com/example/harness');
    assert.equal(repositorySnapshot['commitCount'], 42);
    assert.equal(typeof row['repositoryId'], 'string');
    const repository = row['repository'] as Record<string, unknown>;
    assert.equal(typeof repository['repositoryId'], 'string');
    assert.equal(repository['name'], 'harness');
    assert.equal(typeof row['observedAt'], 'string');
  } finally {
    client.close();
    await server.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('stream server dispatches lifecycle hooks from observed events', async () => {
  const webhookEvents: string[] = [];
  const webhookServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (body.length > 0) {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const eventType = parsed['eventType'];
        if (typeof eventType === 'string') {
          webhookEvents.push(eventType);
        }
      }
      response.statusCode = 200;
      response.end('ok');
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    webhookServer.once('error', rejectListen);
    webhookServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const webhookAddress = webhookServer.address();
  if (webhookAddress === null || typeof webhookAddress === 'string') {
    await new Promise<void>((resolveClose) => {
      webhookServer.close(() => resolveClose());
    });
    throw new Error('webhook server missing tcp address');
  }
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    lifecycleHooks: {
      enabled: true,
      providers: {
        codex: true,
        claude: true,
        cursor: true,
        controlPlane: true,
      },
      peonPing: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:19998',
        timeoutMs: 1200,
        eventCategoryMap: {},
      },
      webhooks: [
        {
          name: 'test-hook',
          enabled: true,
          url: `http://127.0.0.1:${String(webhookAddress.port)}/lifecycle`,
          method: 'POST',
          timeoutMs: 1200,
          headers: {},
          eventTypes: [],
        },
      ],
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-hooks',
      path: '/tmp/hooks',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-hooks',
      directoryId: 'directory-hooks',
      title: 'hooks',
      agentType: 'codex',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-hooks',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await delay(25);
  } finally {
    client.close();
    await server.close();
    await new Promise<void>((resolveClose) => {
      webhookServer.close(() => resolveClose());
    });
  }

  assert.equal(webhookEvents.includes('thread.created'), true);
  assert.equal(webhookEvents.includes('session.started'), true);
});

void test('stream server auto-starts persisted conversations during gateway startup', async () => {
  const stateStorePath = makeTempStateStorePath();
  const seededStore = new SqliteControlPlaneStore(stateStorePath);
  seededStore.upsertDirectory({
    directoryId: 'directory-bootstrap-codex',
    tenantId: 'tenant-bootstrap',
    userId: 'user-bootstrap',
    workspaceId: 'workspace-bootstrap',
    path: '/tmp/bootstrap-codex',
  });
  seededStore.upsertDirectory({
    directoryId: 'directory-bootstrap-terminal',
    tenantId: 'tenant-bootstrap',
    userId: 'user-bootstrap',
    workspaceId: 'workspace-bootstrap',
    path: '/tmp/bootstrap-terminal',
  });
  seededStore.upsertDirectory({
    directoryId: 'directory-bootstrap-standard',
    tenantId: 'tenant-bootstrap',
    userId: 'user-bootstrap',
    workspaceId: 'workspace-bootstrap',
    path: '/tmp/bootstrap-standard',
  });
  seededStore.upsertDirectory({
    directoryId: 'directory-bootstrap-archived',
    tenantId: 'tenant-bootstrap',
    userId: 'user-bootstrap',
    workspaceId: 'workspace-bootstrap',
    path: '/tmp/bootstrap-archived',
  });
  seededStore.createConversation({
    conversationId: 'conversation-bootstrap-codex',
    directoryId: 'directory-bootstrap-codex',
    title: 'codex bootstrap',
    agentType: 'codex',
    adapterState: {
      codex: {
        resumeSessionId: 'thread-bootstrap-codex',
      },
    },
  });
  seededStore.createConversation({
    conversationId: 'conversation-bootstrap-terminal',
    directoryId: 'directory-bootstrap-terminal',
    title: 'terminal bootstrap',
    agentType: 'terminal',
  });
  seededStore.createConversation({
    conversationId: 'conversation-bootstrap-standard',
    directoryId: 'directory-bootstrap-standard',
    title: 'standard bootstrap',
    agentType: 'codex',
    adapterState: {
      codex: {
        resumeSessionId: 'thread-bootstrap-standard',
      },
    },
  });
  seededStore.createConversation({
    conversationId: 'conversation-bootstrap-archived',
    directoryId: 'directory-bootstrap-archived',
    title: 'archived bootstrap',
    agentType: 'codex',
    adapterState: {
      codex: {
        resumeSessionId: 'thread-bootstrap-archived',
      },
    },
  });
  seededStore.archiveConversation('conversation-bootstrap-archived');
  seededStore.close();

  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    stateStorePath,
    codexLaunch: {
      defaultMode: 'yolo',
      directoryModes: {
        '/tmp/bootstrap-standard': 'standard',
      },
    },
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  try {
    assert.equal(sessions.length, 3);
    const codex = sessions.find((session) => session.input.cwd === '/tmp/bootstrap-codex');
    if (codex === undefined) {
      throw new Error('expected codex bootstrap session');
    }
    assert.deepEqual(codex.input.args, ['resume', 'thread-bootstrap-codex', '--yolo']);
    assert.equal(codex.input.initialCols, 80);
    assert.equal(codex.input.initialRows, 24);

    const standardCodex = sessions.find(
      (session) => session.input.cwd === '/tmp/bootstrap-standard',
    );
    if (standardCodex === undefined) {
      throw new Error('expected standard codex bootstrap session');
    }
    assert.deepEqual(standardCodex.input.args, ['resume', 'thread-bootstrap-standard']);

    const terminal = sessions.find((session) => session.input.cwd === '/tmp/bootstrap-terminal');
    if (terminal === undefined) {
      throw new Error('expected terminal bootstrap session');
    }
    assert.equal(
      terminal.input.command,
      resolveTerminalCommandForEnvironment(process.env, process.platform),
    );
    assert.deepEqual(terminal.input.baseArgs, []);
    assert.deepEqual(terminal.input.args, []);
    assert.equal(terminal.input.initialCols, 80);
    assert.equal(terminal.input.initialRows, 24);

    assert.equal(
      sessions.some((session) => session.input.args.includes('thread-bootstrap-archived')),
      false,
    );

    const listed = await client.sendCommand({
      type: 'session.list',
      tenantId: 'tenant-bootstrap',
      userId: 'user-bootstrap',
      workspaceId: 'workspace-bootstrap',
      sort: 'started-asc',
    });
    const listedRows = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(listedRows.length, 3);
    assert.deepEqual(listedRows.map((row) => row['sessionId']).sort(), [
      'conversation-bootstrap-codex',
      'conversation-bootstrap-standard',
      'conversation-bootstrap-terminal',
    ]);
    assert.equal(
      listedRows.every((row) => row['live'] === true),
      true,
    );
  } finally {
    client.close();
    await server.close();
    rmSync(stateStorePath, { force: true });
    rmSync(dirname(stateStorePath), { recursive: true, force: true });
  }
});

void test('stream server starts critique sessions through bunx when auto-install is enabled', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    critique: {
      launch: {
        defaultArgs: ['--watch'],
      },
      install: {
        autoInstall: true,
        package: 'critique@latest',
      },
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-critique',
      tenantId: 'tenant-critique',
      userId: 'user-critique',
      workspaceId: 'workspace-critique',
      path: '/tmp/critique',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-critique',
      directoryId: 'directory-critique',
      title: 'critique thread',
      agentType: 'critique',
      adapterState: {},
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-critique',
      args: [],
      initialCols: 100,
      initialRows: 40,
      tenantId: 'tenant-critique',
      userId: 'user-critique',
      workspaceId: 'workspace-critique',
      worktreeId: 'worktree-critique',
    });
    assert.equal(created.length, 1);
    assert.equal(created[0]?.input.command, 'bunx');
    assert.deepEqual(created[0]?.input.args, ['critique@latest', '--watch']);
    assert.deepEqual(created[0]?.input.baseArgs, []);

    const status = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-critique',
    });
    assert.equal(status['launchCommand'], 'bunx critique@latest --watch');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server starts critique sessions directly when auto-install is disabled', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    critique: {
      launch: {
        defaultArgs: ['--watch'],
      },
      install: {
        autoInstall: false,
        package: 'critique@latest',
      },
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-critique-present',
      tenantId: 'tenant-critique',
      userId: 'user-critique',
      workspaceId: 'workspace-critique',
      path: '/tmp/critique-present',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-critique-present',
      directoryId: 'directory-critique-present',
      title: 'critique thread present',
      agentType: 'critique',
      adapterState: {},
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-critique-present',
      args: [],
      initialCols: 100,
      initialRows: 40,
      tenantId: 'tenant-critique',
      userId: 'user-critique',
      workspaceId: 'workspace-critique',
      worktreeId: 'worktree-critique',
    });
    assert.equal(created.length, 1);
    assert.equal(created[0]?.input.command, 'critique');
    assert.deepEqual(created[0]?.input.args, ['--watch']);
    assert.deepEqual(created[0]?.input.baseArgs, []);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server supports start/attach/io/events/cleanup over one protocol path', async () => {
  const created: FakeLiveSession[] = [];
  const startSession = (input: StartControlPlaneSessionInput): FakeLiveSession => {
    const session = new FakeLiveSession(input);
    created.push(session);
    return session;
  };

  assert.throws(() => {
    return new ControlPlaneStreamServer();
  }, /startSession is required/);

  const coldServer = new ControlPlaneStreamServer({
    startSession,
  });
  assert.throws(() => {
    coldServer.address();
  }, /not listening/);
  await coldServer.start();
  await coldServer.start();
  const coldAddress = coldServer.address();
  assert.equal(coldServer.telemetryAddressInfo(), null);

  const clientA = await connectControlPlaneStreamClient({
    host: coldAddress.address,
    port: coldAddress.port,
  });
  const clientB = await connectControlPlaneStreamClient({
    host: coldAddress.address,
    port: coldAddress.port,
  });

  try {
    await clientA.authenticate('ignored-token');

    const observedA = collectEnvelopes(clientA);
    const observedB = collectEnvelopes(clientB);

    await writeRaw(
      { host: coldAddress.address, port: coldAddress.port },
      'not-json\n{"kind":"unknown"}\n',
    );

    await clientA.sendCommand({
      type: 'pty.start',
      sessionId: 'session-1',
      args: ['--model', 'gpt-5.3-codex'],
      cwd: '/tmp/session-1',
      initialCols: 90,
      initialRows: 30,
      env: {
        TERM: 'xterm-256color',
      },
      terminalForegroundHex: 'd0d7de',
      terminalBackgroundHex: '0f1419',
    });

    assert.equal(created.length, 1);
    assert.equal(created[0]!.input.initialCols, 90);
    assert.equal(created[0]!.input.cwd, '/tmp/session-1');

    await clientA.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-1',
    });

    const attachResult = await clientB.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-1',
      sinceCursor: 1,
    });
    assert.deepEqual(attachResult, {
      latestCursor: 2,
    });

    await delay(10);
    assert.equal(
      observedB.some(
        (envelope) =>
          envelope.kind === 'pty.output' &&
          Buffer.from(envelope.chunkBase64, 'base64').toString('utf8') === 'warmup-2',
      ),
      true,
    );

    clientB.sendInput('session-1', Buffer.from('typed', 'utf8'));
    await delay(5);
    assert.equal(
      created[0]!.writes.some((chunk) => chunk.toString('utf8') === 'typed'),
      true,
    );

    clientB.sendResize('session-1', 120, 40);
    await delay(5);
    assert.deepEqual(created[0]!.resizeCalls, [{ cols: 120, rows: 40 }]);

    clientB.sendSignal('session-1', 'interrupt');
    clientB.sendSignal('session-1', 'eof');
    await delay(5);
    assert.equal(
      created[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'),
      true,
    );
    assert.equal(
      created[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0004'),
      true,
    );
    const statusAfterInterruptSignal = await clientA.sendCommand({
      type: 'session.status',
      sessionId: 'session-1',
    });
    assert.equal(statusAfterInterruptSignal['status'], 'completed');

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-01-01T00:00:02.000Z',
        payload: {
          type: 'agent-turn-complete',
        },
      },
    });
    await delay(10);
    assert.equal(
      observedA.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.event.type === 'notify' &&
          envelope.event.record.payload['type'] === 'agent-turn-complete',
      ),
      true,
    );
    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-01-01T00:00:03.000Z',
        payload: {
          type: 'agent-turn-progress',
        },
      },
    });
    await delay(10);
    assert.equal(
      observedA.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.event.type === 'notify' &&
          envelope.event.record.payload['type'] === 'agent-turn-progress',
      ),
      true,
    );
    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-01-01T00:00:04.000Z',
        payload: {
          type: 42,
        },
      },
    });
    await delay(10);
    assert.equal(
      observedA.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.event.type === 'notify' &&
          envelope.event.record.payload['type'] === 42,
      ),
      true,
    );
    const statusAfterProgressNotify = await clientA.sendCommand({
      type: 'session.status',
      sessionId: 'session-1',
    });
    assert.equal(statusAfterProgressNotify['status'], 'completed');

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-01-01T00:00:03.000Z',
        payload: {
          type: 'agent-heartbeat',
        },
      },
    });
    await delay(10);
    assert.equal(
      observedA.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.event.type === 'notify' &&
          envelope.event.record.payload['type'] === 'agent-heartbeat',
      ),
      true,
    );

    created[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: '2026-01-01T00:00:04.000Z',
        payload: {
          type: 7,
        },
      },
    });
    await delay(10);
    assert.equal(
      observedA.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.event.type === 'notify' &&
          envelope.event.record.payload['type'] === 7,
      ),
      true,
    );

    await writeRaw(
      { host: coldAddress.address, port: coldAddress.port },
      `${encodeStreamEnvelope({
        kind: 'pty.input',
        sessionId: 'session-1',
        dataBase64: '%%%',
      })}`,
    );

    await clientB.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-1',
    });
    assert.equal(created[0]!.attachmentCount(), 0);

    await clientB.sendCommand({
      type: 'pty.unsubscribe-events',
      sessionId: 'session-1',
    });
    const ptyEventCountA = observedA.filter((envelope) => envelope.kind === 'pty.event').length;
    const ptyEventCountB = observedB.filter((envelope) => envelope.kind === 'pty.event').length;

    created[0]!.emitEvent({
      type: 'terminal-output',
      cursor: 99,
      chunk: Buffer.from('ignored', 'utf8'),
    });

    await delay(10);
    assert.equal(
      observedA.filter((envelope) => envelope.kind === 'pty.event').length,
      ptyEventCountA,
    );
    assert.equal(
      observedB.filter((envelope) => envelope.kind === 'pty.event').length,
      ptyEventCountB,
    );

    created[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(10);

    assert.equal(
      observedA.some(
        (envelope) => envelope.kind === 'pty.event' && envelope.event.type === 'session-exit',
      ),
      true,
    );

    const statusAfterExit = await clientA.sendCommand({
      type: 'session.status',
      sessionId: 'session-1',
    });
    assert.equal(statusAfterExit['status'], 'exited');

    const writesBeforeExitedInput = created[0]!.writes.length;
    const resizeBeforeExitedInput = created[0]!.resizeCalls.length;
    clientA.sendInput('session-1', Buffer.from('ignored-after-exit', 'utf8'));
    clientA.sendResize('session-1', 200, 50);
    clientA.sendSignal('session-1', 'interrupt');
    await delay(10);
    assert.equal(created[0]!.writes.length, writesBeforeExitedInput);
    assert.equal(created[0]!.resizeCalls.length, resizeBeforeExitedInput);

    await assert.rejects(
      clientA.sendCommand({
        type: 'pty.close',
        sessionId: 'session-1',
      }),
      /session is not live/,
    );
    const removedAfterExit = await clientA.sendCommand({
      type: 'session.remove',
      sessionId: 'session-1',
    });
    assert.equal(removedAfterExit['removed'], true);

    await clientA.sendCommand({
      type: 'pty.start',
      sessionId: 'session-2',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    assert.equal(created.length, 2);
    clientA.sendSignal('session-2', 'terminate');
    for (let attempt = 0; attempt < 20 && !created[1]!.isClosed(); attempt += 1) {
      await delay(10);
    }
    assert.equal(created[1]!.isClosed(), true);

    await assert.rejects(
      clientA.sendCommand({
        type: 'pty.attach',
        sessionId: 'missing-session',
        sinceCursor: 0,
      }),
      /session not found/,
    );

    await clientA.sendCommand({
      type: 'pty.detach',
      sessionId: 'missing-session',
    });

    await clientA.sendCommand({
      type: 'pty.start',
      sessionId: 'session-3',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await assert.rejects(
      clientA.sendCommand({
        type: 'pty.start',
        sessionId: 'session-3',
        args: [],
        initialCols: 80,
        initialRows: 24,
      }),
      /session already exists/,
    );
  } finally {
    clientA.close();
    clientB.close();
    await coldServer.close();
    await coldServer.close();
  }
});

void test('startControlPlaneStreamServer helper starts a ready server', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  assert.equal(typeof address.port, 'number');

  const socket = await new Promise<Socket>((resolve, reject) => {
    const client = connect(address.port, address.address, () => resolve(client));
    client.once('error', reject);
  });
  socket.end();

  await server.close();
});

void test('stream server supports session.list, session.status, and session.snapshot', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const internals = server as unknown as {
    sessions: Map<
      string,
      {
        session: FakeLiveSession | null;
      }
    >;
  };
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    const initialList = await client.sendCommand({
      type: 'session.list',
    });
    assert.deepEqual(initialList['sessions'], []);

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-list',
      args: [],
      initialCols: 80,
      initialRows: 24,
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      worktreeId: 'worktree-a',
    });
    await delay(2);

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-list-2',
      args: [],
      initialCols: 80,
      initialRows: 24,
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      worktreeId: 'worktree-b',
    });
    await delay(2);

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-list-3',
      args: [],
      initialCols: 80,
      initialRows: 24,
      tenantId: 'tenant-b',
      userId: 'user-b',
      workspaceId: 'workspace-b',
      worktreeId: 'worktree-c',
    });

    const listed = await client.sendCommand({
      type: 'session.list',
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      sort: 'started-asc',
    });
    assert.equal(Array.isArray(listed['sessions']), true);
    const sessionEntries = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(sessionEntries.length, 2);
    assert.equal(sessionEntries[0]?.['sessionId'], 'session-list');
    assert.equal(sessionEntries[0]?.['tenantId'], 'tenant-a');
    assert.equal(sessionEntries[0]?.['workspaceId'], 'workspace-a');
    assert.equal(sessionEntries[0]?.['status'], 'running');
    assert.equal(typeof sessionEntries[0]?.['processId'], 'number');
    assert.equal(sessionEntries[0]?.['launchCommand'], 'codex');
    assert.equal(sessionEntries[1]?.['sessionId'], 'session-list-2');

    const limited = await client.sendCommand({
      type: 'session.list',
      sort: 'started-desc',
      limit: 1,
    });
    const limitedEntries = limited['sessions'] as Array<Record<string, unknown>>;
    assert.equal(limitedEntries.length, 1);
    assert.equal(limitedEntries[0]?.['sessionId'], 'session-list-3');

    const filteredByWorktree = await client.sendCommand({
      type: 'session.list',
      worktreeId: 'worktree-b',
    });
    const worktreeEntries = filteredByWorktree['sessions'] as Array<Record<string, unknown>>;
    assert.equal(worktreeEntries.length, 1);
    assert.equal(worktreeEntries[0]?.['sessionId'], 'session-list-2');

    const filteredByUser = await client.sendCommand({
      type: 'session.list',
      userId: 'missing-user',
    });
    assert.deepEqual(filteredByUser['sessions'], []);

    const filteredByWorkspace = await client.sendCommand({
      type: 'session.list',
      workspaceId: 'missing-workspace',
    });
    assert.deepEqual(filteredByWorkspace['sessions'], []);

    const filteredByStatus = await client.sendCommand({
      type: 'session.list',
      status: 'exited',
    });
    assert.deepEqual(filteredByStatus['sessions'], []);

    const filteredByLive = await client.sendCommand({
      type: 'session.list',
      live: false,
    });
    assert.deepEqual(filteredByLive['sessions'], []);

    const status = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-list',
    });
    assert.equal(status['sessionId'], 'session-list');
    assert.equal(status['status'], 'running');
    assert.equal(typeof status['processId'], 'number');
    assert.equal(status['launchCommand'], 'codex');

    const snapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-list',
    });
    assert.equal(snapshot['sessionId'], 'session-list');
    const snapshotRecord = snapshot['snapshot'] as Record<string, unknown>;
    assert.equal(typeof snapshotRecord['frameHash'], 'string');
    assert.equal(Array.isArray(snapshotRecord['lines']), true);

    const tailInput = Array.from({ length: 30 }, (_, index) =>
      `line-${String(index + 1).padStart(2, '0')}`,
    ).join('\r\n');
    client.sendInput('session-list', Buffer.from(`\r\n${tailInput}`, 'utf8'));
    await delay(2);
    const tailedSnapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-list',
      tailLines: 2,
    });
    const tailedBuffer = tailedSnapshot['buffer'] as Record<string, unknown>;
    assert.deepEqual(tailedBuffer['lines'], ['line-29', 'line-30']);
    assert.equal(typeof tailedBuffer['totalRows'], 'number');
    assert.equal(
      tailedBuffer['startRow'],
      (tailedBuffer['totalRows'] as number) - (tailedBuffer['lines'] as string[]).length,
    );

    const sessionState = internals.sessions.get('session-list');
    assert.notEqual(sessionState, undefined);
    assert.notEqual(sessionState?.session, null);
    (sessionState!.session as unknown as { bufferTail?: undefined }).bufferTail = undefined;
    const fallbackTailedSnapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-list',
      tailLines: 2,
    });
    assert.deepEqual((fallbackTailedSnapshot['buffer'] as Record<string, unknown>)['lines'], [
      'line-29',
      'line-30',
    ]);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server list/query options apply tenant scoping and snapshot replay covers stale/null branches', async () => {
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
      directoryId: 'directory-scope-a',
      tenantId: 'tenant-scope',
      userId: 'user-scope',
      workspaceId: 'workspace-scope',
      path: '/tmp/scope-a',
    });
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-scope-b',
      tenantId: 'tenant-other',
      userId: 'user-other',
      workspaceId: 'workspace-other',
      path: '/tmp/scope-b',
    });

    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-scope-a',
      directoryId: 'directory-scope-a',
      title: 'scope-a',
      agentType: 'codex',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-scope-b',
      directoryId: 'directory-scope-b',
      title: 'scope-b',
      agentType: 'codex',
    });
    const generatedDirectory = await client.sendCommand({
      type: 'directory.upsert',
      path: '/tmp/scope-generated',
    });
    const generatedDirectoryId = (generatedDirectory['directory'] as Record<string, unknown>)[
      'directoryId'
    ] as string;
    assert.equal(generatedDirectoryId.startsWith('directory-'), true);
    const generatedConversation = await client.sendCommand({
      type: 'conversation.create',
      directoryId: generatedDirectoryId,
      title: 'scope-generated',
      agentType: 'codex',
    });
    const generatedConversationId = (
      generatedConversation['conversation'] as Record<string, unknown>
    )['conversationId'] as string;
    assert.equal(generatedConversationId.startsWith('conversation-'), true);

    const scopedDirectories = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-scope',
      userId: 'user-scope',
      workspaceId: 'workspace-scope',
      limit: 1,
    });
    const directoryRows = scopedDirectories['directories'] as Array<Record<string, unknown>>;
    assert.equal(directoryRows.length, 1);
    assert.equal(directoryRows[0]?.['directoryId'], 'directory-scope-a');

    const scopedConversations = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-scope-a',
      tenantId: 'tenant-scope',
      userId: 'user-scope',
      workspaceId: 'workspace-scope',
      limit: 1,
    });
    const conversationRows = scopedConversations['conversations'] as Array<Record<string, unknown>>;
    assert.equal(conversationRows.length, 1);
    assert.equal(conversationRows[0]?.['conversationId'], 'conversation-scope-a');

    const replaySubscription = await client.sendCommand({
      type: 'stream.subscribe',
      includeOutput: false,
      directoryId: 'directory-scope-a',
      afterCursor: Number.MAX_SAFE_INTEGER,
    });
    const replaySubscriptionId = replaySubscription['subscriptionId'];
    assert.equal(typeof replaySubscriptionId, 'string');
    await delay(20);
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' && envelope.subscriptionId === replaySubscriptionId,
      ),
      false,
    );
    const defaultSubscription = await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-scope-a',
    });
    const defaultSubscriptionId = defaultSubscription['subscriptionId'];
    assert.equal(typeof defaultSubscriptionId, 'string');
    await client.sendCommand({
      type: 'stream.unsubscribe',
      subscriptionId: defaultSubscriptionId as string,
    });

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-duplicate-running',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'pty.start',
          sessionId: 'session-duplicate-running',
          args: [],
          initialCols: 80,
          initialRows: 24,
        }),
      /session already exists: session-duplicate-running/,
    );

    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-needs-input-seed',
      directoryId: 'directory-scope-a',
      title: 'needs-input seed',
      agentType: 'codex',
    });
    const statefulInternals = server as unknown as {
      stateStore: {
        updateConversationRuntime: (
          conversationId: string,
          runtime: {
            status: 'needs-input';
            live: boolean;
            attentionReason: string | null;
            processId: number | null;
            lastEventAt: string | null;
            lastExit: null;
          },
        ) => void;
      };
    };
    statefulInternals.stateStore.updateConversationRuntime('conversation-needs-input-seed', {
      status: 'needs-input',
      live: false,
      attentionReason: 'approval needed',
      processId: null,
      lastEventAt: null,
      lastExit: null,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-needs-input-seed',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    const seededNeedsInputStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-needs-input-seed',
    });
    assert.equal(seededNeedsInputStatus['status'], 'needs-input');
    assert.equal(seededNeedsInputStatus['attentionReason'], 'approval needed');

    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-needs-input-null-reason',
      directoryId: 'directory-scope-a',
      title: 'needs-input null reason',
      agentType: 'codex',
    });
    statefulInternals.stateStore.updateConversationRuntime('conversation-needs-input-null-reason', {
      status: 'needs-input',
      live: false,
      attentionReason: null,
      processId: null,
      lastEventAt: null,
      lastExit: null,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-needs-input-null-reason',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    const seededNeedsInputNullReason = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-needs-input-null-reason',
    });
    assert.equal(seededNeedsInputNullReason['status'], 'needs-input');
    assert.equal(seededNeedsInputNullReason['attentionReason'], null);

    const internals = server as unknown as {
      sessions: Map<
        string,
        {
          id: string;
          directoryId: string | null;
          agentType: string;
          adapterState: Record<string, unknown>;
          tenantId: string;
          userId: string;
          workspaceId: string;
          worktreeId: string;
          session: null;
          eventSubscriberConnectionIds: Set<string>;
          attachmentByConnectionId: Map<string, string>;
          unsubscribe: null;
          status: 'completed';
          attentionReason: null;
          lastEventAt: string | null;
          lastExit: null;
          lastSnapshot: Record<string, unknown> | null;
          startedAt: string;
          exitedAt: string | null;
          tombstoneTimer: NodeJS.Timeout | null;
          lastObservedOutputCursor: number;
          latestTelemetry: null;
        }
      >;
    };
    internals.sessions.set('session-snapshot-missing', {
      id: 'session-snapshot-missing',
      directoryId: 'directory-scope-a',
      agentType: 'codex',
      adapterState: {},
      tenantId: 'tenant-scope',
      userId: 'user-scope',
      workspaceId: 'workspace-scope',
      worktreeId: 'worktree-scope',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      status: 'completed',
      attentionReason: null,
      lastEventAt: null,
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: new Date(0).toISOString(),
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
      latestTelemetry: null,
    });
    await assert.rejects(
      () =>
        client.sendCommand({
          type: 'session.snapshot',
          sessionId: 'session-snapshot-missing',
        }),
      /session snapshot unavailable: session-snapshot-missing/,
    );

    internals.sessions.get('session-snapshot-missing')!.lastSnapshot = {
      lines: ['line-1', 'line-2', 'line-3'],
      frameHash: 'stale-hash',
      cursorRow: 0,
      cursorCol: 0,
      viewport: {
        totalRows: 5,
      },
    };
    const staleSnapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-snapshot-missing',
      tailLines: 2,
    });
    assert.equal(staleSnapshot['sessionId'], 'session-snapshot-missing');
    assert.equal(staleSnapshot['stale'], true);
    assert.deepEqual(staleSnapshot['buffer'], {
      totalRows: 5,
      startRow: 3,
      lines: ['line-2', 'line-3'],
    });

    internals.sessions.get('session-snapshot-missing')!.lastSnapshot = {
      lines: 'invalid',
      frameHash: 'stale-hash-invalid',
      cursorRow: 0,
      cursorCol: 0,
      viewport: 'invalid',
    };
    const malformedStaleSnapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-snapshot-missing',
      tailLines: 3,
    });
    assert.deepEqual(malformedStaleSnapshot['buffer'], {
      totalRows: 0,
      startRow: 0,
      lines: [],
    });
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server persists directories and conversations and replays scoped stream subscriptions', async () => {
  const stateStorePath = makeTempStateStorePath();
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    stateStorePath,
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observed = collectEnvelopes(client);

  try {
    const upsertDirectory = await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      path: '/tmp/workspace-1',
    });
    const directory = upsertDirectory['directory'] as Record<string, unknown>;
    assert.equal(directory['directoryId'], 'directory-1');

    const createdConversation = await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-1',
      directoryId: 'directory-1',
      title: 'untitled task 1',
      agentType: 'codex',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-seed',
        },
      },
    });
    const conversation = createdConversation['conversation'] as Record<string, unknown>;
    assert.equal(conversation['conversationId'], 'conversation-1');
    assert.deepEqual(conversation['adapterState'], {
      codex: {
        resumeSessionId: 'thread-seed',
      },
    });

    const subscribedWithoutOutput = await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-1',
      includeOutput: false,
      afterCursor: 0,
    });
    const subscriptionWithoutOutput = subscribedWithoutOutput['subscriptionId'];
    assert.equal(typeof subscriptionWithoutOutput, 'string');

    const updatedConversation = await client.sendCommand({
      type: 'conversation.update',
      conversationId: 'conversation-1',
      title: 'renamed task 1',
    });
    const updatedConversationRecord = updatedConversation['conversation'] as Record<
      string,
      unknown
    >;
    assert.equal(updatedConversationRecord['title'], 'renamed task 1');
    await delay(20);

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-1',
      args: [],
      initialCols: 80,
      initialRows: 24,
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      worktreeId: 'worktree-1',
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'conversation-1',
      sinceCursor: 2,
    });
    client.sendInput('conversation-1', Buffer.from('hello-stream', 'utf8'));
    await delay(20);

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithoutOutput &&
          envelope.event.type === 'session-output',
      ),
      false,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithoutOutput &&
          envelope.event.type === 'conversation-updated',
      ),
      true,
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithoutOutput &&
          envelope.event.type === 'session-status',
      ),
      true,
    );

    const subscribedWithOutput = await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-1',
      includeOutput: true,
      afterCursor: 0,
    });
    const subscriptionWithOutput = subscribedWithOutput['subscriptionId'];
    assert.equal(typeof subscriptionWithOutput, 'string');
    await delay(20);
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithOutput &&
          envelope.event.type === 'session-output',
      ),
      true,
    );

    await client.sendCommand({
      type: 'stream.unsubscribe',
      subscriptionId: subscriptionWithOutput as string,
    });
    const previousObservedCount = observed.length;
    client.sendInput('conversation-1', Buffer.from('after-unsubscribe', 'utf8'));
    await delay(20);
    assert.equal(
      observed
        .slice(previousObservedCount)
        .some(
          (envelope) =>
            envelope.kind === 'stream.event' && envelope.subscriptionId === subscriptionWithOutput,
        ),
      false,
    );

    await client.sendCommand({
      type: 'conversation.archive',
      conversationId: 'conversation-1',
    });
    const listedAfterUpdate = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true,
    });
    const updatedRows = listedAfterUpdate['conversations'] as Array<Record<string, unknown>>;
    assert.deepEqual(updatedRows[0]?.['adapterState'], {
      codex: {
        resumeSessionId: 'thread-seed',
      },
    });

    await client.sendCommand({
      type: 'conversation.delete',
      conversationId: 'conversation-1',
    });
    await assert.rejects(
      client.sendCommand({
        type: 'conversation.delete',
        conversationId: 'conversation-1',
      }),
      /conversation not found/,
    );
    await assert.rejects(
      client.sendCommand({
        type: 'conversation.update',
        conversationId: 'conversation-1',
        title: 'missing',
      }),
      /conversation not found/,
    );
    const listedAfterDelete = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true,
    });
    assert.deepEqual(listedAfterDelete['conversations'], []);

    const listedArchived = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true,
    });
    assert.deepEqual(listedArchived['conversations'], []);
  } finally {
    client.close();
    await server.close();
  }

  const reopened = await startControlPlaneStreamServer({
    stateStorePath,
    startSession: (input) => new FakeLiveSession(input),
  });
  const reopenedAddress = reopened.address();
  const reopenedClient = await connectControlPlaneStreamClient({
    host: reopenedAddress.address,
    port: reopenedAddress.port,
  });
  try {
    const directories = await reopenedClient.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      includeArchived: true,
    });
    const directoryRows = directories['directories'] as Array<Record<string, unknown>>;
    assert.equal(directoryRows.length, 1);
    assert.equal(directoryRows[0]?.['directoryId'], 'directory-1');

    const conversations = await reopenedClient.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true,
    });
    const conversationRows = conversations['conversations'] as Array<Record<string, unknown>>;
    assert.equal(conversationRows.length, 0);
  } finally {
    reopenedClient.close();
    await reopened.close();
    rmSync(stateStorePath, { force: true });
    rmSync(dirname(stateStorePath), { recursive: true, force: true });
  }
});
