import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAnthropicNimProviderDriver } from '../packages/nim-core/src/providers/anthropic-driver.ts';
import type {
  AnthropicModelFactory,
  AsyncIterableStream,
  HarnessAnthropicModel,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  StreamTextPart,
  StreamTextResult,
  ToolSet,
} from '../packages/harness-ai/src/index.ts';

function asAsyncIterableStream<T>(values: readonly T[]): AsyncIterableStream<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    },
  } as AsyncIterableStream<T>;
}

function mockStreamResult(
  parts: readonly StreamTextPart<ToolSet>[],
  finishReason: 'stop' | 'error',
): StreamTextResult<ToolSet> {
  const usage: LanguageModelUsage = {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
  };
  const response: LanguageModelResponseMetadata = {
    id: 'resp-1',
  };

  return {
    fullStream: asAsyncIterableStream(parts),
    textStream: asAsyncIterableStream([]),
    text: Promise.resolve(''),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
    finishReason: Promise.resolve(finishReason),
    usage: Promise.resolve(usage),
    response: Promise.resolve(response),
    toUIMessageStream: () => asAsyncIterableStream([]),
    toUIMessageStreamResponse: () => new Response(null),
    consumeStream: async () => undefined,
  };
}

function anthropicFactory(): AnthropicModelFactory {
  const factory = ((modelId: string): HarnessAnthropicModel => {
    return {
      provider: 'harness.anthropic',
      modelId,
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      headers: {},
      fetch,
    };
  }) as AnthropicModelFactory;

  Object.defineProperty(factory, 'tools', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: {},
  });

  return factory;
}

test('anthropic nim provider driver maps stream parts to canonical provider events', async () => {
  const parts: StreamTextPart<ToolSet>[] = [
    { type: 'reasoning-start', id: 'r-1' },
    { type: 'reasoning-delta', id: 'r-1', text: 'think' },
    { type: 'reasoning-end', id: 'r-1' },
    {
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'ping',
      input: { value: 'nim' },
    },
    {
      type: 'tool-result',
      toolCallId: 'tool-1',
      toolName: 'ping',
      output: { ok: true },
    },
    { type: 'text-delta', id: 'txt-1', text: 'NIM' },
    { type: 'text-end', id: 'txt-1' },
    {
      type: 'finish',
      finishReason: 'stop',
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    },
  ];

  const driver = createAnthropicNimProviderDriver({
    apiKey: 'test-key',
    createAnthropicFn: () => anthropicFactory(),
    streamTextFn: () => mockStreamResult(parts, 'stop'),
  });

  const events = [] as string[];
  for await (const event of driver.runTurn({
    modelRef: 'anthropic/claude-3-haiku-20240307',
    providerModelId: 'claude-3-haiku-20240307',
    input: 'hello',
    tools: [
      {
        name: 'ping',
        description: 'ping',
      },
    ],
  })) {
    events.push(event.type);
  }

  assert.deepEqual(events, [
    'provider.thinking.started',
    'provider.thinking.delta',
    'provider.thinking.completed',
    'tool.call.started',
    'tool.call.completed',
    'tool.result.emitted',
    'assistant.output.delta',
    'assistant.output.completed',
    'provider.turn.finished',
  ]);
});

test('anthropic nim provider driver emits provider.turn.error and error finish reason', async () => {
  const parts: StreamTextPart<ToolSet>[] = [
    {
      type: 'error',
      error: new Error('bad model'),
    },
    {
      type: 'finish',
      finishReason: 'error',
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    },
  ];

  const driver = createAnthropicNimProviderDriver({
    apiKey: 'test-key',
    createAnthropicFn: () => anthropicFactory(),
    streamTextFn: () => mockStreamResult(parts, 'error'),
  });

  const events = [] as string[];
  for await (const event of driver.runTurn({
    modelRef: 'anthropic/claude-3-haiku-20240307',
    providerModelId: 'claude-3-haiku-20240307',
    input: 'hello',
    tools: [],
  })) {
    events.push(event.type);
  }

  assert.deepEqual(events, ['provider.turn.error', 'provider.turn.finished']);
});

test('anthropic nim provider driver synthesizes thinking lifecycle when provider omits reasoning deltas', async () => {
  const parts: StreamTextPart<ToolSet>[] = [
    { type: 'text-delta', id: 'txt-1', text: 'hello' },
    {
      type: 'finish',
      finishReason: 'stop',
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    },
  ];

  const driver = createAnthropicNimProviderDriver({
    apiKey: 'test-key',
    createAnthropicFn: () => anthropicFactory(),
    streamTextFn: () => mockStreamResult(parts, 'stop'),
  });

  const events = [] as string[];
  for await (const event of driver.runTurn({
    modelRef: 'anthropic/claude-3-haiku-20240307',
    providerModelId: 'claude-3-haiku-20240307',
    input: 'hello',
    tools: [],
  })) {
    events.push(event.type);
  }

  assert.deepEqual(events, [
    'provider.thinking.started',
    'provider.thinking.completed',
    'assistant.output.delta',
    'provider.turn.finished',
  ]);
});
