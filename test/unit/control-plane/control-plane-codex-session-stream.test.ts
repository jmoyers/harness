import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import {
  openCodexControlPlaneClient,
  openCodexControlPlaneSession,
  subscribeControlPlaneKeyEvents,
} from '../../../src/control-plane/codex-session-stream.ts';
import {
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../../../src/control-plane/stream-server.ts';
import type { CodexLiveEvent } from '../../../src/codex/live-session.ts';
import type { PtyExit } from '../../../src/pty/pty_host.ts';
import { TerminalSnapshotOracle } from '../../../src/terminal/snapshot-oracle.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  type StreamClientEnvelope,
} from '../../../src/control-plane/stream-protocol.ts';
import { statusModelFor } from '../../support/status-model.ts';

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
        chunk,
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
  onMessage: (socket: Socket, envelope: StreamClientEnvelope) => void,
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
    },
  };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

void test('openCodexControlPlaneSession opens and closes a remote session', async () => {
  const startedInputs: StartControlPlaneSessionInput[] = [];
  const server = await startControlPlaneStreamServer({
    authToken: 'remote-secret',
    startSession: (input) => {
      startedInputs.push(input);
      return new TestLiveSession(input);
    },
  });
  const address = server.address();

  const opened = await openCodexControlPlaneSession({
    controlPlane: {
      mode: 'remote',
      host: address.address,
      port: address.port,
      authToken: 'remote-secret',
    },
    sessionId: 'remote-session',
    args: [],
    env: {
      TERM: 'xterm-256color',
    },
    cwd: '/tmp/remote-session',
    initialCols: 80,
    initialRows: 24,
  });

  try {
    const status = await opened.client.sendCommand({
      type: 'session.status',
      sessionId: 'remote-session',
    });
    assert.equal(status['sessionId'], 'remote-session');
    assert.equal(startedInputs[0]?.cwd, '/tmp/remote-session');
  } finally {
    await opened.close();
    await server.close();
  }
});

void test('openCodexControlPlaneClient opens remote stream without starting a session', async () => {
  const server = await startControlPlaneStreamServer({
    authToken: 'client-only-secret',
    startSession: (input) => new TestLiveSession(input),
  });
  const address = server.address();
  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: address.address,
    port: address.port,
    authToken: 'client-only-secret',
    connectRetryWindowMs: 250,
    connectRetryDelayMs: 25,
  });

  try {
    const listed = await opened.client.sendCommand({
      type: 'session.list',
    });
    assert.deepEqual(listed['sessions'], []);
  } finally {
    await opened.close();
    await server.close();
  }
});

void test('openCodexControlPlaneSession supports embedded mode with injected server factory', async () => {
  const embeddedServer = await startControlPlaneStreamServer({
    startSession: (input) => new TestLiveSession(input),
  });
  const embeddedPort = embeddedServer.address().port;

  const opened = await openCodexControlPlaneSession(
    {
      controlPlane: {
        mode: 'embedded',
      },
      sessionId: 'embedded-session',
      args: [],
      env: {
        TERM: 'xterm-256color',
      },
      initialCols: 80,
      initialRows: 24,
    },
    {
      startEmbeddedServer: () => Promise.resolve(embeddedServer),
    },
  );

  try {
    const listed = await opened.client.sendCommand({
      type: 'session.list',
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
    }),
  );
});

void test('openCodexControlPlaneSession closes client when start command fails', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new TestLiveSession(input),
  });
  const address = server.address();

  const first = await openCodexControlPlaneSession({
    controlPlane: {
      mode: 'remote',
      host: address.address,
      port: address.port,
    },
    sessionId: 'duplicate-session',
    args: [],
    env: {
      TERM: 'xterm-256color',
    },
    initialCols: 80,
    initialRows: 24,
  });

  try {
    await assert.rejects(
      openCodexControlPlaneSession({
        controlPlane: {
          mode: 'remote',
          host: address.address,
          port: address.port,
        },
        sessionId: 'duplicate-session',
        args: [],
        env: {
          TERM: 'xterm-256color',
        },
        initialCols: 80,
        initialRows: 24,
      }),
      /session already exists/,
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
        mode: 'embedded',
      },
      sessionId: 'embedded-missing-dependency',
      args: [],
      env: {
        TERM: 'xterm-256color',
      },
      initialCols: 80,
      initialRows: 24,
    }),
    /startEmbeddedServer dependency/,
  );
});

void test('openCodexControlPlaneSession rejects mismatched pty.start session id', async () => {
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind === 'command') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.accepted',
          commandId: envelope.commandId,
        }),
      );
      if (envelope.command.type === 'pty.start') {
        socket.write(
          encodeStreamEnvelope({
            kind: 'command.completed',
            commandId: envelope.commandId,
            result: {
              sessionId: 'unexpected-session',
            },
          }),
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
          port: harness.address.port,
        },
        sessionId: 'expected-session',
        args: [],
        env: {
          TERM: 'xterm-256color',
        },
        initialCols: 80,
        initialRows: 24,
        terminalForegroundHex: 'ffffff',
        terminalBackgroundHex: '000000',
      }),
      /unexpected session id/,
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
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'pty.start') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            sessionId: 'wrong-embedded-session',
          },
        }),
      );
    }
  });

  let closed = false;
  const embeddedServerLike = {
    address: () => ({
      address: harness.address.address,
      family: harness.address.family,
      port: harness.address.port,
    }),
    close: async () => {
      closed = true;
      await harness.stop();
    },
  };

  await assert.rejects(
    openCodexControlPlaneSession(
      {
        controlPlane: {
          mode: 'embedded',
        },
        sessionId: 'embedded-expected',
        args: [],
        env: {
          TERM: 'xterm-256color',
        },
        initialCols: 80,
        initialRows: 24,
      },
      {
        startEmbeddedServer: () =>
          Promise.resolve(
            embeddedServerLike as unknown as Awaited<
              ReturnType<typeof startControlPlaneStreamServer>
            >,
          ),
      },
    ),
    /unexpected session id/,
  );
  assert.equal(closed, true);
});

void test('openCodexControlPlaneSession close is best-effort when daemon is already down', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new TestLiveSession(input),
  });
  const address = server.address();
  const opened = await openCodexControlPlaneSession({
    controlPlane: {
      mode: 'remote',
      host: address.address,
      port: address.port,
    },
    sessionId: 'best-effort-close',
    args: [],
    env: {
      TERM: 'xterm-256color',
    },
    initialCols: 80,
    initialRows: 24,
  });

  await server.close();
  await opened.close();
});

void test('subscribeControlPlaneKeyEvents maps session-status and session-key-event updates', async () => {
  const streamSubscriptionId = 'subscription-key-events';
  let unsubscribed = false;
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );

    if (envelope.command.type === 'stream.subscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: streamSubscriptionId,
            cursor: 12,
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: streamSubscriptionId,
          cursor: 13,
          event: {
            type: 'session-status',
            sessionId: 'conversation-1',
            status: 'running',
            attentionReason: null,
            statusModel: statusModelFor('running'),
            live: true,
            ts: '2026-01-01T00:00:00.000Z',
            directoryId: 'directory-1',
            conversationId: 'conversation-1',
            controller: null,
            telemetry: {
              source: 'otlp-log',
              eventName: 'codex.api_request',
              severity: 'INFO',
              summary: 'codex.api_request (ok)',
              observedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: streamSubscriptionId,
          cursor: 14,
          event: {
            type: 'session-key-event',
            sessionId: 'conversation-1',
            keyEvent: {
              source: 'otlp-log',
              eventName: 'codex.sse_event',
              severity: 'INFO',
              summary: 'response.completed',
              observedAt: '2026-01-01T00:00:01.000Z',
              statusHint: 'completed',
            },
            ts: '2026-01-01T00:00:01.000Z',
            directoryId: 'directory-1',
            conversationId: 'conversation-1',
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: streamSubscriptionId,
          cursor: 15,
          event: {
            type: 'session-control',
            sessionId: 'conversation-1',
            action: 'claimed',
            controller: {
              controllerId: 'agent-1',
              controllerType: 'agent',
              controllerLabel: 'agent one',
              claimedAt: '2026-01-01T00:00:02.000Z',
            },
            previousController: null,
            reason: 'claim',
            ts: '2026-01-01T00:00:02.000Z',
            directoryId: 'directory-1',
            conversationId: 'conversation-1',
          },
        }),
      );
      return;
    }

    if (envelope.command.type === 'stream.unsubscribe') {
      unsubscribed = true;
      assert.equal(envelope.command.subscriptionId, streamSubscriptionId);
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            unsubscribed: true,
          },
        }),
      );
      return;
    }

    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: harness.address.address,
    port: harness.address.port,
  });

  try {
    const observed: Array<Record<string, unknown>> = [];
    const subscription = await subscribeControlPlaneKeyEvents(opened.client, {
      onEvent: (event) => {
        observed.push(event as unknown as Record<string, unknown>);
      },
    });
    await waitForCondition(() => observed.length === 3);

    assert.equal(observed.length, 3);
    assert.equal(observed[0]?.['type'], 'session-status');
    assert.equal(observed[0]?.['cursor'], 13);
    assert.equal(observed[1]?.['type'], 'session-telemetry');
    assert.equal(observed[1]?.['cursor'], 14);
    assert.equal(observed[2]?.['type'], 'session-control');
    assert.equal(observed[2]?.['cursor'], 15);
    await subscription.close();
    assert.equal(unsubscribed, true);
  } finally {
    await opened.close();
    await harness.stop();
  }
});

void test('subscribeControlPlaneKeyEvents emits post-subscribe events without buffering', async () => {
  const streamSubscriptionId = 'subscription-post-subscribe';
  let unsubscribed = false;
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: streamSubscriptionId,
            cursor: 33,
          },
        }),
      );
      setTimeout(() => {
        socket.write(
          encodeStreamEnvelope({
            kind: 'stream.event',
            subscriptionId: streamSubscriptionId,
            cursor: 34,
            event: {
              type: 'session-status',
              sessionId: 'conversation-live',
              status: 'running',
              attentionReason: null,
              statusModel: statusModelFor('running'),
              live: true,
              ts: '2026-01-01T00:00:03.000Z',
              directoryId: 'directory-live',
              conversationId: 'conversation-live',
              controller: null,
              telemetry: null,
            },
          }),
        );
      }, 0);
      return;
    }
    if (envelope.command.type === 'stream.unsubscribe') {
      unsubscribed = true;
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            unsubscribed: true,
          },
        }),
      );
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: harness.address.address,
    port: harness.address.port,
  });

  try {
    const observed: Array<Record<string, unknown>> = [];
    const subscription = await subscribeControlPlaneKeyEvents(opened.client, {
      onEvent: (event) => {
        observed.push(event as unknown as Record<string, unknown>);
      },
    });
    await waitForCondition(() => observed.length === 1);

    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.['type'], 'session-status');
    assert.equal(observed[0]?.['cursor'], 34);
    await subscription.close();
    assert.equal(unsubscribed, true);
  } finally {
    await opened.close();
    await harness.stop();
  }
});

void test('subscribeControlPlaneKeyEvents rejects malformed subscription ids', async () => {
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: 123,
          },
        }),
      );
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: harness.address.address,
    port: harness.address.port,
  });

  try {
    await assert.rejects(
      subscribeControlPlaneKeyEvents(opened.client, {
        onEvent: () => {},
      }),
      /malformed subscription id/,
    );
  } finally {
    await opened.close();
    await harness.stop();
  }
});

void test('subscribeControlPlaneKeyEvents applies scope filters and ignores unrelated stream envelopes', async () => {
  const streamSubscriptionId = 'subscription-scoped';
  let subscribeCommandSeen = false;
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      subscribeCommandSeen = true;
      assert.equal(envelope.command.tenantId, 'tenant-1');
      assert.equal(envelope.command.userId, 'user-1');
      assert.equal(envelope.command.workspaceId, 'workspace-1');
      assert.equal(envelope.command.directoryId, 'directory-1');
      assert.equal(envelope.command.conversationId, 'conversation-1');
      assert.equal(envelope.command.includeOutput, true);
      assert.equal(envelope.command.afterCursor, 5);
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: streamSubscriptionId,
            cursor: 5,
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: streamSubscriptionId,
          cursor: 6,
          event: {
            type: 'directory-upserted',
            directory: {
              directoryId: 'directory-1',
            },
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'stream.event',
          subscriptionId: 'subscription-other',
          cursor: 7,
          event: {
            type: 'session-status',
            sessionId: 'conversation-1',
            status: 'running',
            attentionReason: null,
            statusModel: statusModelFor('running'),
            live: true,
            ts: '2026-01-01T00:00:00.000Z',
            directoryId: 'directory-1',
            conversationId: 'conversation-1',
            controller: null,
            telemetry: null,
          },
        }),
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'pty.output',
          sessionId: 'conversation-1',
          cursor: 1,
          chunkBase64: Buffer.from('ignored', 'utf8').toString('base64'),
        }),
      );
      setTimeout(() => {
        socket.write(
          encodeStreamEnvelope({
            kind: 'stream.event',
            subscriptionId: streamSubscriptionId,
            cursor: 8,
            event: {
              type: 'session-status',
              sessionId: 'conversation-1',
              status: 'running',
              attentionReason: null,
              statusModel: statusModelFor('running'),
              live: true,
              ts: '2026-01-01T00:00:01.000Z',
              directoryId: 'directory-1',
              conversationId: 'conversation-1',
              controller: null,
              telemetry: null,
            },
          }),
        );
      }, 1);
      return;
    }

    if (envelope.command.type === 'stream.unsubscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            unsubscribed: true,
          },
        }),
      );
      return;
    }

    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: harness.address.address,
    port: harness.address.port,
  });

  try {
    const observed: Array<Record<string, unknown>> = [];
    const subscription = await subscribeControlPlaneKeyEvents(opened.client, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      directoryId: 'directory-1',
      conversationId: 'conversation-1',
      includeOutput: true,
      afterCursor: 5,
      onEvent: (event) => {
        observed.push(event as unknown as Record<string, unknown>);
      },
    });
    await waitForCondition(() => observed.length === 1);
    assert.equal(subscribeCommandSeen, true);
    assert.equal(observed.length, 1);
    assert.equal(observed[0]?.['type'], 'session-status');
    await subscription.close();
  } finally {
    await opened.close();
    await harness.stop();
  }
});

void test('subscribeControlPlaneKeyEvents cleans up listener on subscribe failure and tolerates close errors', async () => {
  let subscribeAttempted = false;
  const harness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      subscribeAttempted = true;
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.failed',
          commandId: envelope.commandId,
          error: 'subscribe failed',
        }),
      );
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {},
      }),
    );
  });

  const opened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: harness.address.address,
    port: harness.address.port,
  });

  try {
    await assert.rejects(
      subscribeControlPlaneKeyEvents(opened.client, {
        onEvent: () => {},
      }),
      /subscribe failed/,
    );
    assert.equal(subscribeAttempted, true);
  } finally {
    await opened.close();
    await harness.stop();
  }

  const closeHarness = await startMockHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId,
      }),
    );
    if (envelope.command.type === 'stream.subscribe') {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            subscriptionId: 'subscription-close',
            cursor: 0,
          },
        }),
      );
      return;
    }
  });
  const closeOpened = await openCodexControlPlaneClient({
    mode: 'remote',
    host: closeHarness.address.address,
    port: closeHarness.address.port,
  });

  try {
    const subscription = await subscribeControlPlaneKeyEvents(closeOpened.client, {
      onEvent: () => {},
    });
    closeOpened.client.close();
    await subscription.close();
    await subscription.close();
  } finally {
    await closeOpened.close();
    await closeHarness.stop();
  }
});
