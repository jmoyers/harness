import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  InMemoryNimRuntime,
  type NimEventEnvelope,
  type NimProviderDriver,
} from '../packages/nim-core/src/index.ts';

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
  } finally {
    await iterator.return?.();
  }
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
