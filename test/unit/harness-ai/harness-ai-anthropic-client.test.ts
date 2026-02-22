import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { postAnthropicMessagesStream } from '../../../packages/harness-ai/src/anthropic-client.ts';
import type { HarnessAnthropicModel } from '../../../packages/harness-ai/src/types.ts';
import {
  createAnthropicResponse,
  createByteStream,
  createErrorResponse,
  collectStream,
} from '../../support/harness-ai.ts';

void test('posts request and parses anthropic stream events', async () => {
  const fetchCalls: Array<{ input: unknown; init?: RequestInit }> = [];

  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-model',
    apiKey: 'key-1',
    baseUrl: 'https://example.com/v1',
    headers: {
      'x-extra': '1',
    },
    fetch: async (input, init) => {
      const call: { input: unknown; init?: RequestInit } = { input };
      if (init !== undefined) {
        call.init = init;
      }
      fetchCalls.push(call);
      return createAnthropicResponse([
        { type: 'ping' },
        {
          type: 'message_start',
          message: {
            id: 'm1',
            model: 'claude-model',
            usage: { input_tokens: 1, output_tokens: 2 },
          },
        },
      ]);
    },
  };

  const response = await postAnthropicMessagesStream(
    model,
    {
      model: 'claude-model',
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
    undefined,
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(String(fetchCalls[0]?.input), 'https://example.com/v1/messages');
  assert.equal(fetchCalls[0]?.init?.method, 'POST');

  const events = await collectStream(response.stream);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.chunk?.type, 'ping');
  assert.equal(events[1]?.chunk?.type, 'message_start');
});

void test('captures malformed json parse errors without throwing', async () => {
  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-model',
    apiKey: 'key-1',
    baseUrl: 'https://example.com/v1',
    headers: {},
    fetch: async () =>
      new Response(createByteStream(['data: {"type":"ping"}\n\n', 'data: {not-json}\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  };

  const response = await postAnthropicMessagesStream(
    model,
    {
      model: 'claude-model',
      stream: true,
      messages: [],
    },
    undefined,
  );

  const events = await collectStream(response.stream);
  assert.equal(events[0]?.chunk?.type, 'ping');
  assert.equal(events[1]?.chunk, null);
  assert.equal(typeof events[1]?.parseError, 'string');
});

void test('throws on http errors', async () => {
  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-model',
    apiKey: 'key-1',
    baseUrl: 'https://example.com/v1',
    headers: {},
    fetch: async () => createErrorResponse(401, '{"error":"bad"}'),
  };

  await assert.rejects(
    postAnthropicMessagesStream(
      model,
      {
        model: 'claude-model',
        stream: true,
        messages: [],
      },
      undefined,
    ),
    /anthropic request failed \(401\)/,
  );
});

void test('throws when response body is null', async () => {
  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-model',
    apiKey: 'key-1',
    baseUrl: 'https://example.com/v1',
    headers: {},
    fetch: async () =>
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'text/plain',
        },
      }),
  };

  await assert.rejects(
    postAnthropicMessagesStream(
      model,
      {
        model: 'claude-model',
        stream: true,
        messages: [],
      },
      undefined,
    ),
    /anthropic response body was empty/,
  );
});

void test('filters [DONE] sentinel events from anthropic streams', async () => {
  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-model',
    apiKey: 'key-1',
    baseUrl: 'https://example.com/v1',
    headers: {},
    fetch: async () =>
      new Response(
        createByteStream([
          'data: {"type":"ping"}\n\n',
          'data: [DONE]\n\n',
          'data: {"type":"message_stop"}\n\n',
        ]),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
  };

  const response = await postAnthropicMessagesStream(
    model,
    {
      model: 'claude-model',
      stream: true,
      messages: [],
    },
    undefined,
  );

  const events = await collectStream(response.stream);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.chunk?.type, 'ping');
  assert.equal(events[1]?.chunk?.type, 'message_stop');
});

void test('handles unreadable http error body responses', async () => {
  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-model',
    apiKey: 'key-1',
    baseUrl: 'https://example.com/v1',
    headers: {},
    fetch: async () =>
      ({
        ok: false,
        status: 503,
        text: async () => {
          throw new Error('unreadable');
        },
      }) as unknown as Response,
  };

  await assert.rejects(
    postAnthropicMessagesStream(
      model,
      {
        model: 'claude-model',
        stream: true,
        messages: [],
      },
      undefined,
    ),
    /anthropic request failed \(503\):/u,
  );
});
