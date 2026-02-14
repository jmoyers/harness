import assert from 'node:assert/strict';
import test from 'node:test';
import { connect, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
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

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

class FakeLiveSession {
  readonly input: StartControlPlaneSessionInput;
  readonly writes: Buffer[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];

  private readonly attachments = new Map<string, SessionAttachHandlers>();
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private readonly backlog: SessionDataEvent[];
  private closed = false;
  private nextAttachmentId = 1;
  private latestCursor = 0;

  constructor(input: StartControlPlaneSessionInput) {
    this.input = input;
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

  write(data: string | Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.writes.push(chunk);

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
    const observedA = collectEnvelopes(clientA);
    const observedB = collectEnvelopes(clientB);

    await writeRaw({ host: coldAddress.address, port: coldAddress.port }, 'not-json\n{"kind":"unknown"}\n');

    await clientA.sendCommand({
    type: 'pty.start',
    sessionId: 'session-1',
    args: ['--model', 'gpt-5.3-codex'],
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

  await assert.rejects(
    clientA.sendCommand({
      type: 'pty.close',
      sessionId: 'session-1'
    }),
    /session not found/
  );

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
