import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { test } from 'bun:test';
import { LifecycleHooksRuntime } from '../src/control-plane/lifecycle-hooks.ts';
import type { HarnessLifecycleHooksConfig } from '../src/config/config-core.ts';
import type { StreamObservedEvent } from '../src/control-plane/stream-protocol.ts';

function makeScope(): {
  tenantId: string;
  userId: string;
  workspaceId: string;
  directoryId: string;
  conversationId: string;
} {
  return {
    tenantId: 'tenant-test',
    userId: 'user-test',
    workspaceId: 'workspace-test',
    directoryId: 'directory-test',
    conversationId: 'conversation-test'
  };
}

async function listenHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected tcp address for test server');
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
  };
}

function makeConfig(overrides?: Partial<HarnessLifecycleHooksConfig>): HarnessLifecycleHooksConfig {
  return {
    enabled: true,
    providers: {
      codex: true,
      claude: true,
      controlPlane: true
    },
    peonPing: {
      enabled: false,
      baseUrl: 'http://127.0.0.1:19998',
      timeoutMs: 1200,
      eventCategoryMap: {}
    },
    webhooks: [],
    ...overrides
  };
}

interface LifecycleHookInternalConnector {
  id: string;
  dispatch: (event: unknown) => Promise<void>;
  close?: () => Promise<void>;
}

interface LifecycleHooksRuntimeInternals {
  normalizeObservedEvent: (
    scope: ReturnType<typeof makeScope>,
    event: StreamObservedEvent,
    cursor: number
  ) => ReadonlyArray<{
    eventType: string;
    provider: string;
    context: {
      sessionId: string | null;
    };
    ts: string;
  }>;
  dedupeSessionEvents: (
    events: ReadonlyArray<{
      eventType: string;
      context: {
        sessionId: string | null;
      };
      ts: string;
    }>
  ) => ReadonlyArray<{
    eventType: string;
    context: {
      sessionId: string | null;
    };
    ts: string;
  }>;
  buildLifecycleEvent: (
    scope: ReturnType<typeof makeScope>,
    observed: StreamObservedEvent,
    cursor: number,
    provider: string,
    eventType: string,
    details: {
      sessionId: string | null;
      summary: string;
      attributes: Record<string, unknown>;
    }
  ) => {
    ts: string;
  };
  pendingEvents: unknown[];
  connectors: LifecycleHookInternalConnector[];
  drainPendingEvents: () => Promise<void>;
  startDrainIfNeeded: () => void;
  drainPromise: Promise<void> | null;
}

function internals(runtime: LifecycleHooksRuntime): LifecycleHooksRuntimeInternals {
  return runtime as unknown as LifecycleHooksRuntimeInternals;
}

function makeSessionStatusEvent(
  scope: ReturnType<typeof makeScope>,
  status: 'running' | 'completed' | 'needs-input' | 'exited'
): StreamObservedEvent {
  return {
    type: 'session-status',
    sessionId: scope.conversationId,
    status,
    attentionReason: status === 'needs-input' ? 'approval' : null,
    live: status !== 'exited',
    ts: new Date().toISOString(),
    directoryId: scope.directoryId,
    conversationId: scope.conversationId,
    telemetry: null,
    controller: null
  };
}

void test('lifecycle hooks dispatch peon-ping categories from normalized session status transitions', async () => {
  const categories: string[] = [];
  const listener = await listenHttpServer((request, response) => {
    const requestUrl = request.url ?? '';
    const parsed = new URL(requestUrl, 'http://127.0.0.1');
    const category = parsed.searchParams.get('category');
    if (category !== null) {
      categories.push(category);
    }
    response.statusCode = 200;
    response.end('ok');
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      peonPing: {
        enabled: true,
        baseUrl: listener.baseUrl,
        timeoutMs: 1200,
        eventCategoryMap: {
          'turn.started': 'task.acknowledge',
          'turn.completed': 'task.complete'
        }
      }
    })
  );
  const scope = makeScope();
  const running: StreamObservedEvent = {
    type: 'session-status',
    sessionId: 'conversation-test',
    status: 'running',
    attentionReason: null,
    live: true,
    ts: new Date().toISOString(),
    directoryId: scope.directoryId,
    conversationId: scope.conversationId,
    telemetry: null,
    controller: null
  };
  const completed: StreamObservedEvent = {
    ...running,
    status: 'completed'
  };
  runtime.publish(scope, running, 1);
  runtime.publish(scope, completed, 2);

  await runtime.close();
  await listener.close();
  assert.deepEqual(categories, ['task.acknowledge', 'task.complete']);
});

void test('lifecycle hooks respect provider filters for codex vs control-plane events', async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const listener = await listenHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (body.length > 0) {
        payloads.push(JSON.parse(body) as Record<string, unknown>);
      }
      response.statusCode = 200;
      response.end('ok');
    });
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      providers: {
        codex: false,
        claude: true,
        controlPlane: true
      },
      webhooks: [
        {
          name: 'lifecycle-webhook',
          enabled: true,
          url: `${listener.baseUrl}/hooks/lifecycle`,
          method: 'POST',
          timeoutMs: 1200,
          headers: {},
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();

  runtime.publish(
    scope,
    {
      type: 'session-key-event',
      sessionId: 'conversation-test',
      keyEvent: {
        source: 'otlp-log',
        eventName: 'codex.user_prompt',
        severity: null,
        summary: 'prompt submitted',
        observedAt: new Date().toISOString(),
        statusHint: 'running'
      },
      ts: new Date().toISOString(),
      directoryId: scope.directoryId,
      conversationId: scope.conversationId
    },
    1
  );
  runtime.publish(
    scope,
    {
      type: 'conversation-created',
      conversation: {
        conversationId: 'conversation-test',
        createdAt: new Date().toISOString()
      }
    },
    2
  );

  await runtime.close();
  await listener.close();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.['eventType'], 'thread.created');
});

void test('lifecycle hooks continue processing after connector failures', async () => {
  let requestCount = 0;
  const listener = await listenHttpServer((_request, response) => {
    requestCount += 1;
    response.statusCode = requestCount === 1 ? 500 : 200;
    response.end('ok');
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      webhooks: [
        {
          name: 'unstable',
          enabled: true,
          url: `${listener.baseUrl}/hooks/lifecycle`,
          method: 'POST',
          timeoutMs: 1200,
          headers: {},
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();
  const running: StreamObservedEvent = {
    type: 'session-status',
    sessionId: 'conversation-test',
    status: 'running',
    attentionReason: null,
    live: true,
    ts: new Date().toISOString(),
    directoryId: scope.directoryId,
    conversationId: scope.conversationId,
    telemetry: null,
    controller: null
  };
  const completed: StreamObservedEvent = {
    ...running,
    status: 'completed'
  };
  runtime.publish(scope, running, 1);
  runtime.publish(scope, completed, 2);

  await runtime.close();
  await listener.close();
  assert.equal(requestCount >= 2, true);
});

void test('lifecycle hooks normalize conversation and session lifecycle variants', () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const scope = makeScope();
  const runtimeInternals = internals(runtime);

  const updated = runtimeInternals.normalizeObservedEvent(
    scope,
    {
      type: 'conversation-updated',
      conversation: {}
    },
    1
  );
  assert.equal(updated[0]?.eventType, 'thread.updated');
  assert.equal(updated[0]?.context.sessionId, null);

  const archived = runtimeInternals.normalizeObservedEvent(
    scope,
    {
      type: 'conversation-archived',
      conversationId: scope.conversationId,
      ts: new Date().toISOString()
    },
    2
  );
  assert.equal(archived[0]?.eventType, 'thread.archived');

  const deleted = runtimeInternals.normalizeObservedEvent(
    scope,
    {
      type: 'conversation-deleted',
      conversationId: scope.conversationId,
      ts: new Date().toISOString()
    },
    3
  );
  assert.equal(deleted[0]?.eventType, 'thread.deleted');

  runtimeInternals.normalizeObservedEvent(scope, makeSessionStatusEvent(scope, 'running'), 4);
  const needsInput = runtimeInternals.normalizeObservedEvent(scope, makeSessionStatusEvent(scope, 'needs-input'), 5);
  assert.equal(needsInput.some((event) => event.eventType === 'input.required'), true);
  const exited = runtimeInternals.normalizeObservedEvent(scope, makeSessionStatusEvent(scope, 'exited'), 6);
  assert.equal(exited.some((event) => event.eventType === 'session.exited'), true);

  const sessionExitFailure = runtimeInternals.normalizeObservedEvent(
    scope,
    {
      type: 'session-event',
      sessionId: `${scope.conversationId}-exit`,
      event: {
        type: 'session-exit',
        exit: {
          code: 1,
          signal: 'SIGTERM'
        }
      },
      ts: new Date().toISOString(),
      directoryId: scope.directoryId,
      conversationId: `${scope.conversationId}-exit`
    },
    7
  );
  assert.deepEqual(
    sessionExitFailure.map((event) => event.eventType),
    ['session.exited', 'turn.failed']
  );

  const notifyIgnored = runtimeInternals.normalizeObservedEvent(
    scope,
    {
      type: 'session-event',
      sessionId: `${scope.conversationId}-notify`,
      event: {
        type: 'notify',
        record: {
          ts: new Date().toISOString(),
          payload: { type: 'agent-turn-complete' }
        }
      },
      ts: new Date().toISOString(),
      directoryId: scope.directoryId,
      conversationId: `${scope.conversationId}-notify`
    },
    8
  );
  assert.deepEqual(notifyIgnored, []);

  const ignored = runtimeInternals.normalizeObservedEvent(
    scope,
    {
      type: 'directory-upserted',
      directory: {}
    },
    9
  );
  assert.deepEqual(ignored, []);
});

void test('lifecycle hooks normalize codex and claude key events into unified lifecycle events', () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const scope = makeScope();
  const runtimeInternals = internals(runtime);
  const telemetryEvent = (
    eventName: string,
    summary: string | null,
    severity: string | null,
    statusHint: 'running' | 'completed' | 'needs-input' | null,
    source = 'custom'
  ): StreamObservedEvent => ({
    type: 'session-key-event',
    sessionId: `${scope.conversationId}-${eventName}`,
    keyEvent: {
      source: source as 'history',
      eventName,
      severity,
      summary,
      observedAt: new Date().toISOString(),
      statusHint
    },
    ts: new Date().toISOString(),
    directoryId: scope.directoryId,
    conversationId: scope.conversationId
  });

  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.turn.e2e_duration_ms', 'turn complete (14ms)', null, null), 1)
      .some((event) => event.eventType === 'turn.completed'),
    true
  );
  const defaultSummaryRuntime = new LifecycleHooksRuntime(makeConfig());
  const defaultSummaryInternals = internals(defaultSummaryRuntime);
  assert.equal(
    defaultSummaryInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.turn.e2e_duration_ms', null, null, null), 1)
      .some((event) => (event as { summary?: string }).summary === 'turn completed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('claude.pretooluse', 'tool start', null, null), 2)
      .some((event) => event.eventType === 'tool.started' && event.provider === 'claude'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('claude.userpromptsubmit', 'prompt', null, null), 3)
      .some((event) => event.eventType === 'turn.started'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('claude.posttooluse', 'tool completed', null, null), 3)
      .some((event) => event.eventType === 'tool.completed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('claude.userpromptsubmit.otlp', 'prompt', null, null, 'otlp-log'), 3)
      .some((event) => event.eventType === 'turn.started' && event.provider === 'claude'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('custom.event', 'turn completed (22ms)', null, null), 3)
      .some((event) => event.eventType === 'turn.completed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.tool_result', 'failed tool', 'ERROR', null), 4)
      .some((event) => event.eventType === 'tool.failed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.tool_result', 'ok', null, null), 5)
      .some((event) => event.eventType === 'tool.completed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.notification', 'notification', null, null), 6)
      .some((event) => event.eventType === 'input.required'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.api_request', 'error upstream', null, null), 7)
      .some((event) => event.eventType === 'turn.failed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.api_request.abort', 'request abort', null, null), 7)
      .some((event) => event.eventType === 'turn.failed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, telemetryEvent('codex.api_request.fatal', 'api request', 'FATAL', null), 7)
      .some((event) => event.eventType === 'turn.failed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(
        scope,
        telemetryEvent('ignored.event', null, null, 'needs-input', 'otlp-log'),
        8
      )
      .some((event) => event.provider === 'codex'),
    true
  );
});

void test('lifecycle hooks provider filtering gates claude and unknown provider events', () => {
  const claudeDisabled = new LifecycleHooksRuntime(
    makeConfig({
      providers: {
        codex: true,
        claude: false,
        controlPlane: true
      }
    })
  );
  const unknownDisabled = new LifecycleHooksRuntime(
    makeConfig({
      providers: {
        codex: false,
        claude: false,
        controlPlane: true
      }
    })
  );
  const scope = makeScope();

  const claudeEvent: StreamObservedEvent = {
    type: 'session-key-event',
    sessionId: scope.conversationId,
    keyEvent: {
      source: 'custom' as 'history',
      eventName: 'claude.pretooluse',
      severity: null,
      summary: 'tool start',
      observedAt: new Date().toISOString(),
      statusHint: null
    },
    ts: new Date().toISOString(),
    directoryId: scope.directoryId,
    conversationId: scope.conversationId
  };
  assert.deepEqual(internals(claudeDisabled).normalizeObservedEvent(scope, claudeEvent, 1), []);

  const unknownProviderEvent: StreamObservedEvent = {
    ...claudeEvent,
    keyEvent: {
      ...claudeEvent.keyEvent,
      eventName: 'custom.event',
      statusHint: 'needs-input'
    }
  };
  assert.deepEqual(internals(unknownDisabled).normalizeObservedEvent(scope, unknownProviderEvent, 2), []);
  assert.notEqual(internals(claudeDisabled).normalizeObservedEvent(scope, unknownProviderEvent, 3).length, 0);
});

void test('lifecycle hooks webhook filter and timeout=0 path are exercised', async () => {
  let requestCount = 0;
  const bodies: string[] = [];
  const listener = await listenHttpServer((request, response) => {
    requestCount += 1;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      response.statusCode = 200;
      response.end('ok');
    });
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      webhooks: [
        {
          name: 'get-only-complete',
          enabled: true,
          url: `${listener.baseUrl}/hook`,
          method: 'GET',
          timeoutMs: 0,
          headers: {},
          eventTypes: ['turn.completed']
        }
      ]
    })
  );
  const scope = makeScope();
  runtime.publish(scope, makeSessionStatusEvent(scope, 'running'), 1);
  runtime.publish(scope, makeSessionStatusEvent(scope, 'completed'), 2);
  await runtime.close();
  await listener.close();
  assert.equal(requestCount, 1);
  assert.deepEqual(bodies, ['']);
});

void test('lifecycle hooks peon-ping failures are tolerated and unmapped events are skipped', async () => {
  let requestCount = 0;
  const listener = await listenHttpServer((_request, response) => {
    requestCount += 1;
    response.statusCode = 503;
    response.end('unavailable');
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      peonPing: {
        enabled: true,
        baseUrl: `${listener.baseUrl}/`,
        timeoutMs: 1200,
        eventCategoryMap: {
          'turn.started': 'task.acknowledge'
        }
      }
    })
  );
  const scope = makeScope();
  runtime.publish(scope, makeSessionStatusEvent(scope, 'running'), 1);
  runtime.publish(scope, makeSessionStatusEvent(scope, 'completed'), 2);
  await runtime.close();
  await listener.close();
  assert.equal(requestCount, 1);
});

void test('lifecycle hooks internal queue/dedupe branches remain stable', async () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const scope = makeScope();
  const runtimeInternals = internals(runtime);
  let closeCalled = false;
  runtimeInternals.connectors.splice(0, runtimeInternals.connectors.length, {
    id: 'stub',
    dispatch: () => Promise.resolve(),
    close: () => {
      closeCalled = true;
      return Promise.resolve();
    }
  });

  const deduped = runtimeInternals.dedupeSessionEvents([
    {
      eventType: 'turn.completed',
      context: {
        sessionId: scope.conversationId
      },
      ts: new Date().toISOString()
    },
    {
      eventType: 'turn.completed',
      context: {
        sessionId: scope.conversationId
      },
      ts: new Date().toISOString()
    },
    {
      eventType: 'thread.created',
      context: {
        sessionId: null
      },
      ts: 'not-a-date'
    }
  ]);
  assert.equal(deduped.length, 2);

  const observedFunction = Object.assign(() => undefined, {
    type: 'session-output'
  }) as unknown as StreamObservedEvent;
  const builtFromFunction = runtimeInternals.buildLifecycleEvent(
    scope,
    observedFunction,
    9,
    'control-plane',
    'thread.created',
    {
      sessionId: null,
      summary: 'x',
      attributes: {}
    }
  );
  assert.equal(typeof builtFromFunction.ts, 'string');

  const builtWithInvalidTs = runtimeInternals.buildLifecycleEvent(
    scope,
    {
      type: 'session-output',
      sessionId: scope.conversationId,
      outputCursor: 1,
      chunkBase64: '',
      ts: 'bad-timestamp',
      directoryId: scope.directoryId,
      conversationId: scope.conversationId
    },
    10,
    'control-plane',
    'turn.started',
    {
      sessionId: scope.conversationId,
      summary: 'x',
      attributes: {}
    }
  );
  assert.equal(typeof builtWithInvalidTs.ts, 'string');

  runtimeInternals.pendingEvents.push(undefined);
  runtimeInternals.startDrainIfNeeded();
  if (runtimeInternals.drainPromise !== null) {
    await runtimeInternals.drainPromise;
  }

  runtimeInternals.pendingEvents.length = 0;
  for (let index = 0; index < 2048; index += 1) {
    runtimeInternals.pendingEvents.push({
      schemaVersion: '1',
      eventId: `event-${String(index)}`,
      eventType: 'thread.created',
      provider: 'control-plane',
      observedType: 'conversation-created',
      ts: new Date().toISOString(),
      cursor: index,
      summary: 'prefill',
      context: {
        sessionId: null
      },
      attributes: {}
    });
  }
  runtime.publish(
    scope,
    {
      type: 'conversation-created',
      conversation: {
        conversationId: scope.conversationId
      }
    },
    11
  );
  await runtime.close();
  assert.equal(closeCalled, true);
});

void test('lifecycle hooks drain restart branch executes when pending work remains after drain', async () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const runtimeInternals = internals(runtime);
  runtimeInternals.connectors.splice(0, runtimeInternals.connectors.length, {
    id: 'stub',
    dispatch: () => Promise.resolve()
  });
  runtimeInternals.pendingEvents.push({});
  let drainCount = 0;
  runtimeInternals.drainPendingEvents = () => {
    drainCount += 1;
    if (drainCount > 1) {
      runtimeInternals.pendingEvents.length = 0;
    }
    return Promise.resolve();
  };

  runtimeInternals.startDrainIfNeeded();
  if (runtimeInternals.drainPromise !== null) {
    await runtimeInternals.drainPromise;
  }
  await runtime.close();
  assert.equal(drainCount > 1, true);
});

void test('lifecycle hooks timeout path aborts stalled connector requests', async () => {
  const sockets = new Set<Socket>();
  const stalledServer = createServer(() => {
    // Intentionally keep request open so connector timeout path triggers AbortController.abort().
  });
  stalledServer.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    stalledServer.once('error', rejectListen);
    stalledServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = stalledServer.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolveClose) => {
      stalledServer.close(() => resolveClose());
    });
    throw new Error('stalled test server missing tcp address');
  }

  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      webhooks: [
        {
          name: 'abort-timeout',
          enabled: true,
          url: `http://127.0.0.1:${String(address.port)}/timeout`,
          method: 'POST',
          timeoutMs: 5,
          headers: {},
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();
  try {
    runtime.publish(scope, makeSessionStatusEvent(scope, 'running'), 1);
    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, 50);
    });
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolveClose) => {
      stalledServer.close(() => resolveClose());
    });
    await runtime.close();
  }
}, { timeout: 15000 });

void test('lifecycle hooks no-op when all connectors are disabled', async () => {
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      peonPing: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:19998',
        timeoutMs: 1200,
        eventCategoryMap: {}
      },
      webhooks: [
        {
          name: 'disabled-webhook',
          enabled: false,
          url: 'http://127.0.0.1:9/lifecycle',
          method: 'POST',
          timeoutMs: 1200,
          headers: {},
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();
  runtime.publish(scope, makeSessionStatusEvent(scope, 'running'), 1);
  await runtime.close();
});

void test('lifecycle hooks preserve explicit webhook content-type headers', async () => {
  const capturedContentTypes: string[] = [];
  const listener = await listenHttpServer((request, response) => {
    const header = request.headers['content-type'];
    if (typeof header === 'string') {
      capturedContentTypes.push(header);
    }
    response.statusCode = 200;
    response.end('ok');
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      webhooks: [
        {
          name: 'content-type-fixed',
          enabled: true,
          url: `${listener.baseUrl}/hook`,
          method: 'POST',
          timeoutMs: 1200,
          headers: {
            'content-type': 'application/x-harness-event'
          },
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();
  runtime.publish(scope, makeSessionStatusEvent(scope, 'running'), 1);
  await runtime.close();
  await listener.close();
  assert.equal(capturedContentTypes.length >= 1, true);
  assert.equal(
    capturedContentTypes.every((value) => value === 'application/x-harness-event'),
    true
  );
});

void test('lifecycle hooks publish no-ops for unmapped observed events with active connectors', async () => {
  let requestCount = 0;
  const listener = await listenHttpServer((_request, response) => {
    requestCount += 1;
    response.statusCode = 200;
    response.end('ok');
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      webhooks: [
        {
          name: 'active',
          enabled: true,
          url: `${listener.baseUrl}/hook`,
          method: 'POST',
          timeoutMs: 1200,
          headers: {},
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();
  runtime.publish(
    scope,
    {
      type: 'directory-upserted',
      directory: {
        directoryId: scope.directoryId
      }
    },
    1
  );
  await runtime.close();
  await listener.close();
  assert.equal(requestCount, 0);
});

void test('lifecycle hooks session-exit success emits exit without failure', () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const scope = makeScope();
  const events = internals(runtime).normalizeObservedEvent(
    scope,
    {
      type: 'session-event',
      sessionId: `${scope.conversationId}-success`,
      event: {
        type: 'session-exit',
        exit: {
          code: 0,
          signal: null
        }
      },
      ts: new Date().toISOString(),
      directoryId: scope.directoryId,
      conversationId: `${scope.conversationId}-success`
    },
    1
  );
  assert.deepEqual(events.map((event) => event.eventType), ['session.exited']);
});

void test('lifecycle hooks no-op repeated status updates without transitions', () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const scope = makeScope();
  const runtimeInternals = internals(runtime);
  const first = runtimeInternals.normalizeObservedEvent(scope, makeSessionStatusEvent(scope, 'completed'), 1);
  const second = runtimeInternals.normalizeObservedEvent(scope, makeSessionStatusEvent(scope, 'completed'), 2);
  assert.equal(first.some((event) => event.eventType === 'turn.completed'), true);
  assert.deepEqual(second, []);
});

void test('lifecycle hooks startDrainIfNeeded returns early while drain is active', async () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const runtimeInternals = internals(runtime);
  runtimeInternals.connectors.splice(0, runtimeInternals.connectors.length, {
    id: 'slow',
    dispatch: () =>
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 15);
      })
  });
  runtimeInternals.pendingEvents.push({
    schemaVersion: '1',
    eventId: 'slow-event',
    eventType: 'turn.started',
    provider: 'control-plane',
    observedType: 'session-status',
    ts: new Date().toISOString(),
    cursor: 1,
    summary: 'slow',
    context: {
      sessionId: 'session-slow'
    },
    attributes: {}
  });
  runtimeInternals.startDrainIfNeeded();
  runtimeInternals.startDrainIfNeeded();
  if (runtimeInternals.drainPromise !== null) {
    await runtimeInternals.drainPromise;
  }
  await runtime.close();
});

void test('lifecycle hooks cover nullish fallback branches for telemetry key events', () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const runtimeInternals = internals(runtime);
  const scope = makeScope();

  const keyEvent = (
    eventName: string | null,
    summary: string | null,
    severity: string | null
  ): StreamObservedEvent => ({
    type: 'session-key-event',
    sessionId: `${scope.conversationId}-${eventName ?? 'none'}`,
    keyEvent: {
      source: 'custom' as 'history',
      eventName,
      severity,
      summary,
      observedAt: new Date().toISOString(),
      statusHint: null
    },
    ts: new Date().toISOString(),
    directoryId: scope.directoryId,
    conversationId: scope.conversationId
  });

  assert.deepEqual(runtimeInternals.normalizeObservedEvent(scope, keyEvent(null, null, null), 1), []);
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, keyEvent('tool_call', null, null), 2)
      .some((event) => event.eventType === 'tool.started'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, keyEvent('tool_result', null, null), 3)
      .some((event) => event.eventType === 'tool.completed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, keyEvent('tool_result', null, 'ERROR'), 31)
      .some((event) => event.eventType === 'tool.failed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, keyEvent('user_prompt', null, null), 4)
      .some((event) => event.eventType === 'turn.started'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, keyEvent('codex.turn.e2e_duration_ms', 'turn complete (7ms)', null), 5)
      .some((event) => event.eventType === 'turn.completed'),
    true
  );
  assert.equal(
    runtimeInternals
      .normalizeObservedEvent(scope, keyEvent('api_request', null, 'ERROR'), 6)
      .some((event) => event.eventType === 'turn.failed'),
    true
  );
});

void test('lifecycle hooks fallback to empty sessionId in failure telemetry and parse invalid dedupe timestamps', async () => {
  let requestCount = 0;
  const listener = await listenHttpServer((_request, response) => {
    requestCount += 1;
    response.statusCode = 500;
    response.end('failed');
  });
  const runtime = new LifecycleHooksRuntime(
    makeConfig({
      webhooks: [
        {
          name: 'failing-null-session',
          enabled: true,
          url: `${listener.baseUrl}/hook`,
          method: 'POST',
          timeoutMs: 1200,
          headers: {},
          eventTypes: []
        }
      ]
    })
  );
  const scope = makeScope();
  runtime.publish(
    scope,
    {
      type: 'conversation-updated',
      conversation: {}
    },
    1
  );
  await runtime.close();
  await listener.close();
  assert.equal(requestCount, 1);

  const deduped = internals(runtime).dedupeSessionEvents([
    {
      eventType: 'turn.started',
      context: {
        sessionId: 'session-invalid-ts'
      },
      ts: 'invalid-ts'
    }
  ]);
  assert.equal(deduped.length, 1);
});

void test('lifecycle hooks treat whitespace timestamps as missing', () => {
  const runtime = new LifecycleHooksRuntime(makeConfig());
  const built = internals(runtime).buildLifecycleEvent(
    makeScope(),
    {
      type: 'session-output',
      sessionId: 'session-ts-space',
      outputCursor: 1,
      chunkBase64: '',
      ts: '   ',
      directoryId: 'directory-test',
      conversationId: 'conversation-test'
    },
    1,
    'control-plane',
    'turn.started',
    {
      sessionId: 'session-ts-space',
      summary: 'x',
      attributes: {}
    }
  );
  assert.equal(typeof built.ts, 'string');
});
