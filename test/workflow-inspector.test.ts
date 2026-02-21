import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import {
  buildInspectorProfileStartExpression,
  buildInspectorProfileStopExpression,
  connectGatewayInspector,
  DEFAULT_PROFILE_INSPECT_TIMEOUT_MS,
  evaluateInspectorExpression,
  InspectorWebSocketClient,
  readInspectorProfileState,
} from '../src/cli/workflows/inspector.ts';

interface ConnectBehavior {
  readonly mode: 'open' | 'error' | 'never';
  readonly autoRespond?: boolean;
}

type SocketListener = (event: { data?: unknown }) => void;

class FakeSocket {
  public readonly sentPayloads: string[] = [];
  public throwOnSend: Error | null = null;
  private readonly listeners = new Map<
    string,
    Array<{ listener: SocketListener; once: boolean }>
  >();

  constructor(
    public readonly endpoint: string,
    private readonly behavior: ConnectBehavior = { mode: 'open' },
  ) {
    if (this.behavior.mode === 'open') {
      setTimeout(() => this.emit('open', {}), 0);
    } else if (this.behavior.mode === 'error') {
      setTimeout(() => this.emit('error', {}), 0);
    }
  }

  addEventListener(
    type: string,
    listener: SocketListener,
    options?: boolean | { once?: boolean },
  ): void {
    const once = typeof options === 'object' && options?.once === true;
    const bucket = this.listeners.get(type) ?? [];
    bucket.push({ listener, once });
    this.listeners.set(type, bucket);
  }

  send(payload: string): void {
    if (this.throwOnSend !== null) {
      throw this.throwOnSend;
    }
    this.sentPayloads.push(payload);
    if (this.behavior.autoRespond !== true) {
      return;
    }
    const parsed = JSON.parse(payload) as { id?: number };
    setTimeout(() => {
      this.emit('message', {
        data: JSON.stringify({
          id: parsed.id,
          result: {},
        }),
      });
    }, 0);
  }

  close(): void {
    this.emit('close', {});
  }

  emit(type: string, event: { data?: unknown }): void {
    const bucket = this.listeners.get(type) ?? [];
    if (bucket.length === 0) {
      return;
    }
    const persistent: Array<{ listener: SocketListener; once: boolean }> = [];
    for (const entry of bucket) {
      entry.listener(event);
      if (!entry.once) {
        persistent.push(entry);
      }
    }
    this.listeners.set(type, persistent);
  }
}

let connectBehaviors: ConnectBehavior[] = [];

class FakeConnectWebSocket extends FakeSocket {
  constructor(endpoint: string) {
    super(endpoint, connectBehaviors.shift() ?? { mode: 'open' });
  }
}

type InspectorClientCtor = new (socket: WebSocket, endpoint: string) => InspectorWebSocketClient;

function createInspectorClient(
  socket: FakeSocket,
  endpoint = 'ws://fake',
): InspectorWebSocketClient {
  return new (InspectorWebSocketClient as unknown as InspectorClientCtor)(
    socket as unknown as WebSocket,
    endpoint,
  );
}

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'workflow-inspector-test-'));
}

test('inspector websocket client resolves command responses and handles error/timeout/close paths', async () => {
  const socket = new FakeSocket('ws://local', { mode: 'never' });
  const client = createInspectorClient(socket, 'ws://local');

  const successPromise = client.sendCommand('Runtime.evaluate', { expression: '1+1' }, 50);
  const successPayload = JSON.parse(socket.sentPayloads[0] ?? '{}') as { id: number };
  socket.emit('message', {
    data: JSON.stringify({
      id: successPayload.id,
      result: { value: 2 },
    }),
  });
  assert.deepEqual(await successPromise, { value: 2 });

  const emptyResultPromise = client.sendCommand('Runtime.evaluate', {}, 50);
  const emptyPayload = JSON.parse(socket.sentPayloads[1] ?? '{}') as { id: number };
  socket.emit('message', {
    data: JSON.stringify({
      id: emptyPayload.id,
      result: 'invalid',
    }),
  });
  assert.deepEqual(await emptyResultPromise, {});

  const errorPromise = client.sendCommand('Profiler.enable', {}, 50);
  const errorPayload = JSON.parse(socket.sentPayloads[2] ?? '{}') as { id: number };
  socket.emit('message', {
    data: JSON.stringify({
      id: errorPayload.id,
      error: {
        code: 500,
        message: 'boom',
      },
    }),
  });
  await assert.rejects(errorPromise, /Profiler.enable failed \(500\): boom/u);

  const timeoutPromise = client.sendCommand('Runtime.evaluate', {}, 1);
  await assert.rejects(timeoutPromise, /timed out/u);

  const pendingPromise = client.sendCommand('Runtime.evaluate', {}, 50);
  client.close();
  await assert.rejects(pendingPromise, /inspector websocket closed/u);
  client.close();
});

test('inspector websocket client rejects send errors', async () => {
  const socket = new FakeSocket('ws://local', { mode: 'never' });
  socket.throwOnSend = new Error('send failed');
  const client = createInspectorClient(socket, 'ws://local');
  await assert.rejects(client.sendCommand('Runtime.evaluate', {}, 50), /send failed/u);
});

test('inspector websocket client surfaces socket error events', async () => {
  const socket = new FakeSocket('ws://local', { mode: 'never' });
  const client = createInspectorClient(socket, 'ws://local');
  const pending = client.sendCommand('Runtime.evaluate', {}, 50);
  socket.emit('error', {});
  await assert.rejects(pending, /inspector websocket error/u);
});

test('inspector websocket connect handles open, error, and timeout outcomes', async () => {
  const originalWebSocket = globalThis.WebSocket;
  (globalThis as { WebSocket: typeof WebSocket }).WebSocket =
    FakeConnectWebSocket as unknown as typeof WebSocket;
  try {
    connectBehaviors = [{ mode: 'open' }];
    const connected = await InspectorWebSocketClient.connect('ws://open', 50);
    connected.close();

    connectBehaviors = [{ mode: 'error' }];
    await assert.rejects(
      InspectorWebSocketClient.connect('ws://error', 50),
      /connect failed \(ws:\/\/error\)/u,
    );

    connectBehaviors = [{ mode: 'never' }];
    await assert.rejects(
      InspectorWebSocketClient.connect('ws://timeout', 1),
      /connect timeout \(ws:\/\/timeout\)/u,
    );
  } finally {
    (globalThis as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
  }
});

test('inspector evaluate/read helpers map thrown and malformed runtime payloads', async () => {
  const fakeOkClient = {
    sendCommand: async (): Promise<Record<string, unknown>> => ({
      result: { value: 7 },
    }),
  } as unknown as InspectorWebSocketClient;
  assert.equal(await evaluateInspectorExpression(fakeOkClient, '1+6', 10), 7);

  const fakeThrownClient = {
    sendCommand: async (): Promise<Record<string, unknown>> => ({
      wasThrown: true,
      exceptionDetails: { text: 'bad eval' },
    }),
  } as unknown as InspectorWebSocketClient;
  await assert.rejects(
    evaluateInspectorExpression(fakeThrownClient, 'bad()', 10),
    /inspector runtime evaluate failed: bad eval/u,
  );

  const fakeThrownFallbackClient = {
    sendCommand: async (): Promise<Record<string, unknown>> => ({
      wasThrown: true,
    }),
  } as unknown as InspectorWebSocketClient;
  await assert.rejects(
    evaluateInspectorExpression(fakeThrownFallbackClient, 'bad()', 10),
    /inspector runtime evaluate failed/u,
  );

  const validStateClient = {
    sendCommand: async (): Promise<Record<string, unknown>> => ({
      result: {
        value: JSON.stringify({
          status: 'running',
          error: null,
          written: true,
        }),
      },
    }),
  } as unknown as InspectorWebSocketClient;
  assert.deepEqual(await readInspectorProfileState(validStateClient, 10), {
    status: 'running',
    error: null,
    written: true,
  });

  const invalidStateClient = {
    sendCommand: async (): Promise<Record<string, unknown>> => ({
      result: {
        value: JSON.stringify({
          status: 42,
          error: null,
          written: true,
        }),
      },
    }),
  } as unknown as InspectorWebSocketClient;
  assert.equal(await readInspectorProfileState(invalidStateClient, 10), null);
});

test('connectGatewayInspector resolves log candidates, validates Runtime.enable, and reports failures', async () => {
  const workspace = createWorkspace();
  const logPath = resolve(workspace, 'gateway.log');
  writeFileSync(
    logPath,
    [
      'inspector ws://bad.example/harness-gateway',
      'inspector ws://good.example/harness-gateway',
      'inspector ws://bad.example/harness-gateway',
      'inspector http://skip.example/not-ws',
      '',
    ].join('\n'),
    'utf8',
  );

  const originalWebSocket = globalThis.WebSocket;
  (globalThis as { WebSocket: typeof WebSocket }).WebSocket =
    FakeConnectWebSocket as unknown as typeof WebSocket;
  try {
    connectBehaviors = [{ mode: 'error' }, { mode: 'open', autoRespond: true }];
    const connected = await connectGatewayInspector(workspace, logPath, 50);
    assert.equal(connected.endpoint, 'ws://good.example/harness-gateway');
    connected.client.close();

    connectBehaviors = [{ mode: 'error' }];
    await assert.rejects(
      connectGatewayInspector(workspace, logPath, 50),
      /gateway inspector endpoint unavailable/u,
    );

    await assert.rejects(
      connectGatewayInspector(workspace, resolve(workspace, 'missing.log'), 10),
      /gateway inspector endpoint unavailable/u,
    );
  } finally {
    (globalThis as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
  }
});

test('inspector expression builders include runtime keys and profile paths', () => {
  const startExpression = buildInspectorProfileStartExpression();
  const stopExpression = buildInspectorProfileStopExpression('/tmp/gateway.cpuprofile', '/tmp');
  assert.equal(startExpression.includes('__HARNESS_GATEWAY_CPU_PROFILE_STATE__'), true);
  assert.equal(stopExpression.includes('/tmp/gateway.cpuprofile'), true);
  assert.equal(stopExpression.includes('/tmp'), true);
  assert.equal(DEFAULT_PROFILE_INSPECT_TIMEOUT_MS > 0, true);
});
