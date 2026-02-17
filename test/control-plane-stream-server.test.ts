import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { connect, type Socket } from 'node:net';
import { createServer, request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ControlPlaneStreamServer,
  resolveTerminalCommandForEnvironment,
  streamServerTestInternals,
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../src/control-plane/stream-server.ts';
import {
  connectControlPlaneStreamClient,
  type ControlPlaneStreamClient,
} from '../src/control-plane/stream-client.ts';
import {
  encodeStreamEnvelope,
  type StreamServerEnvelope,
} from '../src/control-plane/stream-protocol.ts';
import type { CodexLiveEvent } from '../src/codex/live-session.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

class FakeLiveSession {
  private static nextProcessId = 51000;
  readonly input: StartControlPlaneSessionInput;
  readonly writes: Buffer[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  readonly processIdValue: number;

  private readonly attachments = new Map<string, SessionAttachHandlers>();
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private readonly backlog: SessionDataEvent[];
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private closed = false;
  private nextAttachmentId = 1;
  private latestCursor = 0;

  constructor(input: StartControlPlaneSessionInput) {
    this.input = input;
    this.processIdValue = FakeLiveSession.nextProcessId;
    FakeLiveSession.nextProcessId += 1;
    this.snapshotOracle = new TerminalSnapshotOracle(input.initialCols, input.initialRows);
    this.backlog = [
      {
        cursor: 1,
        chunk: Buffer.from('warmup-1', 'utf8'),
      },
      {
        cursor: 2,
        chunk: Buffer.from('warmup-2', 'utf8'),
      },
    ];
    this.latestCursor = 2;
    for (const entry of this.backlog) {
      this.snapshotOracle.ingest(entry.chunk);
    }
  }

  attach(handlers: SessionAttachHandlers, sinceCursor = 0): string {
    const attachmentId = `attachment-${this.nextAttachmentId}`;
    this.nextAttachmentId += 1;
    this.attachments.set(attachmentId, handlers);

    for (const event of this.backlog) {
      if (event.cursor <= sinceCursor) {
        continue;
      }
      handlers.onData({
        cursor: event.cursor,
        chunk: Buffer.from(event.chunk),
      });
    }

    return attachmentId;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  latestCursorValue(): number {
    return this.latestCursor;
  }

  processId(): number | null {
    return this.processIdValue;
  }

  write(data: string | Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.writes.push(chunk);
    this.snapshotOracle.ingest(chunk);

    this.latestCursor += 1;
    const event = {
      cursor: this.latestCursor,
      chunk,
    };
    for (const handlers of this.attachments.values()) {
      handlers.onData(event);
    }
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
    this.snapshotOracle.resize(cols, rows);
  }

  snapshot() {
    return this.snapshotOracle.snapshot();
  }

  close(): void {
    this.closed = true;
  }

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  attachmentCount(): number {
    return this.attachments.size;
  }

  isClosed(): boolean {
    return this.closed;
  }

  emitEvent(event: CodexLiveEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  emitExit(exit: PtyExit): void {
    for (const handlers of this.attachments.values()) {
      handlers.onExit(exit);
    }
    this.emitEvent({
      type: 'session-exit',
      exit,
    });
  }
}

function collectEnvelopes(client: ControlPlaneStreamClient): StreamServerEnvelope[] {
  const envelopes: StreamServerEnvelope[] = [];
  client.onEnvelope((envelope) => {
    envelopes.push(envelope);
  });
  return envelopes;
}

async function writeRaw(address: { host: string; port: number }, lines: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(address.port, address.host, () => {
      socket.end(lines);
    });
    socket.once('close', () => resolve());
    socket.once('error', reject);
  });
}

async function postJson(
  address: { host: string; port: number },
  path: string,
  payload: unknown,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = httpRequest(
      {
        host: address.host,
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.once('error', reject);
    req.write(body);
    req.end();
  });
}

async function postRaw(
  address: { host: string; port: number },
  path: string,
  method: string,
  body: string,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: address.host,
        port: address.port,
        path,
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.once('error', reject);
    req.write(body);
    req.end();
  });
}

function makeTempStateStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-stream-server-'));
  return join(dir, 'control-plane.sqlite');
}

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

void test(
  'stream server lists cached directory git status snapshots for startup hydration',
  async () => {
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
  },
);

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
    assert.equal(sessions.length, 2);
    const codex = sessions.find((session) => session.input.cwd === '/tmp/bootstrap-codex');
    if (codex === undefined) {
      throw new Error('expected codex bootstrap session');
    }
    assert.deepEqual(codex.input.args, ['resume', 'thread-bootstrap-codex']);
    assert.equal(codex.input.initialCols, 80);
    assert.equal(codex.input.initialRows, 24);

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
    assert.equal(listedRows.length, 2);
    assert.deepEqual(listedRows.map((row) => row['sessionId']).sort(), [
      'conversation-bootstrap-codex',
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

    const snapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-list',
    });
    assert.equal(snapshot['sessionId'], 'session-list');
    const snapshotRecord = snapshot['snapshot'] as Record<string, unknown>;
    assert.equal(typeof snapshotRecord['frameHash'], 'string');
    assert.equal(Array.isArray(snapshotRecord['lines']), true);
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
      lines: [],
      frameHash: 'stale-hash',
      cursorRow: 0,
      cursorCol: 0,
    };
    const staleSnapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-snapshot-missing',
    });
    assert.equal(staleSnapshot['sessionId'], 'session-snapshot-missing');
    assert.equal(staleSnapshot['stale'], true);
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

void test('stream server archives directories and excludes archived rows from default list', async () => {
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
      type: 'stream.subscribe',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      includeOutput: false,
      afterCursor: 0,
    });

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-archive',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      path: '/tmp/archive-me',
    });

    const archived = await client.sendCommand({
      type: 'directory.archive',
      directoryId: 'directory-archive',
    });
    const archivedDirectory = archived['directory'] as Record<string, unknown>;
    assert.equal(archivedDirectory['directoryId'], 'directory-archive');
    assert.equal(typeof archivedDirectory['archivedAt'], 'string');

    const defaultListed = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
    });
    assert.deepEqual(defaultListed['directories'], []);

    const listedWithArchived = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      includeArchived: true,
    });
    const rows = listedWithArchived['directories'] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.['directoryId'], 'directory-archive');
    assert.equal(typeof rows[0]?.['archivedAt'], 'string');

    await assert.rejects(
      client.sendCommand({
        type: 'conversation.create',
        conversationId: 'conversation-archived-directory',
        directoryId: 'directory-archive',
        title: 'should fail',
        agentType: 'codex',
      }),
      /directory not found/,
    );

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' && envelope.event.type === 'directory-archived',
      ),
      true,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server attention-first sorting falls back to recency when statuses tie', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-a',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await delay(2);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-b',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    const listed = await client.sendCommand({
      type: 'session.list',
      sort: 'attention-first',
    });
    const entries = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.['sessionId'], 'conversation-b');
    assert.equal(entries[0]?.['status'], 'running');
    assert.equal(entries[1]?.['sessionId'], 'conversation-a');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server internal sort helper covers tie-break branches', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  try {
    interface InternalSessionState {
      id: string;
      directoryId: string | null;
      tenantId: string;
      userId: string;
      workspaceId: string;
      worktreeId: string;
      session: FakeLiveSession | null;
      eventSubscriberConnectionIds: Set<string>;
      attachmentByConnectionId: Map<string, string>;
      unsubscribe: (() => void) | null;
      status: 'running' | 'needs-input' | 'completed' | 'exited';
      attentionReason: string | null;
      lastEventAt: string | null;
      lastExit: PtyExit | null;
      lastSnapshot: Record<string, unknown> | null;
      startedAt: string;
      exitedAt: string | null;
      tombstoneTimer: NodeJS.Timeout | null;
      lastObservedOutputCursor: number;
    }

    const internals = server as unknown as {
      sortSessionSummaries: (
        sessions: readonly InternalSessionState[],
        sort: 'attention-first' | 'started-desc' | 'started-asc',
      ) => ReadonlyArray<Record<string, unknown>>;
    };

    const base: Omit<InternalSessionState, 'id' | 'status' | 'startedAt' | 'lastEventAt'> = {
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      attentionReason: null,
      lastExit: null,
      lastSnapshot: null,
      exitedAt: null,
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
    };

    const rows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-c',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'session-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'session-b',
        status: 'exited',
        startedAt: '2026-01-02T00:00:00.000Z',
        lastEventAt: '2026-01-02T00:00:00.000Z',
      },
      {
        ...base,
        id: 'session-d',
        status: 'running',
        startedAt: '2026-01-03T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'session-e',
        status: 'needs-input',
        startedAt: '2026-01-04T00:00:00.000Z',
        lastEventAt: '2026-01-04T00:00:00.000Z',
      },
    ];

    const startedAsc = internals.sortSessionSummaries(rows, 'started-asc');
    assert.deepEqual(
      startedAsc.map((entry) => entry['sessionId']),
      ['session-a', 'session-c', 'session-b', 'session-d', 'session-e'],
    );

    const startedDesc = internals.sortSessionSummaries(rows, 'started-desc');
    assert.deepEqual(
      startedDesc.map((entry) => entry['sessionId']),
      ['session-e', 'session-d', 'session-b', 'session-a', 'session-c'],
    );

    const attentionFirst = internals.sortSessionSummaries(rows, 'attention-first');
    assert.deepEqual(
      attentionFirst.map((entry) => entry['sessionId']),
      ['session-e', 'session-d', 'session-a', 'session-c', 'session-b'],
    );

    const byLastEventRows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-last-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z',
      },
      {
        ...base,
        id: 'session-last-b',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:09:00.000Z',
      },
    ];
    const byLastEvent = internals.sortSessionSummaries(byLastEventRows, 'attention-first');
    assert.deepEqual(
      byLastEvent.map((entry) => entry['sessionId']),
      ['session-last-a', 'session-last-b'],
    );

    const byStartedRows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-start-a',
        status: 'completed',
        startedAt: '2026-01-01T00:10:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z',
      },
      {
        ...base,
        id: 'session-start-b',
        status: 'completed',
        startedAt: '2026-01-01T00:09:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z',
      },
    ];
    const byStarted = internals.sortSessionSummaries(byStartedRows, 'attention-first');
    assert.deepEqual(
      byStarted.map((entry) => entry['sessionId']),
      ['session-start-a', 'session-start-b'],
    );

    const nullVsNonNullA: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'null-last-event',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
      {
        ...base,
        id: 'non-null-last-event',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:01.000Z',
      },
    ];
    const nullVsNonNullSortedA = internals.sortSessionSummaries(nullVsNonNullA, 'attention-first');
    assert.deepEqual(
      nullVsNonNullSortedA.map((entry) => entry['sessionId']),
      ['non-null-last-event', 'null-last-event'],
    );

    const nullVsNonNullB: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'non-null-last-event-2',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:01.000Z',
      },
      {
        ...base,
        id: 'null-last-event-2',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null,
      },
    ];
    const nullVsNonNullSortedB = internals.sortSessionSummaries(nullVsNonNullB, 'attention-first');
    assert.deepEqual(
      nullVsNonNullSortedB.map((entry) => entry['sessionId']),
      ['non-null-last-event-2', 'null-last-event-2'],
    );
  } finally {
    await server.close();
  }
});

void test('stream server exposes attention list and respond/interrupt wrappers', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-attention',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    const attention = await client.sendCommand({
      type: 'attention.list',
    });
    const attentionSessions = attention['sessions'] as Array<Record<string, unknown>>;
    assert.equal(attentionSessions.length, 0);

    const responded = await client.sendCommand({
      type: 'session.respond',
      sessionId: 'session-attention',
      text: 'approved',
    });
    assert.equal(responded['responded'], true);
    assert.equal(responded['sentBytes'], Buffer.byteLength('approved'));
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'approved'),
      true,
    );

    const interrupted = await client.sendCommand({
      type: 'session.interrupt',
      sessionId: 'session-attention',
    });
    assert.equal(interrupted['interrupted'], true);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'),
      true,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server blocks non-controller mutations until takeover claim succeeds', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    },
  });
  const address = server.address();
  const ownerClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const otherClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await ownerClient.sendCommand({
      type: 'pty.start',
      sessionId: 'session-claimed',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await ownerClient.sendCommand({
      type: 'session.claim',
      sessionId: 'session-claimed',
      controllerId: 'agent-owner',
      controllerType: 'agent',
    });

    otherClient.sendInput('session-claimed', Buffer.from('blocked-input', 'utf8'));
    otherClient.sendResize('session-claimed', 120, 40);
    otherClient.sendSignal('session-claimed', 'interrupt');
    otherClient.sendSignal('session-claimed', 'terminate');
    await delay(10);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'blocked-input'),
      false,
    );
    assert.equal(sessions[0]!.resizeCalls.length, 0);
    assert.equal(sessions[0]!.isClosed(), false);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'),
      false,
    );

    await assert.rejects(
      otherClient.sendCommand({
        type: 'session.respond',
        sessionId: 'session-claimed',
        text: 'blocked-command',
      }),
      /session is claimed by agent:agent-owner/,
    );

    await assert.rejects(
      otherClient.sendCommand({
        type: 'session.release',
        sessionId: 'session-claimed',
      }),
      /session is claimed by agent:agent-owner/,
    );

    await otherClient.sendCommand({
      type: 'session.claim',
      sessionId: 'session-claimed',
      controllerId: 'human-owner',
      controllerType: 'human',
      controllerLabel: 'human owner',
      takeover: true,
    });
    otherClient.sendInput('session-claimed', Buffer.from('allowed-input', 'utf8'));
    await delay(10);
    assert.equal(
      sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'allowed-input'),
      true,
    );

    const releaseResult = await otherClient.sendCommand({
      type: 'session.release',
      sessionId: 'session-claimed',
      reason: 'manual done',
    });
    assert.equal(releaseResult['released'], true);

    const releaseAgainResult = await otherClient.sendCommand({
      type: 'session.release',
      sessionId: 'session-claimed',
    });
    assert.equal(releaseAgainResult['released'], false);
  } finally {
    ownerClient.close();
    otherClient.close();
    await server.close();
  }
});

void test('stream server assertConnectionCanMutateSession tolerates stale null-controller branch', async () => {
  const server = new ControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  try {
    const mutableServer = server as unknown as {
      connectionCanMutateSession: (connectionId: string, state: { controller: null }) => boolean;
      assertConnectionCanMutateSession: (connectionId: string, state: { controller: null }) => void;
    };
    const original = mutableServer.connectionCanMutateSession;
    mutableServer.connectionCanMutateSession = () => false;
    assert.doesNotThrow(() => {
      mutableServer.assertConnectionCanMutateSession('connection-local', {
        controller: null,
      });
    });
    mutableServer.connectionCanMutateSession = original;
  } finally {
    await server.close();
  }
});

void test('stream server keeps status running while typing until runtime events arrive', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-typing',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    assert.equal(sessions.length, 1);

    const initial = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing',
    });
    assert.equal(initial['status'], 'running');

    client.sendInput('session-typing', Buffer.from('typed', 'utf8'));
    await delay(10);
    const afterTyping = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing',
    });
    assert.equal(afterTyping['status'], 'running');

    client.sendInput('session-typing', Buffer.from('\r', 'utf8'));
    await delay(10);
    const afterSubmit = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing',
    });
    assert.equal(afterSubmit['status'], 'running');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server emits session-exit events for subscribed non-attached sessions', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-active',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-background',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    assert.equal(sessions.length, 2);

    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-active',
    });
    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-background',
    });

    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-active',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-background',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-background',
    });

    client.sendInput('session-background', Buffer.from('\r', 'utf8'));
    await delay(10);
    const runningStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-background',
    });
    assert.equal(runningStatus['status'], 'running');

    sessions[1]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(10);

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'pty.event' &&
          envelope.sessionId === 'session-background' &&
          envelope.event.type === 'session-exit',
      ),
      true,
    );
    const completedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-background',
    });
    assert.equal(completedStatus['status'], 'exited');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server surfaces listen failures', async () => {
  const startSession = (input: StartControlPlaneSessionInput): FakeLiveSession =>
    new FakeLiveSession(input);
  const first = new ControlPlaneStreamServer({
    host: '127.0.0.1',
    port: 0,
    startSession,
  });
  await first.start();
  const collisionPort = first.address().port;

  const second = new ControlPlaneStreamServer({
    host: '127.0.0.1',
    port: collisionPort,
    startSession,
  });

  await assert.rejects(second.start());
  await first.close();
});

void test('stream server enforces optional auth token on all operations', async () => {
  const server = await startControlPlaneStreamServer({
    authToken: 'secret-token',
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();

  const unauthenticatedClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await assert.rejects(
      unauthenticatedClient.sendCommand({
        type: 'session.list',
      }),
      /authentication required|closed/,
    );

    await assert.rejects(
      connectControlPlaneStreamClient({
        host: address.address,
        port: address.port,
        authToken: 'wrong-token',
      }),
      /invalid auth token|closed/,
    );

    const authenticatedClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
      authToken: 'secret-token',
    });
    try {
      const listed = await authenticatedClient.sendCommand({
        type: 'session.list',
      });
      assert.deepEqual(listed['sessions'], []);
    } finally {
      authenticatedClient.close();
    }
  } finally {
    unauthenticatedClient.close();
    await server.close();
  }
});

void test('stream server retains exited tombstones briefly then auto-removes by ttl', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 15,
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-ttl',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);

    const exited = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-ttl',
    });
    assert.equal(exited['status'], 'exited');
    assert.equal(exited['live'], false);
    await assert.rejects(
      client.sendCommand({
        type: 'session.interrupt',
        sessionId: 'session-ttl',
      }),
      /session is not live/,
    );

    await delay(40);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-ttl',
      }),
      /session not found/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server allows restarting a session id from exited tombstone', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 1000,
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart',
      args: [],
      initialCols: 90,
      initialRows: 30,
    });
    assert.equal(sessions.length, 2);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server can remove exited tombstones before ttl callback', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 20,
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-remove-tombstone',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);
    await client.sendCommand({
      type: 'session.remove',
      sessionId: 'session-remove-tombstone',
    });
    await delay(40);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-remove-tombstone',
      }),
      /session not found/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server ttl zero removes exited session immediately', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    sessionExitTombstoneTtlMs: 0,
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-zero-ttl',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(5);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-zero-ttl',
      }),
      /session not found/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server covers detach/cleanup and missing-session stream operations', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
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
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-x',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-x',
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0,
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-x',
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-x',
    });

    client.sendInput('missing-session', Buffer.from('ignored', 'utf8'));
    client.sendResize('missing-session', 10, 5);
    client.sendSignal('missing-session', 'interrupt');
    await delay(10);

    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0,
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null,
    });
    await delay(10);
    assert.equal(
      observed.some(
        (envelope) => envelope.kind === 'pty.exit' && envelope.sessionId === 'session-x',
      ),
      true,
    );

    sessions[0]!.emitEvent({
      type: 'session-exit',
      exit: {
        code: 0,
        signal: null,
      },
    });

    const cleanupClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });
    await cleanupClient.sendCommand({
      type: 'pty.start',
      sessionId: 'session-y',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await cleanupClient.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-y',
    });
    await cleanupClient.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-y',
      sinceCursor: 0,
    });
    cleanupClient.close();
    await delay(10);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server command failure serializes thrown errors', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: () => {
      throw new Error('start-session-failed');
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await assert.rejects(
      client.sendCommand({
        type: 'pty.start',
        sessionId: 'session-fail',
        args: [],
        initialCols: 80,
        initialRows: 24,
      }),
      /Error: start-session-failed/,
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server bounds per-connection output buffering under backpressure', async () => {
  const server = await startControlPlaneStreamServer({
    maxConnectionBufferedBytes: 256,
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-buffer',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-buffer',
      sinceCursor: 2,
    });

    const internals = server as unknown as {
      connections: Map<string, { socket: Socket }>;
    };
    const [connectionState] = [...internals.connections.values()];
    assert.notEqual(connectionState, undefined);
    connectionState!.socket.write = (() => false) as unknown as Socket['write'];
    connectionState!.socket.emit('drain');

    for (let idx = 0; idx < 20; idx += 1) {
      client.sendInput(
        'session-buffer',
        Buffer.from(`payload-${String(idx).padStart(2, '0')}`, 'utf8'),
      );
    }

    await delay(20);
    assert.equal(internals.connections.size, 0);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server internal guard branches remain safe for missing ids', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    sessionExitTombstoneTtlMs: 5,
  });
  try {
    interface InternalSessionState {
      id: string;
      directoryId: string | null;
      tenantId: string;
      userId: string;
      workspaceId: string;
      worktreeId: string;
      session: FakeLiveSession | null;
      eventSubscriberConnectionIds: Set<string>;
      attachmentByConnectionId: Map<string, string>;
      unsubscribe: (() => void) | null;
      status: 'running' | 'needs-input' | 'completed' | 'exited';
      attentionReason: string | null;
      lastEventAt: string | null;
      lastExit: PtyExit | null;
      lastSnapshot: Record<string, unknown> | null;
      startedAt: string;
      exitedAt: string | null;
      tombstoneTimer: NodeJS.Timeout | null;
      lastObservedOutputCursor: number;
    }

    const internals = server as unknown as {
      connections: Map<
        string,
        {
          id: string;
          socket: Socket;
          remainder: string;
          authenticated: boolean;
          attachedSessionIds: Set<string>;
          eventSessionIds: Set<string>;
          streamSubscriptionIds: Set<string>;
          queuedPayloads: string[];
          queuedPayloadBytes: number;
          writeBlocked: boolean;
        }
      >;
      sessions: Map<string, InternalSessionState>;
      streamSubscriptions: Map<string, { id: string }>;
      handleSessionEvent: (sessionId: string, event: CodexLiveEvent) => void;
      detachConnectionFromSession: (connectionId: string, sessionId: string) => void;
      deactivateSession: (sessionId: string, closeSession: boolean) => void;
      scheduleTombstoneRemoval: (sessionId: string) => void;
      destroySession: (sessionId: string, closeSession: boolean) => void;
      cleanupConnection: (connectionId: string) => void;
      sendToConnection: (connectionId: string, envelope: StreamServerEnvelope) => void;
      flushConnectionWrites: (connectionId: string) => void;
    };

    let destroyed = false;
    const fakeSocket = {
      writableLength: Number.MAX_SAFE_INTEGER,
      write: () => true,
      destroy: () => {
        destroyed = true;
      },
    } as unknown as Socket;
    internals.connections.set('fake-connection', {
      id: 'fake-connection',
      socket: fakeSocket,
      remainder: '',
      authenticated: true,
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>(),
      streamSubscriptionIds: new Set<string>(),
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false,
    });

    internals.handleSessionEvent('missing-session', {
      type: 'session-exit',
      exit: {
        code: 0,
        signal: null,
      },
    });
    internals.destroySession('missing-session', true);
    internals.sendToConnection('missing-connection', {
      kind: 'auth.ok',
    });

    const fakeConnection = internals.connections.get('fake-connection')!;
    fakeConnection.queuedPayloads.push('payload');
    fakeConnection.queuedPayloadBytes = 7;
    internals.flushConnectionWrites('fake-connection');
    assert.equal(destroyed, true);

    internals.sessions.set('fake-session', {
      id: 'fake-session',
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>([['fake-connection', 'attachment-x']]),
      unsubscribe: null,
      status: 'exited',
      attentionReason: null,
      lastEventAt: null,
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: new Date(0).toISOString(),
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
    } as unknown as typeof internals.sessions extends Map<string, infer T> ? T : never);
    internals.detachConnectionFromSession('fake-connection', 'fake-session');

    const cleanupSocket = {
      writableLength: 0,
      write: () => true,
      destroy: () => undefined,
    } as unknown as Socket;
    internals.connections.set('cleanup-connection', {
      id: 'cleanup-connection',
      socket: cleanupSocket,
      remainder: '',
      authenticated: true,
      attachedSessionIds: new Set<string>(),
      eventSessionIds: new Set<string>(),
      streamSubscriptionIds: new Set<string>(['subscription-cleanup']),
      queuedPayloads: [],
      queuedPayloadBytes: 0,
      writeBlocked: false,
    });
    internals.streamSubscriptions.set('subscription-cleanup', {
      id: 'subscription-cleanup',
    } as unknown as { id: string });
    internals.sessions.set('controlled-session', {
      id: 'controlled-session',
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      status: 'running',
      attentionReason: null,
      lastEventAt: new Date(0).toISOString(),
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: null,
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
      latestTelemetry: null,
      controller: {
        connectionId: 'cleanup-connection',
        controllerId: 'agent-cleanup',
        controllerType: 'agent',
        controllerLabel: 'Cleanup Agent',
        claimedAt: new Date(0).toISOString(),
      },
    } as unknown as typeof internals.sessions extends Map<string, infer T> ? T : never);
    internals.cleanupConnection('cleanup-connection');
    assert.equal(internals.streamSubscriptions.has('subscription-cleanup'), false);
    const controlledAfterCleanup = internals.sessions.get('controlled-session') as
      | {
          controller: Record<string, unknown> | null;
        }
      | undefined;
    assert.notEqual(controlledAfterCleanup, undefined);
    assert.equal(controlledAfterCleanup?.controller, null);

    internals.deactivateSession('missing-session', true);
    internals.deactivateSession('fake-session', true);
    internals.scheduleTombstoneRemoval('missing-session');

    const fakeTimer = setTimeout(() => undefined, 1000);
    const fakeSessionState = internals.sessions.get('fake-session');
    assert.notEqual(fakeSessionState, undefined);
    fakeSessionState!.status = 'exited';
    fakeSessionState!.tombstoneTimer = fakeTimer;
    internals.scheduleTombstoneRemoval('fake-session');

    internals.sessions.set('timer-guard-session', {
      id: 'timer-guard-session',
      directoryId: null,
      tenantId: 'tenant-local',
      userId: 'user-local',
      workspaceId: 'workspace-local',
      worktreeId: 'worktree-local',
      session: null,
      eventSubscriberConnectionIds: new Set<string>(),
      attachmentByConnectionId: new Map<string, string>(),
      unsubscribe: null,
      status: 'exited',
      attentionReason: null,
      lastEventAt: null,
      lastExit: null,
      lastSnapshot: null,
      startedAt: new Date(0).toISOString(),
      exitedAt: new Date(0).toISOString(),
      tombstoneTimer: null,
      lastObservedOutputCursor: 0,
    });
    internals.scheduleTombstoneRemoval('timer-guard-session');
    const timerGuardState = internals.sessions.get('timer-guard-session');
    assert.notEqual(timerGuardState, undefined);
    timerGuardState!.status = 'running';
    await delay(20);
    assert.equal(internals.sessions.has('timer-guard-session'), true);
    internals.destroySession('timer-guard-session', false);
  } finally {
    await server.close();
  }
});

void test('stream server supports injected state store and observed filter/journal guards', async () => {
  const injectedStore = new SqliteControlPlaneStore(':memory:');
  const server = new ControlPlaneStreamServer({
    maxStreamJournalEntries: 1,
    stateStore: injectedStore,
    startSession: (input) => new FakeLiveSession(input),
  });
  try {
    const internals = server as unknown as {
      streamJournal: Array<{ cursor: number }>;
      matchesObservedFilter: (
        scope: {
          tenantId: string;
          userId: string;
          workspaceId: string;
          directoryId: string | null;
          conversationId: string;
        },
        event: Record<string, unknown>,
        filter: {
          includeOutput: boolean;
          tenantId?: string;
          userId?: string;
          workspaceId?: string;
          repositoryId?: string;
          taskId?: string;
          directoryId?: string;
          conversationId?: string;
        },
      ) => boolean;
      publishObservedEvent: (
        scope: {
          tenantId: string;
          userId: string;
          workspaceId: string;
          directoryId: string | null;
          conversationId: string;
        },
        event: Record<string, unknown>,
      ) => void;
    };

    const baseScope = {
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      directoryId: 'directory-a',
      conversationId: 'conversation-a',
    };
    const statusEvent = {
      type: 'session-status',
      sessionId: 'conversation-a',
      status: 'running',
      attentionReason: null,
      live: true,
      ts: new Date(0).toISOString(),
      directoryId: 'directory-a',
      conversationId: 'conversation-a',
    };
    const outputEvent = {
      type: 'session-output',
      sessionId: 'conversation-a',
      outputCursor: 1,
      chunkBase64: Buffer.from('x').toString('base64'),
      ts: new Date(0).toISOString(),
      directoryId: 'directory-a',
      conversationId: 'conversation-a',
    };
    const reorderedEvent = {
      type: 'task-reordered',
      tasks: [
        {
          taskId: 'task-a',
          repositoryId: 'repository-a',
        },
      ],
    };

    assert.equal(
      internals.matchesObservedFilter(baseScope, outputEvent, { includeOutput: false }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        tenantId: 'tenant-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        userId: 'user-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        workspaceId: 'workspace-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        directoryId: 'directory-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        conversationId: 'conversation-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        repositoryId: 'repository-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        taskId: 'task-b',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        tenantId: 'tenant-a',
        userId: 'user-a',
        workspaceId: 'workspace-a',
        directoryId: 'directory-a',
        conversationId: 'conversation-a',
      }),
      true,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        repositoryId: 'repository-missing',
      }),
      false,
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, reorderedEvent, {
        includeOutput: true,
        taskId: 'task-missing',
      }),
      false,
    );

    internals.publishObservedEvent(baseScope, statusEvent);
    internals.publishObservedEvent(baseScope, statusEvent);
    assert.equal(internals.streamJournal.length, 1);
    assert.equal(internals.streamJournal[0]?.cursor, 2);
  } finally {
    await server.close();
  }

  injectedStore.upsertDirectory({
    directoryId: 'after-close-directory',
    tenantId: 'tenant-after',
    userId: 'user-after',
    workspaceId: 'workspace-after',
    path: '/tmp/after-close',
  });
  injectedStore.close();
});

void test('stream server injects codex telemetry args, ingests otlp payloads, and updates runtime state', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
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
      pollMs: 50,
    },
  });
  const address = server.address();
  const telemetryAddress = server.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);
  const telemetryTarget = {
    host: '127.0.0.1',
    port: telemetryAddress!.port,
  };
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observedTelemetry = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-otel',
      tenantId: 'tenant-otel',
      userId: 'user-otel',
      workspaceId: 'workspace-otel',
      path: '/tmp/workspace-otel',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-otel',
      directoryId: 'directory-otel',
      title: 'otlp status',
      agentType: 'codex',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-otel',
      args: ['--model', 'test-model'],
      initialCols: 80,
      initialRows: 24,
    });
    const subscribed = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-otel',
      userId: 'user-otel',
      workspaceId: 'workspace-otel',
      conversationId: 'conversation-otel',
      includeOutput: false,
    });
    const telemetrySubscriptionId = subscribed['subscriptionId'];
    assert.equal(typeof telemetrySubscriptionId, 'string');

    assert.equal(created.length, 1);
    const launchedArgs = created[0]!.input.args;
    assert.equal(launchedArgs.includes('--model'), true);
    assert.equal(launchedArgs.includes('test-model'), true);
    assert.equal(launchedArgs.includes('otel.log_user_prompt=true'), true);

    const exporterArg = launchedArgs.find((arg) => arg.includes('otel.exporter='));
    assert.notEqual(exporterArg, undefined);
    const tokenMatch = /\/v1\/logs\/([^"]+)/u.exec(exporterArg!);
    assert.notEqual(tokenMatch, null);
    const token = decodeURIComponent(tokenMatch?.[1] ?? '');
    assert.notEqual(token.length, 0);

    const unknownTokenResponse = await postJson(telemetryTarget, '/v1/logs/not-found', {});
    assert.equal(unknownTokenResponse.statusCode, 404);
    const malformedTokenResponse = await postJson(telemetryTarget, '/v1/logs/%E0', {});
    assert.equal(malformedTokenResponse.statusCode, 404);
    const invalidEndpointResponse = await postJson(telemetryTarget, '/unknown/path', {});
    assert.equal(invalidEndpointResponse.statusCode, 404);
    const wrongMethodResponse = await postRaw(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      'GET',
      '',
    );
    assert.equal(wrongMethodResponse.statusCode, 405);
    const invalidJsonResponse = await postRaw(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      'POST',
      '{',
    );
    assert.equal(invalidJsonResponse.statusCode, 400);

    const batchResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {},
    );
    assert.equal(batchResponse.statusCode, 200);

    const runningResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1700000000000000000',
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.user_prompt',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'prompt accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(runningResponse.statusCode, 200);
    const runningDuplicateResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: '1700000000000000000',
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.user_prompt',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'prompt accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(runningDuplicateResponse.statusCode, 200);

    await delay(20);
    const runningStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(runningStatus['status'], 'running');

    client.sendInput('conversation-otel', Buffer.from('\n', 'utf8'));
    await delay(10);
    const stillRunning = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(stillRunning['status'], 'running');

    const completedResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.sse_event',
                        },
                      },
                      {
                        key: 'kind',
                        value: {
                          stringValue: 'response.completed',
                        },
                      },
                      {
                        key: 'thread_id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'response.completed',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(completedResponse.statusCode, 200);
    const needsInputResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'needs-input',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'needs-input',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(needsInputResponse.statusCode, 200);

    const metricsResponse = await postJson(
      telemetryTarget,
      `/v1/metrics/${encodeURIComponent(token)}`,
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'codex.turn.e2e_duration_ms',
                    sum: {
                      dataPoints: [{}],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(metricsResponse.statusCode, 200);

    const tracesResponse = await postJson(
      telemetryTarget,
      `/v1/traces/${encodeURIComponent(token)}`,
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: 'codex.websocket_event',
                    attributes: [
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(tracesResponse.statusCode, 200);

    await delay(20);
    const completedStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(completedStatus['status'], 'completed');
    assert.equal((completedStatus['telemetry'] as Record<string, unknown>)['source'], 'otlp-trace');
    const observedKeyEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-key-event',
    );
    assert.equal(observedKeyEvents.length > 0, true);
    const observedStatusEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-status',
    );
    assert.equal(observedStatusEvents.length > 0, true);
    const latestStatus = observedStatusEvents[observedStatusEvents.length - 1];
    assert.notEqual(latestStatus, undefined);
    if (
      latestStatus !== undefined &&
      latestStatus.kind === 'stream.event' &&
      latestStatus.event.type === 'session-status'
    ) {
      assert.equal(latestStatus.event.telemetry?.source, 'otlp-trace');
    }

    client.sendInput('conversation-otel', Buffer.from('\n', 'utf8'));
    await delay(10);
    const completedAfterInput = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel',
    });
    assert.equal(completedAfterInput['status'], 'completed');

    const listedConversations = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-otel',
      includeArchived: true,
    });
    const conversationRow = (
      listedConversations['conversations'] as Array<Record<string, unknown>>
    )[0]!;
    const adapterState = conversationRow['adapterState'] as Record<string, unknown>;
    const codexState = adapterState['codex'] as Record<string, unknown>;
    assert.equal(codexState['resumeSessionId'], 'thread-otel');
    assert.equal(typeof codexState['lastObservedAt'], 'string');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server lifecycle telemetry mode drops verbose codex events while retaining high-signal events', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
    codexTelemetry: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
    },
    codexHistory: {
      enabled: false,
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const telemetryAddress = server.telemetryAddressInfo();
  assert.notEqual(telemetryAddress, null);
  const telemetryTarget = {
    host: '127.0.0.1',
    port: telemetryAddress!.port,
  };
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const observedTelemetry = collectEnvelopes(client);
  const internals = server as unknown as {
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
  };

  try {
    internals.ingestParsedTelemetryEvent('conversation-missing-lifecycle', {
      source: 'otlp-log',
      observedAt: '2026-02-16T00:00:00.000Z',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.in_progress',
      providerThreadId: 'thread-missing-lifecycle',
      statusHint: 'running',
      payload: {},
    });

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-otel-lifecycle',
      tenantId: 'tenant-otel-lifecycle',
      userId: 'user-otel-lifecycle',
      workspaceId: 'workspace-otel-lifecycle',
      path: '/tmp/workspace-otel-lifecycle',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-otel-lifecycle',
      directoryId: 'directory-otel-lifecycle',
      title: 'otlp lifecycle',
      agentType: 'codex',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-otel-lifecycle',
      args: ['--model', 'test-model'],
      initialCols: 80,
      initialRows: 24,
    });
    const subscribed = await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-otel-lifecycle',
      userId: 'user-otel-lifecycle',
      workspaceId: 'workspace-otel-lifecycle',
      conversationId: 'conversation-otel-lifecycle',
      includeOutput: false,
    });
    const telemetrySubscriptionId = subscribed['subscriptionId'];
    assert.equal(typeof telemetrySubscriptionId, 'string');

    assert.equal(created.length, 1);
    const launchedArgs = created[0]!.input.args;
    const exporterArg = launchedArgs.find((arg) => arg.includes('otel.exporter='));
    assert.notEqual(exporterArg, undefined);
    const tokenMatch = /\/v1\/logs\/([^"]+)/u.exec(exporterArg!);
    assert.notEqual(tokenMatch, null);
    const token = decodeURIComponent(tokenMatch?.[1] ?? '');
    assert.notEqual(token.length, 0);

    const emptyBatchResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {},
    );
    assert.equal(emptyBatchResponse.statusCode, 200);

    const promptResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.user_prompt',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel-lifecycle',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'prompt accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(promptResponse.statusCode, 200);

    const verboseLogResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'codex.sse_event',
                        },
                      },
                      {
                        key: 'kind',
                        value: {
                          stringValue: 'response.in_progress',
                        },
                      },
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel-lifecycle',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'response.in_progress',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(verboseLogResponse.statusCode, 200);

    const needsInputResponse = await postJson(
      telemetryTarget,
      `/v1/logs/${encodeURIComponent(token)}`,
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    attributes: [
                      {
                        key: 'event.name',
                        value: {
                          stringValue: 'needs-input',
                        },
                      },
                    ],
                    body: {
                      stringValue: 'needs-input',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(needsInputResponse.statusCode, 200);

    const metricResponse = await postJson(
      telemetryTarget,
      `/v1/metrics/${encodeURIComponent(token)}`,
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'codex.turn.e2e_duration_ms',
                    sum: {
                      dataPoints: [{}],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(metricResponse.statusCode, 200);

    const traceResponse = await postJson(
      telemetryTarget,
      `/v1/traces/${encodeURIComponent(token)}`,
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: 'codex.websocket_event',
                    attributes: [
                      {
                        key: 'thread-id',
                        value: {
                          stringValue: 'thread-otel-lifecycle',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    assert.equal(traceResponse.statusCode, 200);

    await delay(20);
    const status = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-otel-lifecycle',
    });
    assert.equal(status['status'], 'completed');
    const telemetry = status['telemetry'] as Record<string, unknown> | null;
    assert.notEqual(telemetry, null);
    assert.equal(telemetry?.['eventName'], 'codex.turn.e2e_duration_ms');
    assert.equal(telemetry?.['source'], 'otlp-metric');

    const observedKeyEvents = observedTelemetry.filter(
      (envelope) =>
        envelope.kind === 'stream.event' &&
        envelope.subscriptionId === telemetrySubscriptionId &&
        envelope.event.type === 'session-key-event',
    );
    const observedEventNames = observedKeyEvents
      .map((envelope) =>
        envelope.kind === 'stream.event' && envelope.event.type === 'session-key-event'
          ? envelope.event.keyEvent.eventName
          : null,
      )
      .filter((value): value is string => typeof value === 'string');
    assert.deepEqual(observedEventNames, [
      'codex.user_prompt',
      'needs-input',
      'codex.turn.e2e_duration_ms',
    ]);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server ingests codex history lines and supports reset when file shrinks', async () => {
  const historyDir = mkdtempSync(join(tmpdir(), 'harness-history-'));
  const historyPath = join(historyDir, 'history.jsonl');
  const server = await startControlPlaneStreamServer({
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
      filePath: historyPath,
      pollMs: 25,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const internals = server as unknown as {
    pollHistoryFileUnsafe: () => Promise<boolean>;
  };

  try {
    await delay(30);
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-history',
      tenantId: 'tenant-history',
      userId: 'user-history',
      workspaceId: 'workspace-history',
      path: '/tmp/workspace-history',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-history',
      directoryId: 'directory-history',
      title: 'history status',
      agentType: 'codex',
      adapterState: {
        codex: {
          resumeSessionId: 'thread-history',
        },
      },
    });
    writeFileSync(
      historyPath,
      `\nnot-json\n${JSON.stringify({
        timestamp: '2026-02-15T11:59:59.000Z',
        type: 'response.completed',
        message: 'seed',
        session_id: 'thread-history',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-history',
      args: [],
      initialCols: 80,
      initialRows: 24,
    });

    const seededStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-history',
    });
    assert.equal((seededStatus['telemetry'] as Record<string, unknown>)['source'], 'history');
    assert.equal(
      (seededStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'response.completed',
    );

    writeFileSync(
      historyPath,
      `${JSON.stringify({
        timestamp: '2026-02-15T12:00:00.000Z',
        type: 'user_prompt',
        message: 'first',
        session_id: 'thread-history',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    const firstStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-history',
    });
    assert.equal(firstStatus['status'], 'running');
    assert.equal((firstStatus['telemetry'] as Record<string, unknown>)['source'], 'history');

    writeFileSync(
      historyPath,
      `${JSON.stringify({
        timestamp: '2026-02-15T12:00:00.500Z',
        type: 'heartbeat',
        message: 'no-thread-id',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    const rewrittenMessage = 'done '.repeat(80).trim();
    writeFileSync(historyPath, '', 'utf8');
    writeFileSync(
      historyPath,
      `${JSON.stringify({
        timestamp: '2026-02-15T12:00:01.000Z',
        type: 'response.completed',
        message: rewrittenMessage,
        session_id: 'thread-history',
      })}\n`,
      'utf8',
    );
    await internals.pollHistoryFileUnsafe();

    const secondStatus = await client.sendCommand({
      type: 'session.status',
      sessionId: 'conversation-history',
    });
    assert.equal(secondStatus['status'], 'running');
    assert.equal(
      (secondStatus['telemetry'] as Record<string, unknown>)['eventName'],
      'response.completed',
    );
  } finally {
    client.close();
    await server.close();
    rmSync(historyDir, { recursive: true, force: true });
  }
});

void test('stream server history poll applies jittered scheduling and idle backoff', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true
    },
    codexHistory: {
      enabled: true,
      filePath: '~/missing-history-jitter.jsonl',
      pollMs: 1000
    }
  });
  const internals = server as unknown as {
    pollHistoryFile: () => Promise<void>;
    pollHistoryFileUnsafe: () => Promise<boolean>;
    historyNextAllowedPollAtMs: number;
    historyIdleStreak: number;
  };
  let pollCalls = 0;
  internals.pollHistoryFileUnsafe = () => {
    pollCalls += 1;
    return Promise.resolve(pollCalls === 1);
  };

  try {
    internals.historyNextAllowedPollAtMs = 0;
    const beforeSuccessPoll = Date.now();
    await internals.pollHistoryFile();
    const successDelayMs = internals.historyNextAllowedPollAtMs - beforeSuccessPoll;
    assert.equal(pollCalls, 1);
    assert.ok(successDelayMs >= 550, `expected >= 550ms; got ${String(successDelayMs)}ms`);
    assert.ok(successDelayMs <= 1500, `expected <= 1500ms; got ${String(successDelayMs)}ms`);

    await internals.pollHistoryFile();
    assert.equal(pollCalls, 1);

    internals.historyNextAllowedPollAtMs = 0;
    const beforeIdlePoll = Date.now();
    await internals.pollHistoryFile();
    const idleDelayMs = internals.historyNextAllowedPollAtMs - beforeIdlePoll;
    assert.equal(internals.historyIdleStreak, 1);
    assert.ok(idleDelayMs >= 1200, `expected >= 1200ms; got ${String(idleDelayMs)}ms`);
    assert.ok(idleDelayMs <= 2800, `expected <= 2800ms; got ${String(idleDelayMs)}ms`);
  } finally {
    await server.close();
  }
});

void test('stream server history polling helpers start once and stop cleanly', async () => {
  const server = new ControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
    codexTelemetry: {
      enabled: false,
      host: '127.0.0.1',
      port: 0,
      logUserPrompt: true,
      captureLogs: true,
      captureMetrics: true,
      captureTraces: true,
      captureVerboseEvents: true
    },
    codexHistory: {
      enabled: true,
      filePath: '~/missing-history-jitter.jsonl',
      pollMs: 1000
    }
  });
  const internals = server as unknown as {
    historyPollTimer: NodeJS.Timeout | null;
    startHistoryPollingIfEnabled: () => void;
    stopHistoryPolling: () => void;
    pollHistoryTimerTick: () => void;
  };
  try {
    assert.equal(internals.historyPollTimer, null);
    internals.startHistoryPollingIfEnabled();
    assert.notEqual(internals.historyPollTimer, null);
    internals.pollHistoryTimerTick();
    const firstTimer = internals.historyPollTimer;
    internals.startHistoryPollingIfEnabled();
    assert.equal(internals.historyPollTimer, firstTimer);
    internals.stopHistoryPolling();
    assert.equal(internals.historyPollTimer, null);
  } finally {
    await server.close();
  }
});

void test('stream server skips codex telemetry arg injection for non-codex agents', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
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
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
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
      directoryId: 'directory-non-codex',
      tenantId: 'tenant-non-codex',
      userId: 'user-non-codex',
      workspaceId: 'workspace-non-codex',
      path: '/tmp/non-codex',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-non-codex',
      directoryId: 'directory-non-codex',
      title: 'non-codex',
      agentType: 'claude',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-non-codex',
      args: ['--foo', 'bar'],
      initialCols: 80,
      initialRows: 24,
    });
    const launchedArgs = created[0]!.input.args;
    assert.deepEqual(launchedArgs, ['--foo', 'bar']);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server launches terminal agents with shell command and no codex base args', async () => {
  const created: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      created.push(session);
      return session;
    },
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
      filePath: '~/.codex/history.jsonl',
      pollMs: 50,
    },
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const comSpec = process.env.ComSpec?.trim();
  const shell = process.env.SHELL?.trim();
  const expectedTerminalCommand =
    process.platform === 'win32'
      ? comSpec !== undefined && comSpec.length > 0
        ? comSpec
        : 'cmd.exe'
      : shell !== undefined && shell.length > 0
        ? shell
        : 'sh';

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-terminal',
      tenantId: 'tenant-terminal',
      userId: 'user-terminal',
      workspaceId: 'workspace-terminal',
      path: '/tmp/terminal',
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'conversation-terminal',
      directoryId: 'directory-terminal',
      title: 'terminal',
      agentType: 'terminal',
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-terminal',
      args: ['-lc', 'echo hello'],
      initialCols: 80,
      initialRows: 24,
    });
    const started = created[0]?.input;
    assert.notEqual(started, undefined);
    assert.equal(started?.command, expectedTerminalCommand);
    assert.deepEqual(started?.baseArgs, []);
    assert.deepEqual(started?.args, ['-lc', 'echo hello']);
  } finally {
    client.close();
    await server.close();
  }
});

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
      }
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
            }
          };
          return iterator;
        }
      },
      abortedResponse
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
      }
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
            }
          };
          return iterator;
        }
      },
      fatalResponse
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
