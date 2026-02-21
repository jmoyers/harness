import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { generateText } from '../packages/harness-ai/src/stream-text.ts';
import { streamObject } from '../packages/harness-ai/src/stream-object.ts';
import type { HarnessAnthropicModel } from '../packages/harness-ai/src/types.ts';
import { collectStream, createAnthropicResponse } from './support/harness-ai.ts';

function createSingleResponseModel(response: Response): HarnessAnthropicModel {
  return {
    provider: 'harness.anthropic',
    modelId: 'claude-sonnet',
    apiKey: 'test-key',
    baseUrl: 'https://mock.anthropic.local/v1',
    headers: {},
    fetch: async () => response,
  };
}

void test('generateText aggregates text, usage, and finish reason', async () => {
  const model = createSingleResponseModel(
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'msg',
          model: 'claude-sonnet',
          usage: { input_tokens: 2, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 2, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  );

  const output = await generateText({ model, prompt: 'hi' });
  assert.equal(output.text, 'hello');
  assert.equal(output.finishReason, 'stop');
  assert.equal(output.usage.totalTokens, 3);
  assert.equal(output.response.id, 'msg');
  assert.deepEqual(output.toolCalls, []);
  assert.deepEqual(output.toolResults, []);
});

void test('streamObject emits partial object snapshots and final object', async () => {
  const model = createSingleResponseModel(
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'json-msg',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '{"name":"Jane","count":2}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  );

  const result = streamObject<{ name: string; count: number }, {}>({
    model,
    prompt: 'Give object',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
      },
    },
    validate: (value: unknown): value is { name: string; count: number } => {
      if (typeof value !== 'object' || value === null) {
        return false;
      }
      const record = value as { name?: unknown; count?: unknown };
      return typeof record.name === 'string' && typeof record.count === 'number';
    },
  });

  const partials = await collectStream(result.partialObjectStream);
  const object = await result.object;
  const text = await result.text;
  const finishReason = await result.finishReason;

  assert.deepEqual(partials, [{ name: 'Jane', count: 2 }]);
  assert.deepEqual(object, { name: 'Jane', count: 2 });
  assert.match(text, /\{"name":"Jane","count":2\}/);
  assert.equal(finishReason, 'stop');
});

void test('streamObject throws when no JSON object is returned', async () => {
  const model = createSingleResponseModel(
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'json-fail',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'not json' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  );

  const result = streamObject<{ ok: true }, {}>({
    model,
    prompt: 'bad json',
    schema: { type: 'object' },
  });

  await assert.rejects(result.object, /no JSON object found/);
});

void test('streamObject validate callback failure rejects final object', async () => {
  const model = createSingleResponseModel(
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'json-validate',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"count":1}' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  );

  const result = streamObject<{ count: 2 }, {}>({
    model,
    prompt: 'json',
    schema: { type: 'object' },
    validate: (value: unknown): value is { count: 2 } => {
      if (typeof value !== 'object' || value === null) {
        return false;
      }
      return (value as { count?: unknown }).count === 2;
    },
  });

  await assert.rejects(result.object, /did not pass validator/);
});

void test('streamObject supports messages/system mode and deduplicates repeated partial JSON snapshots', async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-sonnet',
    apiKey: 'test-key',
    baseUrl: 'https://mock.anthropic.local/v1',
    headers: {},
    fetch: async (_url, init) => {
      const bodyText =
        typeof init?.body === 'string'
          ? init.body
          : Buffer.from(init?.body as ArrayBuffer).toString('utf8');
      capturedBody = JSON.parse(bodyText) as Record<string, unknown>;
      return createAnthropicResponse([
        {
          type: 'message_start',
          message: {
            id: 'json-msg-messages',
            model: 'claude-sonnet',
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '{"count":1}' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '{"count":1}' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 1, output_tokens: 2 },
        },
        { type: 'message_stop' },
      ]);
    },
  };

  const result = streamObject<{ count: number }, {}>({
    model,
    messages: [{ role: 'user', content: 'provide json' }],
    system: 'System policy',
    schema: { type: 'object' },
  });

  const partials = await collectStream(result.partialObjectStream);
  const object = await result.object;
  assert.deepEqual(partials, [{ count: 1 }]);
  assert.deepEqual(object, { count: 1 });
  assert.equal(Array.isArray(capturedBody?.['messages']), true);
  const systemText = capturedBody?.['system'];
  assert.equal(
    typeof systemText === 'string' && String(systemText).includes('Respond with strict JSON only.'),
    true,
  );
});

void test('streamObject partial stream skips non-object json snapshots', async () => {
  const model = createSingleResponseModel(
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'json-null',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'null' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  );

  const result = streamObject<{ ok: true }, {}>({
    model,
    prompt: 'return null',
    schema: { type: 'object' },
  });

  const partials = await collectStream(result.partialObjectStream);
  assert.deepEqual(partials, []);
  await assert.rejects(result.object, /no JSON object found/u);
});
