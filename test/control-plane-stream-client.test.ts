import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseClientEnvelope,
  type StreamClientEnvelope,
  type StreamServerEnvelope
} from '../src/control-plane/stream-protocol.ts';

interface HarnessServer {
  server: Server;
  address: AddressInfo;
  stop: () => Promise<void>;
}

interface WritableSocket {
  write(value: string): boolean;
  destroy(error?: Error): this;
}

async function reserveLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected tcp server address');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

async function startHarnessServer(
  onMessage: (socket: Socket, envelope: StreamClientEnvelope) => void
): Promise<HarnessServer> {
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
    throw new Error('expected tcp server address');
  }

  return {
    server,
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

void test('stream client handles command lifecycle, async envelopes, and shutdown', async () => {
  let commandCount = 0;

  const harness = await startHarnessServer((socket, envelope) => {
    if (envelope.kind !== 'command') {
      return;
    }

    commandCount += 1;
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId
      })
    );

    if (commandCount === 1) {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: envelope.commandId,
          result: {
            ok: true
          }
        })
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.completed',
          commandId: 'unknown-command',
          result: {
            ignored: true
          }
        })
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.failed',
          commandId: 'unknown-command',
          error: 'ignored'
        })
      );
      socket.write(
        encodeStreamEnvelope({
          kind: 'pty.event',
          sessionId: 'session-1',
          event: {
            type: 'session-exit',
            exit: {
              code: 0,
              signal: null
            }
          }
        })
      );
      return;
    }

    if (commandCount === 2) {
      socket.write(
        encodeStreamEnvelope({
          kind: 'command.failed',
          commandId: envelope.commandId,
          error: 'boom'
        })
      );
      return;
    }

    setTimeout(() => {
      socket.end();
    }, 5);
  });

  const client = await connectControlPlaneStreamClient({
    host: harness.address.address,
    port: harness.address.port
  });

  const observed: StreamServerEnvelope[] = [];
  const stopListening = client.onEnvelope((envelope) => {
    observed.push(envelope);
  });

  const firstResult = await client.sendCommand({
    type: 'pty.start',
    sessionId: 'session-1',
    args: [],
    initialCols: 80,
    initialRows: 24
  });
  assert.deepEqual(firstResult, {
    ok: true
  });

  await assert.rejects(
    client.sendCommand({
      type: 'pty.close',
      sessionId: 'session-1'
    }),
    /boom/
  );

  const pending = client.sendCommand({
    type: 'pty.attach',
    sessionId: 'session-1',
    sinceCursor: 0
  });
  await assert.rejects(pending, /closed/);

  stopListening();
  await delay(10);

  assert.equal(
    observed.some((envelope) => envelope.kind === 'pty.event' && envelope.event.type === 'session-exit'),
    true
  );

  await assert.rejects(
    client.sendCommand({
      type: 'pty.close',
      sessionId: 'session-1'
    }),
    /closed/
  );

  client.sendInput('session-1', Buffer.from('hello', 'utf8'));
  client.sendResize('session-1', 10, 10);
  client.sendSignal('session-1', 'interrupt');

  client.close();
  client.close();

  await harness.stop();
});

void test('stream client handles parse-ignore, socket error close, and connect failure', async () => {
  let resolveSocket: ((socket: WritableSocket) => void) | null = null;
  const socketReady = new Promise<WritableSocket>((resolve) => {
    resolveSocket = resolve;
  });
  const harness = await startHarnessServer((socket, envelope) => {
    const writableSocket = socket as WritableSocket;
    resolveSocket?.(writableSocket);
    if (envelope.kind !== 'command') {
      return;
    }
    writableSocket.write('{"kind":"unsupported"}\n');
    writableSocket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId
      })
    );
  });

  const client = await connectControlPlaneStreamClient({
    host: harness.address.address,
    port: harness.address.port
  });

  const pending = client.sendCommand({
    type: 'pty.close',
    sessionId: 'session-error'
  });
  const connectedSocket = await socketReady;
  const internalSocket = (client as unknown as { socket: Socket }).socket;
  internalSocket.emit('error', new Error('server-side-error'));
  connectedSocket.destroy();
  await assert.rejects(pending, /server-side-error|closed/);

  await harness.stop();

  await assert.rejects(
    connectControlPlaneStreamClient({
      host: '127.0.0.1',
      port: harness.address.port
    })
  );
});

void test('stream client supports auth handshake and globally unique command ids', async () => {
  const commandIds: string[] = [];
  const harness = await startHarnessServer((socket, envelope) => {
    if (envelope.kind === 'auth') {
      if (envelope.token === 'good-token') {
        socket.write(
          encodeStreamEnvelope({
            kind: 'auth.ok'
          })
        );
      } else {
        socket.write(
          encodeStreamEnvelope({
            kind: 'auth.error',
            error: 'invalid auth token'
          })
        );
        socket.end();
      }
      return;
    }

    if (envelope.kind !== 'command') {
      return;
    }
    commandIds.push(envelope.commandId);
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.accepted',
        commandId: envelope.commandId
      })
    );
    socket.write(
      encodeStreamEnvelope({
        kind: 'command.completed',
        commandId: envelope.commandId,
        result: {
          ok: true
        }
      })
    );
  });

  try {
    const client = await connectControlPlaneStreamClient({
      host: harness.address.address,
      port: harness.address.port,
      authToken: 'good-token'
    });
    try {
      const first = await client.sendCommand({
        type: 'session.list'
      });
      assert.deepEqual(first, { ok: true });
      const second = await client.sendCommand({
        type: 'session.list'
      });
      assert.deepEqual(second, { ok: true });
      assert.equal(commandIds.length, 2);
      assert.notEqual(commandIds[0], commandIds[1]);
      assert.match(commandIds[0]!, /^command-[0-9a-f-]{36}$/);
    } finally {
      client.close();
    }

    await assert.rejects(
      connectControlPlaneStreamClient({
        host: harness.address.address,
        port: harness.address.port,
        authToken: 'bad-token'
      }),
      /invalid auth token|closed/
    );
  } finally {
    await harness.stop();
  }
});

void test('stream client auth rejects when closed or already pending', async () => {
  const harness = await startHarnessServer(() => {
    // Intentionally do not respond to auth so pending-auth branches can be exercised.
  });
  const client = await connectControlPlaneStreamClient({
    host: harness.address.address,
    port: harness.address.port
  });

  try {
    const pendingAuth = client.authenticate('pending-token');
    await assert.rejects(client.authenticate('duplicate-token'), /already pending/);
    client.close();
    await assert.rejects(pendingAuth, /closed/);
    await assert.rejects(client.authenticate('after-close'), /closed/);
  } finally {
    await harness.stop();
  }
});

void test('stream client retries connection while server is starting', async () => {
  const port = await reserveLocalPort();
  const delayedServer = createServer((socket) => {
    socket.end();
  });
  setTimeout(() => {
    delayedServer.listen(port, '127.0.0.1');
  }, 120);

  try {
    const client = await connectControlPlaneStreamClient({
      host: '127.0.0.1',
      port,
      connectRetryWindowMs: 1000,
      connectRetryDelayMs: 20
    });
    client.close();
  } finally {
    await new Promise<void>((resolve) => {
      delayedServer.close(() => resolve());
    });
  }
});

void test('stream client transport helpers emit envelopes only while open', async () => {
  const observed: StreamClientEnvelope[] = [];
  const harness = await startHarnessServer((_socket, envelope) => {
    observed.push(envelope);
  });

  const client = await connectControlPlaneStreamClient({
    host: harness.address.address,
    port: harness.address.port
  });

  try {
    client.sendInput('session-transport', Buffer.from('hello', 'utf8'));
    client.sendResize('session-transport', 123, 45);
    client.sendSignal('session-transport', 'terminate');
    await delay(10);

    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'pty.input' &&
          envelope.sessionId === 'session-transport' &&
          Buffer.from(envelope.dataBase64, 'base64').toString('utf8') === 'hello'
      ),
      true
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'pty.resize' &&
          envelope.sessionId === 'session-transport' &&
          envelope.cols === 123 &&
          envelope.rows === 45
      ),
      true
    );
    assert.equal(
      observed.some(
        (envelope) =>
          envelope.kind === 'pty.signal' &&
          envelope.sessionId === 'session-transport' &&
          envelope.signal === 'terminate'
      ),
      true
    );

    const observedCount = observed.length;
    client.close();
    client.sendInput('session-transport', Buffer.from('ignored', 'utf8'));
    client.sendResize('session-transport', 1, 1);
    client.sendSignal('session-transport', 'interrupt');
    await delay(10);
    assert.equal(observed.length, observedCount);
  } finally {
    await harness.stop();
  }
});

void test('stream client connect treats non-retryable connect errors as fatal', async () => {
  await assert.rejects(
    connectControlPlaneStreamClient({
      host: '127.0.0.1',
      port: -1,
      connectRetryWindowMs: 1_000,
      connectRetryDelayMs: 20
    }),
    /ERR_SOCKET_BAD_PORT|port/
  );
});

void test('stream client connect stops retrying after retry window expires', async () => {
  const port = await reserveLocalPort();
  await assert.rejects(
    connectControlPlaneStreamClient({
      host: '127.0.0.1',
      port,
      connectRetryWindowMs: 25,
      connectRetryDelayMs: 10
    })
  );
});
