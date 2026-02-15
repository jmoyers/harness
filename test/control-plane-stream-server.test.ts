import assert from 'node:assert/strict';
import test from 'node:test';
import { connect, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ControlPlaneStreamServer,
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput
} from '../src/control-plane/stream-server.ts';
import {
  connectControlPlaneStreamClient,
  type ControlPlaneStreamClient
} from '../src/control-plane/stream-client.ts';
import {
  encodeStreamEnvelope,
  type StreamServerEnvelope
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
        chunk: Buffer.from('warmup-1', 'utf8')
      },
      {
        cursor: 2,
        chunk: Buffer.from('warmup-2', 'utf8')
      }
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
        chunk: Buffer.from(event.chunk)
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
      chunk
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
      exit
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

function makeTempStateStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-stream-server-'));
  return join(dir, 'control-plane.sqlite');
}

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
    startSession
  });
  assert.throws(() => {
    coldServer.address();
  }, /not listening/);
  await coldServer.start();
  await coldServer.start();
  const coldAddress = coldServer.address();

  const clientA = await connectControlPlaneStreamClient({
    host: coldAddress.address,
    port: coldAddress.port
  });
  const clientB = await connectControlPlaneStreamClient({
    host: coldAddress.address,
    port: coldAddress.port
  });

  try {
    await clientA.authenticate('ignored-token');

    const observedA = collectEnvelopes(clientA);
    const observedB = collectEnvelopes(clientB);

    await writeRaw({ host: coldAddress.address, port: coldAddress.port }, 'not-json\n{"kind":"unknown"}\n');

    await clientA.sendCommand({
    type: 'pty.start',
    sessionId: 'session-1',
    args: ['--model', 'gpt-5.3-codex'],
    cwd: '/tmp/session-1',
    initialCols: 90,
    initialRows: 30,
    env: {
      TERM: 'xterm-256color'
    },
    terminalForegroundHex: 'd0d7de',
    terminalBackgroundHex: '0f1419'
  });

  assert.equal(created.length, 1);
  assert.equal(created[0]!.input.initialCols, 90);
  assert.equal(created[0]!.input.cwd, '/tmp/session-1');

  await clientA.sendCommand({
    type: 'pty.subscribe-events',
    sessionId: 'session-1'
  });

  const attachResult = await clientB.sendCommand({
    type: 'pty.attach',
    sessionId: 'session-1',
    sinceCursor: 1
  });
  assert.deepEqual(attachResult, {
    latestCursor: 2
  });

  await delay(10);
  assert.equal(
    observedB.some(
      (envelope) => envelope.kind === 'pty.output' && Buffer.from(envelope.chunkBase64, 'base64').toString('utf8') === 'warmup-2'
    ),
    true
  );

  clientB.sendInput('session-1', Buffer.from('typed', 'utf8'));
  await delay(5);
  assert.equal(created[0]!.writes.some((chunk) => chunk.toString('utf8') === 'typed'), true);

    clientB.sendResize('session-1', 120, 40);
    await delay(5);
    assert.deepEqual(created[0]!.resizeCalls, [{ cols: 120, rows: 40 }]);

  clientB.sendSignal('session-1', 'interrupt');
  clientB.sendSignal('session-1', 'eof');
  await delay(5);
  assert.equal(created[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'), true);
  assert.equal(created[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0004'), true);

  await writeRaw(
    { host: coldAddress.address, port: coldAddress.port },
    `${encodeStreamEnvelope({
      kind: 'pty.input',
      sessionId: 'session-1',
      dataBase64: '%%%'
    })}`
  );

  await clientB.sendCommand({
    type: 'pty.detach',
    sessionId: 'session-1'
  });
  assert.equal(created[0]!.attachmentCount(), 0);

  await clientB.sendCommand({
    type: 'pty.unsubscribe-events',
    sessionId: 'session-1'
  });

  created[0]!.emitEvent({
    type: 'notify',
    record: {
      ts: new Date(0).toISOString(),
      payload: {
        type: 'notify-test'
      }
    }
  });
  created[0]!.emitEvent({
    type: 'attention-required',
    reason: 'approval',
    record: {
      ts: new Date(0).toISOString(),
      payload: {
        type: 'approval-needed'
      }
    }
  });
  created[0]!.emitEvent({
    type: 'turn-completed',
    record: {
      ts: new Date(0).toISOString(),
      payload: {
        type: 'agent-turn-complete'
      }
    }
  });
  created[0]!.emitEvent({
    type: 'terminal-output',
    cursor: 99,
    chunk: Buffer.from('ignored', 'utf8')
  });

  await delay(10);
  assert.equal(
    observedA.some((envelope) => envelope.kind === 'pty.event' && envelope.event.type === 'notify'),
    true
  );
  assert.equal(
    observedB.some((envelope) => envelope.kind === 'pty.event'),
    false
  );

  created[0]!.emitExit({
    code: 0,
    signal: null
  });
  await delay(10);

  assert.equal(
    observedA.some((envelope) => envelope.kind === 'pty.event' && envelope.event.type === 'session-exit'),
    true
  );

  const statusAfterExit = await clientA.sendCommand({
    type: 'session.status',
    sessionId: 'session-1'
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
      sessionId: 'session-1'
    }),
    /session is not live/
  );
  const removedAfterExit = await clientA.sendCommand({
    type: 'session.remove',
    sessionId: 'session-1'
  });
  assert.equal(removedAfterExit['removed'], true);

  await clientA.sendCommand({
    type: 'pty.start',
    sessionId: 'session-2',
    args: [],
    initialCols: 80,
    initialRows: 24
  });
  assert.equal(created.length, 2);
  clientA.sendSignal('session-2', 'terminate');
  await delay(10);
  assert.equal(created[1]!.isClosed(), true);

  await assert.rejects(
    clientA.sendCommand({
      type: 'pty.attach',
      sessionId: 'missing-session',
      sinceCursor: 0
    }),
    /session not found/
  );

  await clientA.sendCommand({
    type: 'pty.detach',
    sessionId: 'missing-session'
  });

  await clientA.sendCommand({
    type: 'pty.start',
    sessionId: 'session-3',
    args: [],
    initialCols: 80,
    initialRows: 24
  });
    await assert.rejects(
      clientA.sendCommand({
        type: 'pty.start',
        sessionId: 'session-3',
        args: [],
        initialCols: 80,
        initialRows: 24
      }),
      /session already exists/
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
    startSession: (input) => new FakeLiveSession(input)
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
    startSession: (input) => new FakeLiveSession(input)
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    const initialList = await client.sendCommand({
      type: 'session.list'
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
      worktreeId: 'worktree-a'
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
      worktreeId: 'worktree-b'
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
      worktreeId: 'worktree-c'
    });

    const listed = await client.sendCommand({
      type: 'session.list',
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      sort: 'started-asc'
    });
    assert.equal(Array.isArray(listed['sessions']), true);
    const sessionEntries = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(sessionEntries.length, 2);
    assert.equal(sessionEntries[0]?.['sessionId'], 'session-list');
    assert.equal(sessionEntries[0]?.['tenantId'], 'tenant-a');
    assert.equal(sessionEntries[0]?.['workspaceId'], 'workspace-a');
    assert.equal(sessionEntries[0]?.['status'], 'completed');
    assert.equal(typeof sessionEntries[0]?.['processId'], 'number');
    assert.equal(sessionEntries[1]?.['sessionId'], 'session-list-2');

    const limited = await client.sendCommand({
      type: 'session.list',
      sort: 'started-desc',
      limit: 1
    });
    const limitedEntries = limited['sessions'] as Array<Record<string, unknown>>;
    assert.equal(limitedEntries.length, 1);
    assert.equal(limitedEntries[0]?.['sessionId'], 'session-list-3');

    const filteredByWorktree = await client.sendCommand({
      type: 'session.list',
      worktreeId: 'worktree-b'
    });
    const worktreeEntries = filteredByWorktree['sessions'] as Array<Record<string, unknown>>;
    assert.equal(worktreeEntries.length, 1);
    assert.equal(worktreeEntries[0]?.['sessionId'], 'session-list-2');

    const filteredByUser = await client.sendCommand({
      type: 'session.list',
      userId: 'missing-user'
    });
    assert.deepEqual(filteredByUser['sessions'], []);

    const filteredByWorkspace = await client.sendCommand({
      type: 'session.list',
      workspaceId: 'missing-workspace'
    });
    assert.deepEqual(filteredByWorkspace['sessions'], []);

    const filteredByStatus = await client.sendCommand({
      type: 'session.list',
      status: 'exited'
    });
    assert.deepEqual(filteredByStatus['sessions'], []);

    const filteredByLive = await client.sendCommand({
      type: 'session.list',
      live: false
    });
    assert.deepEqual(filteredByLive['sessions'], []);

    const status = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-list'
    });
    assert.equal(status['sessionId'], 'session-list');
    assert.equal(status['status'], 'completed');
    assert.equal(typeof status['processId'], 'number');

    const snapshot = await client.sendCommand({
      type: 'session.snapshot',
      sessionId: 'session-list'
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

void test('stream server persists directories and conversations and replays scoped stream subscriptions', async () => {
  const stateStorePath = makeTempStateStorePath();
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    stateStorePath,
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });
  const observed = collectEnvelopes(client);

  try {
    const upsertDirectory = await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      path: '/tmp/workspace-1'
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
          resumeSessionId: 'thread-seed'
        }
      }
    });
    const conversation = createdConversation['conversation'] as Record<string, unknown>;
    assert.equal(conversation['conversationId'], 'conversation-1');
    assert.deepEqual(conversation['adapterState'], {
      codex: {
        resumeSessionId: 'thread-seed'
      }
    });

    const subscribedWithoutOutput = await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-1',
      includeOutput: false,
      afterCursor: 0
    });
    const subscriptionWithoutOutput = subscribedWithoutOutput['subscriptionId'];
    assert.equal(typeof subscriptionWithoutOutput, 'string');

    const updatedConversation = await client.sendCommand({
      type: 'conversation.update',
      conversationId: 'conversation-1',
      title: 'renamed task 1'
    });
    const updatedConversationRecord = updatedConversation['conversation'] as Record<string, unknown>;
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
      worktreeId: 'worktree-1'
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'conversation-1',
      sinceCursor: 2
    });
    sessions[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: new Date(0).toISOString(),
        payload: {
          type: 'agent-turn-complete',
          'thread-id': 'thread-updated'
        }
      }
    });
    client.sendInput('conversation-1', Buffer.from('hello-stream', 'utf8'));
    await delay(20);

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithoutOutput &&
          envelope.event.type === 'session-output'
      ),
      false
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithoutOutput &&
          envelope.event.type === 'conversation-updated'
      ),
      true
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithoutOutput &&
          envelope.event.type === 'session-status'
      ),
      true
    );

    const subscribedWithOutput = await client.sendCommand({
      type: 'stream.subscribe',
      conversationId: 'conversation-1',
      includeOutput: true,
      afterCursor: 0
    });
    const subscriptionWithOutput = subscribedWithOutput['subscriptionId'];
    assert.equal(typeof subscriptionWithOutput, 'string');
    await delay(20);
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' &&
          envelope.subscriptionId === subscriptionWithOutput &&
          envelope.event.type === 'session-output'
      ),
      true
    );

    await client.sendCommand({
      type: 'stream.unsubscribe',
      subscriptionId: subscriptionWithOutput as string
    });
    const previousObservedCount = observed.length;
    client.sendInput('conversation-1', Buffer.from('after-unsubscribe', 'utf8'));
    await delay(20);
    assert.equal(
      observed
        .slice(previousObservedCount)
        .some(
          (envelope) =>
            envelope.kind === 'stream.event' &&
            envelope.subscriptionId === subscriptionWithOutput
        ),
      false
    );

    await client.sendCommand({
      type: 'conversation.archive',
      conversationId: 'conversation-1'
    });
    const listedAfterUpdate = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true
    });
    const updatedRows = listedAfterUpdate['conversations'] as Array<Record<string, unknown>>;
    assert.deepEqual(updatedRows[0]?.['adapterState'], {
      codex: {
        resumeSessionId: 'thread-updated',
        lastObservedAt: new Date(0).toISOString()
      }
    });

    await client.sendCommand({
      type: 'conversation.delete',
      conversationId: 'conversation-1'
    });
    await assert.rejects(
      client.sendCommand({
        type: 'conversation.delete',
        conversationId: 'conversation-1'
      }),
      /conversation not found/
    );
    await assert.rejects(
      client.sendCommand({
        type: 'conversation.update',
        conversationId: 'conversation-1',
        title: 'missing'
      }),
      /conversation not found/
    );
    const listedAfterDelete = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true
    });
    assert.deepEqual(listedAfterDelete['conversations'], []);

    const listedArchived = await client.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true
    });
    assert.deepEqual(listedArchived['conversations'], []);
  } finally {
    client.close();
    await server.close();
  }

  const reopened = await startControlPlaneStreamServer({
    stateStorePath,
    startSession: (input) => new FakeLiveSession(input)
  });
  const reopenedAddress = reopened.address();
  const reopenedClient = await connectControlPlaneStreamClient({
    host: reopenedAddress.address,
    port: reopenedAddress.port
  });
  try {
    const directories = await reopenedClient.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      includeArchived: true
    });
    const directoryRows = directories['directories'] as Array<Record<string, unknown>>;
    assert.equal(directoryRows.length, 1);
    assert.equal(directoryRows[0]?.['directoryId'], 'directory-1');

    const conversations = await reopenedClient.sendCommand({
      type: 'conversation.list',
      directoryId: 'directory-1',
      includeArchived: true
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
    startSession: (input) => new FakeLiveSession(input)
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'stream.subscribe',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      includeOutput: false,
      afterCursor: 0
    });

    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-archive',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      path: '/tmp/archive-me'
    });

    const archived = await client.sendCommand({
      type: 'directory.archive',
      directoryId: 'directory-archive'
    });
    const archivedDirectory = archived['directory'] as Record<string, unknown>;
    assert.equal(archivedDirectory['directoryId'], 'directory-archive');
    assert.equal(typeof archivedDirectory['archivedAt'], 'string');

    const defaultListed = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive'
    });
    assert.deepEqual(defaultListed['directories'], []);

    const listedWithArchived = await client.sendCommand({
      type: 'directory.list',
      tenantId: 'tenant-archive',
      userId: 'user-archive',
      workspaceId: 'workspace-archive',
      includeArchived: true
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
        agentType: 'codex'
      }),
      /directory not found/
    );

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'stream.event' && envelope.event.type === 'directory-archived'
      ),
      true
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server attention-first sorting prioritizes needs-input sessions', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-a',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    await delay(2);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'conversation-b',
      args: [],
      initialCols: 80,
      initialRows: 24
    });

    sessions[1]!.emitEvent({
      type: 'attention-required',
      reason: 'approval',
      record: {
        ts: new Date(0).toISOString(),
        payload: {
          type: 'approval-needed'
        }
      }
    });

    const listed = await client.sendCommand({
      type: 'session.list',
      sort: 'attention-first'
    });
    const entries = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.['sessionId'], 'conversation-b');
    assert.equal(entries[0]?.['status'], 'needs-input');
    assert.equal(entries[1]?.['sessionId'], 'conversation-a');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server internal sort helper covers tie-break branches', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input)
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
        sort: 'attention-first' | 'started-desc' | 'started-asc'
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
      lastObservedOutputCursor: 0
    };

    const rows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-c',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null
      },
      {
        ...base,
        id: 'session-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null
      },
      {
        ...base,
        id: 'session-b',
        status: 'exited',
        startedAt: '2026-01-02T00:00:00.000Z',
        lastEventAt: '2026-01-02T00:00:00.000Z'
      },
      {
        ...base,
        id: 'session-d',
        status: 'running',
        startedAt: '2026-01-03T00:00:00.000Z',
        lastEventAt: null
      }
    ];

    const startedAsc = internals.sortSessionSummaries(rows, 'started-asc');
    assert.deepEqual(
      startedAsc.map((entry) => entry['sessionId']),
      ['session-a', 'session-c', 'session-b', 'session-d']
    );

    const startedDesc = internals.sortSessionSummaries(rows, 'started-desc');
    assert.deepEqual(
      startedDesc.map((entry) => entry['sessionId']),
      ['session-d', 'session-b', 'session-a', 'session-c']
    );

    const attentionFirst = internals.sortSessionSummaries(rows, 'attention-first');
    assert.deepEqual(
      attentionFirst.map((entry) => entry['sessionId']),
      ['session-d', 'session-a', 'session-c', 'session-b']
    );

    const byLastEventRows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-last-a',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z'
      },
      {
        ...base,
        id: 'session-last-b',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:09:00.000Z'
      }
    ];
    const byLastEvent = internals.sortSessionSummaries(byLastEventRows, 'attention-first');
    assert.deepEqual(
      byLastEvent.map((entry) => entry['sessionId']),
      ['session-last-a', 'session-last-b']
    );

    const byStartedRows: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'session-start-a',
        status: 'completed',
        startedAt: '2026-01-01T00:10:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z'
      },
      {
        ...base,
        id: 'session-start-b',
        status: 'completed',
        startedAt: '2026-01-01T00:09:00.000Z',
        lastEventAt: '2026-01-01T00:10:00.000Z'
      }
    ];
    const byStarted = internals.sortSessionSummaries(byStartedRows, 'attention-first');
    assert.deepEqual(
      byStarted.map((entry) => entry['sessionId']),
      ['session-start-a', 'session-start-b']
    );

    const nullVsNonNullA: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'null-last-event',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null
      },
      {
        ...base,
        id: 'non-null-last-event',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:01.000Z'
      }
    ];
    const nullVsNonNullSortedA = internals.sortSessionSummaries(nullVsNonNullA, 'attention-first');
    assert.deepEqual(
      nullVsNonNullSortedA.map((entry) => entry['sessionId']),
      ['non-null-last-event', 'null-last-event']
    );

    const nullVsNonNullB: readonly InternalSessionState[] = [
      {
        ...base,
        id: 'non-null-last-event-2',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:01.000Z'
      },
      {
        ...base,
        id: 'null-last-event-2',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: null
      }
    ];
    const nullVsNonNullSortedB = internals.sortSessionSummaries(nullVsNonNullB, 'attention-first');
    assert.deepEqual(
      nullVsNonNullSortedB.map((entry) => entry['sessionId']),
      ['non-null-last-event-2', 'null-last-event-2']
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
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-attention',
      args: [],
      initialCols: 80,
      initialRows: 24
    });

    sessions[0]!.emitEvent({
      type: 'attention-required',
      reason: 'approval',
      record: {
        ts: new Date(0).toISOString(),
        payload: {
          type: 'approval-needed'
        }
      }
    });

    const attention = await client.sendCommand({
      type: 'attention.list'
    });
    const attentionSessions = attention['sessions'] as Array<Record<string, unknown>>;
    assert.equal(attentionSessions.length, 1);
    assert.equal(attentionSessions[0]?.['sessionId'], 'session-attention');
    assert.equal(attentionSessions[0]?.['attentionReason'], 'approval');

    const responded = await client.sendCommand({
      type: 'session.respond',
      sessionId: 'session-attention',
      text: 'approved'
    });
    assert.equal(responded['responded'], true);
    assert.equal(responded['sentBytes'], Buffer.byteLength('approved'));
    assert.equal(sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === 'approved'), true);

    const interrupted = await client.sendCommand({
      type: 'session.interrupt',
      sessionId: 'session-attention'
    });
    assert.equal(interrupted['interrupted'], true);
    assert.equal(sessions[0]!.writes.some((chunk) => chunk.toString('utf8') === '\u0003'), true);
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server marks sessions running only after turn-submission input', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-typing',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    assert.equal(sessions.length, 1);

    const initial = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing'
    });
    assert.equal(initial['status'], 'completed');

    client.sendInput('session-typing', Buffer.from('typed', 'utf8'));
    await delay(10);
    const afterTyping = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing'
    });
    assert.equal(afterTyping['status'], 'completed');

    client.sendInput('session-typing', Buffer.from('\r', 'utf8'));
    await delay(10);
    const afterSubmit = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-typing'
    });
    assert.equal(afterSubmit['status'], 'running');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server restores persisted needs-input status on restart', async () => {
  const sessions: FakeLiveSession[] = [];
  const server = await startControlPlaneStreamServer({
    startSession: (input) => {
      const session = new FakeLiveSession(input);
      sessions.push(session);
      return session;
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'directory.upsert',
      directoryId: 'directory-restart',
      path: '/tmp/harness-restart'
    });
    await client.sendCommand({
      type: 'conversation.create',
      conversationId: 'session-restart-needs-input',
      directoryId: 'directory-restart',
      title: 'needs-input restart',
      agentType: 'codex',
      adapterState: {}
    });

    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart-needs-input',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    sessions[sessions.length - 1]!.emitEvent({
      type: 'attention-required',
      reason: 'approval',
      record: {
        ts: new Date(0).toISOString(),
        payload: {
          type: 'approval-needed'
        }
      }
    });
    await delay(10);
    const needsInputBeforeClose = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-restart-needs-input'
    });
    assert.equal(needsInputBeforeClose['status'], 'needs-input');
    assert.equal(needsInputBeforeClose['attentionReason'], 'approval');

    await client.sendCommand({
      type: 'pty.close',
      sessionId: 'session-restart-needs-input'
    });
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart-needs-input',
      args: [],
      initialCols: 80,
      initialRows: 24
    });

    const needsInputAfterRestart = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-restart-needs-input'
    });
    assert.equal(needsInputAfterRestart['status'], 'needs-input');
    assert.equal(needsInputAfterRestart['attentionReason'], 'approval');
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server surfaces listen failures', async () => {
  const startSession = (input: StartControlPlaneSessionInput): FakeLiveSession => new FakeLiveSession(input);
  const first = new ControlPlaneStreamServer({
    host: '127.0.0.1',
    port: 0,
    startSession
  });
  await first.start();
  const collisionPort = first.address().port;

  const second = new ControlPlaneStreamServer({
    host: '127.0.0.1',
    port: collisionPort,
    startSession
  });

  await assert.rejects(second.start());
  await first.close();
});

void test('stream server enforces optional auth token on all operations', async () => {
  const server = await startControlPlaneStreamServer({
    authToken: 'secret-token',
    startSession: (input) => new FakeLiveSession(input)
  });
  const address = server.address();

  const unauthenticatedClient = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await assert.rejects(
      unauthenticatedClient.sendCommand({
        type: 'session.list'
      }),
      /authentication required|closed/
    );

    await assert.rejects(
      connectControlPlaneStreamClient({
        host: address.address,
        port: address.port,
        authToken: 'wrong-token'
      }),
      /invalid auth token|closed/
    );

    const authenticatedClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
      authToken: 'secret-token'
    });
    try {
      const listed = await authenticatedClient.sendCommand({
        type: 'session.list'
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
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-ttl',
      args: [],
      initialCols: 80,
      initialRows: 24
    });

    sessions[0]!.emitExit({
      code: 0,
      signal: null
    });
    await delay(5);

    const exited = await client.sendCommand({
      type: 'session.status',
      sessionId: 'session-ttl'
    });
    assert.equal(exited['status'], 'exited');
    assert.equal(exited['live'], false);
    await assert.rejects(
      client.sendCommand({
        type: 'session.interrupt',
        sessionId: 'session-ttl'
      }),
      /session is not live/
    );

    await delay(40);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-ttl'
      }),
      /session not found/
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
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null
    });
    await delay(5);
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-restart',
      args: [],
      initialCols: 90,
      initialRows: 30
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
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-remove-tombstone',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null
    });
    await delay(5);
    await client.sendCommand({
      type: 'session.remove',
      sessionId: 'session-remove-tombstone'
    });
    await delay(40);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-remove-tombstone'
      }),
      /session not found/
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
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-zero-ttl',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null
    });
    await delay(5);
    await assert.rejects(
      client.sendCommand({
        type: 'session.status',
        sessionId: 'session-zero-ttl'
      }),
      /session not found/
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
    }
  });
  const address = server.address();

  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });
  const observed = collectEnvelopes(client);

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-x',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-x'
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x'
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-x'
    });
    await client.sendCommand({
      type: 'pty.detach',
      sessionId: 'session-x'
    });

    client.sendInput('missing-session', Buffer.from('ignored', 'utf8'));
    client.sendResize('missing-session', 10, 5);
    client.sendSignal('missing-session', 'interrupt');
    await delay(10);

    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-x',
      sinceCursor: 0
    });
    sessions[0]!.emitExit({
      code: 0,
      signal: null
    });
    await delay(10);
    assert.equal(
      observed.some((envelope) => envelope.kind === 'pty.exit' && envelope.sessionId === 'session-x'),
      true
    );

    sessions[0]!.emitEvent({
      type: 'notify',
      record: {
        ts: new Date(0).toISOString(),
        payload: {
          type: 'post-exit'
        }
      }
    });

    const cleanupClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port
    });
    await cleanupClient.sendCommand({
      type: 'pty.start',
      sessionId: 'session-y',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    await cleanupClient.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: 'session-y'
    });
    await cleanupClient.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-y',
      sinceCursor: 0
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
    }
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await assert.rejects(
      client.sendCommand({
        type: 'pty.start',
        sessionId: 'session-fail',
        args: [],
        initialCols: 80,
        initialRows: 24
      }),
      /Error: start-session-failed/
    );
  } finally {
    client.close();
    await server.close();
  }
});

void test('stream server bounds per-connection output buffering under backpressure', async () => {
  const server = await startControlPlaneStreamServer({
    maxConnectionBufferedBytes: 256,
    startSession: (input) => new FakeLiveSession(input)
  });
  const address = server.address();
  const client = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port
  });

  try {
    await client.sendCommand({
      type: 'pty.start',
      sessionId: 'session-buffer',
      args: [],
      initialCols: 80,
      initialRows: 24
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: 'session-buffer',
      sinceCursor: 2
    });

    const internals = server as unknown as {
      connections: Map<string, { socket: Socket }>;
    };
    const [connectionState] = [...internals.connections.values()];
    assert.notEqual(connectionState, undefined);
    connectionState!.socket.write = (() => false) as unknown as Socket['write'];
    connectionState!.socket.emit('drain');

    for (let idx = 0; idx < 20; idx += 1) {
      client.sendInput('session-buffer', Buffer.from(`payload-${String(idx).padStart(2, '0')}`, 'utf8'));
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
    sessionExitTombstoneTtlMs: 5
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
      }
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
      writeBlocked: false
    });

    internals.handleSessionEvent('missing-session', {
      type: 'notify',
      record: {
        ts: new Date(0).toISOString(),
        payload: {
          type: 'missing'
        }
      }
    });
    internals.destroySession('missing-session', true);
    internals.sendToConnection('missing-connection', {
      kind: 'auth.ok'
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
      lastObservedOutputCursor: 0
    } as unknown as (typeof internals.sessions extends Map<string, infer T> ? T : never));
    internals.detachConnectionFromSession('fake-connection', 'fake-session');

    const cleanupSocket = {
      writableLength: 0,
      write: () => true,
      destroy: () => undefined
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
      writeBlocked: false
    });
    internals.streamSubscriptions.set(
      'subscription-cleanup',
      { id: 'subscription-cleanup' } as unknown as { id: string }
    );
    internals.cleanupConnection('cleanup-connection');
    assert.equal(internals.streamSubscriptions.has('subscription-cleanup'), false);

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
      lastObservedOutputCursor: 0
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
    startSession: (input) => new FakeLiveSession(input)
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
          directoryId?: string;
          conversationId?: string;
        }
      ) => boolean;
      publishObservedEvent: (
        scope: {
          tenantId: string;
          userId: string;
          workspaceId: string;
          directoryId: string | null;
          conversationId: string;
        },
        event: Record<string, unknown>
      ) => void;
    };

    const baseScope = {
      tenantId: 'tenant-a',
      userId: 'user-a',
      workspaceId: 'workspace-a',
      directoryId: 'directory-a',
      conversationId: 'conversation-a'
    };
    const statusEvent = {
      type: 'session-status',
      sessionId: 'conversation-a',
      status: 'running',
      attentionReason: null,
      live: true,
      ts: new Date(0).toISOString(),
      directoryId: 'directory-a',
      conversationId: 'conversation-a'
    };
    const outputEvent = {
      type: 'session-output',
      sessionId: 'conversation-a',
      outputCursor: 1,
      chunkBase64: Buffer.from('x').toString('base64'),
      ts: new Date(0).toISOString(),
      directoryId: 'directory-a',
      conversationId: 'conversation-a'
    };

    assert.equal(
      internals.matchesObservedFilter(baseScope, outputEvent, { includeOutput: false }),
      false
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        tenantId: 'tenant-b'
      }),
      false
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        userId: 'user-b'
      }),
      false
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        workspaceId: 'workspace-b'
      }),
      false
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        directoryId: 'directory-b'
      }),
      false
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        conversationId: 'conversation-b'
      }),
      false
    );
    assert.equal(
      internals.matchesObservedFilter(baseScope, statusEvent, {
        includeOutput: true,
        tenantId: 'tenant-a',
        userId: 'user-a',
        workspaceId: 'workspace-a',
        directoryId: 'directory-a',
        conversationId: 'conversation-a'
      }),
      true
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
    path: '/tmp/after-close'
  });
  injectedStore.close();
});
