import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { collectFullStream, streamText } from '../packages/harness-ai/src/stream-text.ts';
import type {
  HarnessAnthropicModel,
  StreamTextPart,
  ToolSet,
} from '../packages/harness-ai/src/types.ts';
import { collectStream, createAnthropicResponse, createByteStream } from './support/harness-ai.ts';

function createQueuedModel(responses: Array<Response | (() => Response | Promise<Response>)>): {
  readonly model: HarnessAnthropicModel;
  readonly requestBodies: Array<Record<string, unknown>>;
} {
  const queue = [...responses];
  const requestBodies: Array<Record<string, unknown>> = [];

  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-sonnet',
    apiKey: 'test-key',
    baseUrl: 'https://mock.anthropic.local/v1',
    headers: {},
    fetch: async (_input, init) => {
      const bodyText = String(init?.body ?? '{}');
      requestBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('no queued response');
      }
      return typeof next === 'function' ? await next() : next;
    },
  };

  return { model, requestBodies };
}

async function collectFullParts<TOOLS extends ToolSet>(
  result: ReturnType<typeof streamText<TOOLS>>,
): Promise<StreamTextPart<TOOLS>[]> {
  return collectStream(result.fullStream);
}

void test('streams simple text response', async () => {
  const { model, requestBodies } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'msg-1',
          model: 'claude-sonnet',
          usage: { input_tokens: 4, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 4, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const result = streamText({
    model,
    prompt: 'hi',
  });

  const [parts, text, finishReason, usage, response] = await Promise.all([
    collectFullParts(result),
    result.text,
    result.finishReason,
    result.usage,
    result.response,
  ]);

  assert.equal(
    parts.some((part) => part.type === 'text-delta'),
    true,
  );
  assert.equal(text, 'Hello world');
  assert.equal(finishReason, 'stop');
  assert.deepEqual(usage, {
    inputTokens: 4,
    outputTokens: 2,
    totalTokens: 6,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  });
  assert.equal(response.id, 'msg-1');
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0]?.['model'], 'claude-sonnet');
});

void test('executes local tools across roundtrips and continues after tool-calls finish reason', async () => {
  const { model, requestBodies } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'step-1',
          model: 'claude-sonnet',
          usage: { input_tokens: 2, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-1',
          name: 'weather',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"city":"SF"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 2, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'step-2',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '72F and sunny' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const tools = {
    weather: {
      description: 'Weather lookup',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
        },
      },
      execute: async (input: unknown) => {
        const record = input as { city: string };
        return { forecast: `${record.city}: 72F` };
      },
    },
  } as const;

  const result = streamText({
    model,
    prompt: 'weather?',
    tools,
  });

  const parts = await collectFullParts(result);
  const text = await result.text;

  assert.equal(text, '72F and sunny');
  assert.equal(parts.filter((part) => part.type === 'start-step').length, 2);
  assert.equal(
    parts.some((part) => part.type === 'tool-result'),
    true,
  );
  assert.equal(requestBodies.length, 2);

  const secondBody = requestBodies[1];
  assert.equal(Array.isArray(secondBody?.['messages']), true);
});

void test('handles provider-executed web search/web fetch results and sources', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'provider-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'server_tool_use',
          id: 'server-call-1',
          name: 'web_search',
          input: { query: 'latest' },
        },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'server-call-1',
          content: [
            {
              type: 'web_search_result',
              url: 'https://example.com/a',
              title: 'A',
              page_age: '1d',
            },
          ],
        },
      },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'web_fetch_tool_result',
          tool_use_id: 'server-call-2',
          content: {
            type: 'web_fetch_result',
            url: 'https://example.com/doc',
            content: {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'text/plain',
                data: 'aGVsbG8=',
              },
            },
          },
        },
      },
      {
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'server-call-3',
          content: {
            type: 'web_search_tool_result_error',
            error_code: 'max_uses_exceeded',
          },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 5, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const tools = {
    web_search: {
      type: 'provider',
      provider: 'anthropic',
      anthropicType: 'web_search_20250305',
      name: 'web_search',
    },
    web_fetch: {
      type: 'provider',
      provider: 'anthropic',
      anthropicType: 'web_fetch_20250910',
      name: 'web_fetch',
    },
  } as const;

  const result = streamText({ model, prompt: 'search', tools });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'source'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'tool-result'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'tool-error'),
    true,
  );
});

void test('handles malformed SSE lines and records error part', async () => {
  const malformed = new Response(
    createByteStream([
      'data: {"type":"message_start","message":{"id":"m1","model":"claude-sonnet","usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'data: {not-json}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );

  const { model } = createQueuedModel([malformed]);
  const result = streamText({ model, prompt: 'x', includeRawChunks: true });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'raw'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'error'),
    true,
  );
});

void test('emits abort and finish when signal is already aborted', async () => {
  const { model } = createQueuedModel([]);
  const abort = new AbortController();
  abort.abort();

  const result = streamText({ model, prompt: 'x', abortSignal: abort.signal });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'abort'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'finish'),
    true,
  );
});

void test('emits maxToolRoundtrips guard error', async () => {
  const { model } = createQueuedModel([]);
  const result = streamText({ model, prompt: 'x', maxToolRoundtrips: 0 });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'error'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'finish' && part.finishReason === 'error'),
    true,
  );
});

void test('handles execute missing and execute failure branches', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'tool-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
          content: [
            {
              type: 'tool_use',
              id: 'missing-1',
              name: 'missingTool',
              input: { a: 1 },
            },
            {
              type: 'tool_use',
              id: 'throws-1',
              name: 'throwsTool',
              input: { b: 2 },
            },
          ],
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'done-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const tools = {
    throwsTool: {
      description: 'throws',
      execute: async () => {
        throw new Error('boom');
      },
    },
  } as const;

  const result = streamText({ model, prompt: 'x', tools });
  const parts = await collectFullParts(result);

  const errors = parts.filter((part) => part.type === 'tool-error');
  assert.equal(errors.length >= 2, true);
});

void test('toUIMessageStream and toUIMessageStreamResponse work for stream results', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'ui-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'UI' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const result = streamText({ model, prompt: 'x' });
  const uiChunks = await collectStream(result.toUIMessageStream());
  assert.equal(
    uiChunks.some((chunk) => chunk.type === 'text-delta'),
    true,
  );

  const response = result.toUIMessageStreamResponse();
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
});

void test('validates prompt/message normalization and request options branches', async () => {
  const { model, requestBodies } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'norm-1',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  assert.throws(
    () =>
      streamText({
        model,
        prompt: 'x',
        messages: [{ role: 'user', content: 'y' }],
      }),
    /either prompt or messages/u,
  );
  assert.throws(() => streamText({ model, messages: [] }), /messages or prompt is required/u);

  const result = streamText({
    model,
    messages: [
      { role: 'system', content: 'from-message-system' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'prior assistant text' },
          { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'lookup', input: { q: 'x' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'tool-call-1', toolName: 'lookup', output: 'ok' },
        ],
      },
    ],
    topP: 0.75,
    stopSequences: ['STOP'],
  });
  await result.consumeStream();

  const request = requestBodies[0]!;
  assert.equal(request['system'], 'from-message-system');
  assert.equal(request['top_p'], 0.75);
  assert.deepEqual(request['stop_sequences'], ['STOP']);
});

void test('covers reasoning/tool/provider result branches and roundtrip assistant replay construction', async () => {
  const { model, requestBodies } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'rich-step-1',
          model: 'claude-sonnet',
          usage: { input_tokens: 3, output_tokens: 0 },
          content: [
            { type: 'text', text: 'non-tool-content' },
            {
              type: 'server_tool_use',
              id: 'provider-search-call',
              name: 'web_search',
              input: { q: 'news' },
            },
            {
              type: 'server_tool_use',
              id: 'provider-fetch-call',
              name: 'web_fetch',
              input: { url: 'https://example.com' },
            },
          ],
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Intro ' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'redacted_thinking',
          thinking: 'secret',
          data: 'encoded-redaction',
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'thinking_delta', thinking: ' + more' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'signature_delta', signature: 'sig-1' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: 'ignored-for-reasoning' },
      },
      {
        type: 'content_block_stop',
        index: 1,
      },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'local-invalid-call',
          name: 'localTool',
        },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{' },
      },
      {
        type: 'content_block_stop',
        index: 2,
      },
      {
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'tool_use',
          id: 'local-noexec-call',
          name: 'noexecTool',
          input: { city: 'SF' },
        },
      },
      {
        type: 'content_block_stop',
        index: 3,
      },
      {
        type: 'content_block_start',
        index: 4,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'provider-search-call',
          content: {
            type: 'web_search_error',
            error_code: 'blocked',
          },
        },
      },
      {
        type: 'content_block_start',
        index: 5,
        content_block: {
          type: 'web_fetch_tool_result',
          tool_use_id: 'provider-fetch-call',
          content: {
            type: 'web_fetch_error',
            error_code: 'denied',
          },
        },
      },
      {
        type: 'content_block_start',
        index: 6,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'provider-search-call',
          content: [
            {
              type: 'web_search_result',
              url: 'https://example.com/article',
              title: 'Article',
              page_age: '2d',
            },
          ],
        },
      },
      {
        type: 'content_block_start',
        index: 7,
        content_block: {
          type: 'web_fetch_tool_result',
          tool_use_id: 'provider-fetch-call',
          content: {
            type: 'web_fetch_result',
            url: 'https://example.com/doc',
            retrieved_at: '2026-01-01T00:00:00.000Z',
            content: {
              type: 'document',
              title: 'Fetched Doc',
              citations: [{ id: 1 }],
              source: {
                type: 'base64',
                media_type: 'text/plain',
                data: 'aGVsbG8=',
              },
            },
          },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 3, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'rich-step-2',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'done' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const abort = new AbortController();
  const tools = {
    localTool: {
      description: 'Local tool',
      dynamic: true,
      title: 'Local Tool',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      execute: async (input: unknown) => ({ echoed: input }),
    },
    noexecTool: {
      description: 'Missing execute',
      dynamic: false,
      title: 'No Exec Tool',
    },
    web_search: {
      type: 'provider',
      provider: 'anthropic',
      anthropicType: 'web_search_20250305',
      name: 'web_search',
      dynamic: true,
      title: 'Search',
    },
    web_fetch: {
      type: 'provider',
      provider: 'anthropic',
      anthropicType: 'web_fetch_20250910',
      name: 'web_fetch',
      dynamic: false,
      title: 'Fetch',
    },
  } as const;

  const result = streamText({
    model,
    prompt: 'rich',
    tools,
    abortSignal: abort.signal,
    topP: 0.65,
    stopSequences: ['DONE'],
  });

  const [parts, textChunks] = await Promise.all([
    collectFullParts(result),
    collectStream(result.textStream),
  ]);
  const text = await result.text;
  const finishReason = await result.finishReason;
  const response = result.toUIMessageStreamResponse({
    headers: {
      'content-type': 'application/custom',
    },
  });

  assert.equal(text, 'Intro done');
  assert.equal(textChunks.join(''), 'Intro done');
  assert.equal(finishReason, 'stop');
  assert.equal(response.headers.get('content-type'), 'application/custom');
  assert.equal(
    parts.some((part) => part.type === 'reasoning-start'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'reasoning-end'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'source'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'tool-error'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'tool-result'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'finish-step'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'finish' && part.finishReason === 'stop'),
    true,
  );

  const secondRequest = requestBodies[1] as {
    messages?: unknown[];
    top_p?: unknown;
    stop_sequences?: unknown;
  };
  assert.equal(Array.isArray(secondRequest.messages), true);
  assert.equal(secondRequest.top_p, 0.65);
  assert.deepEqual(secondRequest.stop_sequences, ['DONE']);
  const secondMessages = secondRequest.messages as Array<{ role?: unknown; content?: unknown }>;
  const assistantMessage = secondMessages.find((entry) => entry.role === 'assistant');
  const assistantContent = Array.isArray(assistantMessage?.content)
    ? (assistantMessage.content as Array<Record<string, unknown>>)
    : [];
  assert.equal(Array.isArray(assistantContent), true);
  assert.equal(
    assistantContent.some((part) => part['type'] === 'text' && part['text'] === 'Intro '),
    true,
  );
});

void test('collectFullStream helper collects emitted parts', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'collect-helper',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);
  const parts = await collectFullStream({ model, prompt: 'collect' });
  assert.equal(
    parts.some((part) => part.type === 'start'),
    true,
  );
});
