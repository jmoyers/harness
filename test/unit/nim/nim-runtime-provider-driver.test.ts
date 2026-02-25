import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  InMemoryNimRuntime,
  type NimEventEnvelope,
  type NimProviderDriver,
} from '../../../packages/nim-core/src/index.ts';

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs = 2000,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timed out waiting for stream event'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function collectUntil(
  iterator: AsyncIterator<NimEventEnvelope>,
  predicate: (events: readonly NimEventEnvelope[]) => boolean,
  maxEvents = 200,
): Promise<NimEventEnvelope[]> {
  const events: NimEventEnvelope[] = [];
  while (events.length < maxEvents) {
    const next = await nextWithTimeout(iterator);
    if (next.done) {
      break;
    }
    events.push(next.value);
    if (predicate(events)) {
      return events;
    }
  }
  throw new Error(`stream predicate not met after ${String(events.length)} events`);
}

test('nim runtime consumes provider-driver stream and projects canonical events', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  const driver: NimProviderDriver = {
    providerId: 'anthropic',
    async *runTurn(input) {
      yield { type: 'provider.thinking.started' };
      yield {
        type: 'provider.thinking.delta',
        text: 'thinking...',
      };
      yield { type: 'provider.thinking.completed' };
      yield {
        type: 'tool.call.started',
        toolCallId: 'tool-1',
        toolName: 'ping',
      };
      yield {
        type: 'tool.call.arguments.delta',
        toolCallId: 'tool-1',
        delta: '{"value":"nim"}',
      };
      yield {
        type: 'tool.call.completed',
        toolCallId: 'tool-1',
        toolName: 'ping',
      };
      yield {
        type: 'tool.result.emitted',
        toolCallId: 'tool-1',
        toolName: 'ping',
        output: {
          ok: true,
        },
      };
      yield {
        type: 'assistant.output.delta',
        text: `driver:${input.input}`,
      };
      yield { type: 'assistant.output.completed' };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  };

  runtime.registerProviderDriver(driver);

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const stream = runtime.streamEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    includeThoughtDeltas: true,
    includeToolArgumentDeltas: true,
  });
  const iterator = stream[Symbol.asyncIterator]();

  try {
    const turn = await runtime.sendTurn({
      sessionId: session.sessionId,
      input: 'hello',
      idempotencyKey: 'idem-driver',
    });

    const result = await turn.done;
    assert.equal(result.terminalState, 'completed');

    const events = await collectUntil(iterator, (items) =>
      items.some((event) => event.type === 'turn.completed' && event.run_id === turn.runId),
    );

    assert.equal(
      events.some((event) => event.type === 'provider.thinking.delta'),
      true,
    );
    assert.equal(
      events.some((event) => event.type === 'tool.call.arguments.delta'),
      true,
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === 'assistant.output.delta' &&
          String(event.data?.['text'] ?? '') === 'driver:hello',
      ),
      true,
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === 'assistant.output.message' &&
          String(event.data?.['text'] ?? '') === 'driver:hello',
      ),
      true,
    );
  } finally {
    await iterator.return?.();
  }
});

test('nim runtime passes session-scoped conversation context to provider turns', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  const observedMessages: string[][] = [];
  runtime.registerProviderDriver({
    providerId: 'anthropic',
    async *runTurn(input) {
      observedMessages.push(input.messages.map((message) => `${message.role}:${message.text}`));
      yield {
        type: 'assistant.output.delta',
        text: `driver:${input.input}`,
      };
      yield { type: 'assistant.output.completed' };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const first = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'first',
    idempotencyKey: 'idem-context-1',
  });
  const firstResult = await first.done;
  assert.equal(firstResult.terminalState, 'completed');

  const second = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'second',
    idempotencyKey: 'idem-context-2',
  });
  const secondResult = await second.done;
  assert.equal(secondResult.terminalState, 'completed');

  assert.equal(observedMessages.length, 2);
  assert.deepEqual(observedMessages[0], ['user:first']);
  assert.deepEqual(observedMessages[1], ['user:first', 'assistant:driver:first', 'user:second']);
});

test('nim runtime marks run failed when provider driver reports error', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  runtime.registerProviderDriver({
    providerId: 'anthropic',
    async *runTurn() {
      yield {
        type: 'provider.turn.error',
        message: 'provider failure',
      };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'error',
      };
    },
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'hello',
    idempotencyKey: 'idem-provider-error',
  });

  const result = await turn.done;
  assert.equal(result.terminalState, 'failed');
});

test('nim runtime fails closed when provider driver omits provider.turn.finished', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  runtime.registerProviderDriver({
    providerId: 'anthropic',
    async *runTurn() {
      yield {
        type: 'assistant.output.delta',
        text: 'hello',
      };
    },
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'hello',
    idempotencyKey: 'idem-provider-missing-finish',
  });

  const result = await turn.done;
  assert.equal(result.terminalState, 'failed');

  const replay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: turn.runId,
  });
  assert.equal(
    replay.events.some(
      (event) =>
        event.type === 'turn.failed' &&
        String(event.data?.['message'] ?? '').includes('missing provider.turn.finished'),
    ),
    true,
  );
});

test('nim runtime fails when provider completes without streamed assistant output', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  runtime.registerProviderDriver({
    providerId: 'anthropic',
    async *runTurn() {
      yield {
        type: 'provider.turn.finished',
        finishReason: 'stop',
      };
    },
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'hello',
    idempotencyKey: 'idem-provider-no-output',
  });

  const result = await turn.done;
  assert.equal(result.terminalState, 'failed');

  const replay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: turn.runId,
  });
  assert.equal(
    replay.events.some(
      (event) =>
        event.type === 'turn.failed' &&
        String(event.data?.['message'] ?? '').includes('missing assistant output delta'),
    ),
    true,
  );
});

test('nim runtime fails closed when provider finishes with unresolved tool calls', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  runtime.registerProviderDriver({
    providerId: 'anthropic',
    async *runTurn() {
      yield { type: 'provider.thinking.started' };
      yield { type: 'provider.thinking.completed' };
      yield {
        type: 'tool.call.started',
        toolCallId: 'tool-open',
        toolName: 'thread.create',
      };
      yield {
        type: 'tool.call.arguments.delta',
        toolCallId: 'tool-open',
        delta: '{"projectId":"dir-1"',
      };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'tool-calls',
      };
    },
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'start threads',
    idempotencyKey: 'idem-provider-dangling-tool',
  });
  const result = await turn.done;
  assert.equal(result.terminalState, 'failed');
  assert.equal(result.terminalReason, 'dangling-tool-call');
  assert.equal(result.providerFinishReason, 'tool-calls');
  assert.deepEqual(result.toolCalls, {
    started: 1,
    completed: 0,
    failed: 0,
    pending: 1,
    pendingIds: ['tool-open'],
  });

  const replay = await runtime.replayEvents({
    tenantId: 'tenant-a',
    sessionId: session.sessionId,
    runId: turn.runId,
  });

  const failed = replay.events.find((event) => event.type === 'turn.failed');
  assert.equal(
    String(failed?.data?.['message'] ?? '').includes('unresolved tool calls'),
    true,
  );
  assert.deepEqual(failed?.data?.['pendingToolCallIds'], ['tool-open']);

  const completed = replay.events.find((event) => event.type === 'turn.completed');
  assert.equal(completed?.data?.['terminalState'], 'failed');
  assert.equal(completed?.data?.['terminalReason'], 'dangling-tool-call');
  assert.equal(completed?.data?.['providerFinishReason'], 'tool-calls');
  assert.equal(completed?.data?.['openToolCallsStarted'], 1);
  assert.equal(completed?.data?.['openToolCallsPending'], 1);
});

test('nim runtime classifies max tool roundtrip failures with explicit terminal reason', async () => {
  const runtime = new InMemoryNimRuntime();
  runtime.registerProvider({
    id: 'anthropic',
    displayName: 'Anthropic',
    models: ['anthropic/claude-3-haiku-20240307'],
  });

  runtime.registerProviderDriver({
    providerId: 'anthropic',
    async *runTurn() {
      yield {
        type: 'provider.turn.error',
        message: 'maxToolRoundtrips (10) exceeded',
      };
      yield {
        type: 'provider.turn.finished',
        finishReason: 'error',
      };
    },
  });

  const session = await runtime.startSession({
    tenantId: 'tenant-a',
    userId: 'user-a',
    model: 'anthropic/claude-3-haiku-20240307',
  });

  const turn = await runtime.sendTurn({
    sessionId: session.sessionId,
    input: 'retry tool',
    idempotencyKey: 'idem-provider-max-roundtrips',
  });

  const result = await turn.done;
  assert.equal(result.terminalState, 'failed');
  assert.equal(result.terminalReason, 'max-tool-roundtrips');
});
