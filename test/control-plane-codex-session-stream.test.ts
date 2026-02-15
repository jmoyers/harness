import assert from 'node:assert/strict';
import test from 'node:test';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import {
  openCodexControlPlaneClient,
  openCodexControlPlaneSession
} from '../src/control-plane/codex-session-stream.ts';
import {
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput
} from '../src/control-plane/stream-server.ts';
import type { CodexLiveEvent } from '../src/codex/live-session.ts';
import type { PtyExit } from '../src/pty/pty_host.ts';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  type StreamClientEnvelope
} from '../src/control-plane/stream-protocol.ts';

interface MockHarnessServer {
  address: AddressInfo;
  stop: () => Promise<void>;
}

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

class TestLiveSession {
  private static nextProcessId = 61000;
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private readonly attachments = new Map<string, SessionAttachHandlers>();
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private readonly processIdValue: number;
  private nextAttachmentId = 1;
  private latestCursor = 0;

  constructor(input: StartControlPlaneSessionInput) {
    this.processIdValue = TestLiveSession.nextProcessId;
    TestLiveSession.nextProcessId += 1;
    this.snapshotOracle = new TerminalSnapshotOracle(input.initialCols, input.initialRows);
  }

  attach(handlers: SessionAttachHandlers): string {
    const attachmentId = `attach-${this.nextAttachmentId}`;
    this.nextAttachmentId += 1;
    this.attachments.set(attachmentId, handlers);
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
    this.snapshotOracle.ingest(chunk);
    this.latestCursor += 1;
    for (const handlers of this.attachments.values()) {
      handlers.onData({
        cursor: this.latestCursor,
        chunk
      });
    }
  }

  resize(cols: number, rows: number): void {
    this.snapshotOracle.resize(cols, rows);
  }

  snapshot() {
    return this.snapshotOracle.snapshot();
  }

  close(): void {}

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

async function startMockHarnessServer(
  onMessage: (socket: Socket, envelope: StreamClientEnvelope) => void
): Promise<MockHarnessServer> {
  const server = createServer((socket) => {
    let remainder = '';
    socket.on('data', (chunk: Buffer) => {
      const consumed = consumeJsonLines(`${remainder}${chunk.toString('utf8')}`);
      remainder = consumed.remainder;
      for (const message of consumed.messages) {
        const parsed = parseClientEnvelope(message);
        if (parsed === null) {
          continue;
        }
        onMessage(socket, parsed);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected tcp address');
  }

  return {
    address,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined && error !== null) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

void test('openCodexControlPlaneSession opens and closes a remote session', async () => {
  const server = await startControlPlaneStreamServer({
    authToken: 'remote-secret',
    startSession: (input) => new TestLiveSession(input)
  });
  const address = server.address();

  const opened = await openCodexControlPlaneSession({
    controlPlane: {
      mode: 'remote',
      host: address.address,
      port: address.port,
      authToken: 'remote-secret'
    },
    sessionId: 'remote-session',
    args: [],
    env: {
      TERM: 'xterm-256color'
    },
    initialCols: 80,
    initialRows: 24
  });

  try {
    const status = await opened.client.sendCommand({
      type: 'session.status',
      sessionId: 'remote-session'
    });
    assert.equal(status['sessionId'], 'remote-session');
  } finally {
    await opened.close();
    await server.close();
  }
});

void test('openCodexControlPlaneClient opens remote stream without starting a session', async () => {
  const server = await startControlPlaneStreamServer({
    authToken: 'client-only-secret',
    startSession: (input) => new TestLiveSession(input)
  });
  const address = server.address();
  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: address.address,
    port: address.port,
    authToken: 'client-only-secret',
    connectRetryWindowMs: 250,
    connectRetryDelayMs: 25
  });

  try {
    const listed = await opened.client.sendCommand({
      type: 'session.list'
    });
    assert.deepEqual(listed['sessions'], []);
  } finally {
    await opened.close();
    await server.close();
  }
});

void test('openCodexControlPlaneSession supports embedded mode with injected server factory', async () => {
  const embeddedServer = await startControlPlaneStreamServer({
    startSession: (input) => new TestLiveSession(input)
  });
  const embeddedPort = embeddedServer.address().port;

  const opened = await openCodexControlPlaneSession(
    {
      controlPlane: {
        mode: 'embedded'
      },
      sessionId: 'embedded-session',
      args: [],
      env: {
        TERM: 'xterm-256color'
      },
      initialCols: 80,
      initialRows: 24
    },
    {
      startEmbeddedServer: () => Promise.resolve(embeddedServer)
    }
  );

  try {
    const listed = await opened.client.sendCommand({
      type: 'session.list'
    });
    const sessions = listed['sessions'] as Array<Record<string, unknown>>;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.['sessionId'], 'embedded-session');
  } finally {
    await opened.close();
  }

  await assert.rejects(
    new Promise<void>((resolve, reject) => {
      const socket = connect(embeddedPort, '127.0.0.1', () => {
        socket.end();
        resolve();
      });
      socket.once('error', reject);
    })
  );
});

void test('openCodexControlPlaneSession closes client when start command fails', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new TestLiveSession(input)
  });
  const address = server.address();

  const first = await openCodexControlPlaneSession({
    controlPlane: {
      mode: 'remote',
      host: address.address,
      port: address.port
    },
    sessionId: 'duplicate-session',
    args: [],
    env: {
      TERM: 'xterm-256color'
    },
    initialCols: 80,
    initialRows: 24
  });

  try {
    await assert.rejects(
      openCodexControlPlaneSession({
        controlPlane: {
          mode: 'remote',
          host: address.address,
          port: address.port
        },
        sessionId: 'duplicate-session',
        args: [],
        env: {
          TERM: 'xterm-256color'
        },
        initialCols: 80,
        initialRows: 24
      }),
      /session already exists/
    );
  } finally {
    await first.close();
    await server.close();
  }
});

void test('openCodexControlPlaneSession rejects embedded mode without startEmbeddedServer', async () => {
  await assert.rejects(
    openCodexControlPlaneSession({
      controlPlane: {
        mode: 'embedded'
      },
      sessionId: 'embedded-missing-dependency',
      args: [],
      env: {
        TERM: 'xterm-256color'
      },
      initialCols: 80,
      initialRows: 24
    }),
    /startEmbeddedServer dependency/
  );
});

void test('openCodexControlPlaneSession rejects mismatched pty.start session id', async () => {
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind === 'command') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.accepted',
          commandId: envelope.commandId
        })
      );
      if (envelope.command.type === 'pty.start') {
        socket.write(
          encodeStreamEnvelope({
            kind: 'command.completed',
            commandId: envelope.commandId,
            result: {
              sessionId: 'unexpected-session'
            }
          })
        );
      }
    }
  });

  try {
    await assert.rejects(
      openCodexControlPlaneSession({
        controlPlane: {
          mode: 'remote',
          host: harness.address.address,
          port: harness.address.port
        },
        sessionId: 'expected-session',
        args: [],
        env: {
          TERM: 'xterm-256color'
        },
        initialCols: 80,
        initialRows: 24,
        terminalForegroundHex: 'ffffff',
        terminalBackgroundHex: '000000'
      }),
      /unexpected session id/
    );
  } finally {
    await harness.stop();
  }
});

void test('openCodexControlPlaneSession closes embedded server when startup fails', async () => {
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId
      })
    );
    if (envelope.command.type === 'pty.start') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            sessionId: 'wrong-embedded-session'
          }
        })
      );
    }
  });

  let closed = false;
  const embeddedServerLike = {
    address: () => ({
      address: harness.address.address,
      family: harness.address.family,
      port: harness.address.port
    }),
    close: async () => {
      closed = true;
      await harness.stop();
    }
  };

  await assert.rejects(
    openCodexControlPlaneSession(
      {
        controlPlane: {
          mode: 'embedded'
        },
        sessionId: 'embedded-expected',
        args: [],
        env: {
          TERM: 'xterm-256color'
        },
        initialCols: 80,
        initialRows: 24
      },
      {
        startEmbeddedServer: () =>
          Promise.resolve(embeddedServerLike as unknown as Awaited<ReturnType<typeof startControlPlaneStreamServer>>)
      }
    ),
    /unexpected session id/
  );
  assert.equal(closed, true);
});

void test('openCodexControlPlaneSession close is best-effort when daemon is already down', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new TestLiveSession(input)
  });
  const address = server.address();
  const opened = await openCodexControlPlaneSession({
    controlPlane: {
      mode: 'remote',
      host: address.address,
      port: address.port
    },
    sessionId: 'best-effort-close',
    args: [],
    env: {
      TERM: 'xterm-256color'
    },
    initialCols: 80,
    initialRows: 24
  });

  await server.close();
  await opened.close();
});
