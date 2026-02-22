import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  JsonToSseTransformStream,
  UI_MESSAGE_STREAM_HEADERS,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from '../../../packages/harness-ai/src/ui-stream.ts';
import type { StreamTextPart } from '../../../packages/harness-ai/src/types.ts';
import { collectStream, collectTextStream } from '../../support/harness-ai.ts';

void test('maps stream parts into UI chunks', async () => {
  const input = new ReadableStream<StreamTextPart<{}>>({
    start(controller) {
      controller.enqueue({ type: 'start' });
      controller.enqueue({ type: 'start-step', request: { body: {} }, warnings: [] });
      controller.enqueue({ type: 'text-start', id: '1' });
      controller.enqueue({ type: 'text-delta', id: '1', text: 'hello' });
      controller.enqueue({ type: 'text-end', id: '1' });
      controller.enqueue({ type: 'tool-input-start', id: 'call-1', toolName: 'weather' });
      controller.enqueue({ type: 'tool-input-delta', id: 'call-1', delta: '{"city":"SF"}' });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'weather',
        input: { city: 'SF' },
      });
      controller.enqueue({
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'weather',
        output: { temp: '72F' },
      });
      controller.enqueue({
        type: 'finish-step',
        response: {},
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      });
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      controller.close();
    },
  });

  const output = await collectStream(createUIMessageStream(input));
  assert.deepEqual(output, [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'text-start', id: '1', providerMetadata: undefined },
    { type: 'text-delta', id: '1', delta: 'hello', providerMetadata: undefined },
    { type: 'text-end', id: '1', providerMetadata: undefined },
    {
      type: 'tool-input-start',
      toolCallId: 'call-1',
      toolName: 'weather',
      providerExecuted: undefined,
      providerMetadata: undefined,
      dynamic: undefined,
      title: undefined,
    },
    { type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: '{"city":"SF"}' },
    {
      type: 'tool-input-available',
      toolCallId: 'call-1',
      toolName: 'weather',
      input: { city: 'SF' },
      providerExecuted: undefined,
      providerMetadata: undefined,
      dynamic: undefined,
      title: undefined,
    },
    {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { temp: '72F' },
      providerExecuted: undefined,
      dynamic: undefined,
      preliminary: undefined,
    },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
  ]);
});

void test('maps source, error, and invalid tool call branches', async () => {
  const input = new ReadableStream<StreamTextPart<{}>>({
    start(controller) {
      controller.enqueue({
        type: 'source',
        id: 's1',
        sourceType: 'url',
        url: 'https://example.com',
        title: 'Example',
      });
      controller.enqueue({
        type: 'source',
        id: 's2',
        sourceType: 'document',
        mediaType: 'text/plain',
        title: 'Doc',
        filename: 'doc.txt',
      });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 'call-bad',
        toolName: 'badTool',
        input: '{',
        invalid: true,
        error: 'bad json',
      });
      controller.enqueue({
        type: 'tool-error',
        toolCallId: 'call-bad',
        toolName: 'badTool',
        error: new Error('x'),
      });
      controller.enqueue({ type: 'error', error: new Error('stream failed') });
      controller.enqueue({ type: 'abort', reason: 'cancelled' });
      controller.enqueue({ type: 'tool-input-end', id: 'call-bad' });
      controller.enqueue({ type: 'raw', rawValue: { test: true } });
      controller.close();
    },
  });

  const output = await collectStream(createUIMessageStream(input, () => 'ERR'));
  assert.deepEqual(output, [
    {
      type: 'source-url',
      sourceId: 's1',
      url: 'https://example.com',
      title: 'Example',
      providerMetadata: undefined,
    },
    {
      type: 'source-document',
      sourceId: 's2',
      mediaType: 'text/plain',
      title: 'Doc',
      filename: 'doc.txt',
      providerMetadata: undefined,
    },
    {
      type: 'tool-input-error',
      toolCallId: 'call-bad',
      toolName: 'badTool',
      input: '{',
      providerExecuted: undefined,
      providerMetadata: undefined,
      dynamic: undefined,
      title: undefined,
      errorText: 'bad json',
    },
    {
      type: 'tool-output-error',
      toolCallId: 'call-bad',
      providerExecuted: undefined,
      dynamic: undefined,
      errorText: 'ERR',
    },
    {
      type: 'error',
      errorText: 'ERR',
    },
    {
      type: 'abort',
      reason: 'cancelled',
    },
  ]);
});

void test('maps reasoning and metadata branches and uses default error text fallback', async () => {
  const input = new ReadableStream<StreamTextPart<{}>>({
    start(controller) {
      controller.enqueue({
        type: 'text-start',
        id: 'txt-1',
        providerMetadata: { provider: { id: 'test' } },
      });
      controller.enqueue({
        type: 'reasoning-start',
        id: 'r-1',
        providerMetadata: { provider: { id: 'test' } },
      });
      controller.enqueue({
        type: 'reasoning-delta',
        id: 'r-1',
        text: 'thinking',
        providerMetadata: { provider: { id: 'test' } },
      });
      controller.enqueue({
        type: 'reasoning-end',
        id: 'r-1',
        providerMetadata: { provider: { id: 'test' } },
      });
      controller.enqueue({
        type: 'tool-input-start',
        id: 'call-meta',
        toolName: 'search',
        providerExecuted: true,
        providerMetadata: { provider: { id: 'test' } },
        dynamic: true,
        title: 'Search',
      });
      controller.enqueue({
        type: 'tool-call',
        toolCallId: 'call-meta',
        toolName: 'search',
        input: { q: 'hello' },
        invalid: true,
      });
      controller.enqueue({
        type: 'tool-error',
        toolCallId: 'call-meta',
        toolName: 'search',
        error: 'plain-error',
      });
      controller.enqueue({
        type: 'source',
        id: 'src-meta',
        sourceType: 'url',
        url: 'https://example.com/meta',
        title: 'Meta',
        providerMetadata: { provider: { id: 'test' } },
      });
      controller.enqueue({
        type: 'text-end',
        id: 'txt-1',
        providerMetadata: { provider: { id: 'test' } },
      });
      controller.close();
    },
  });

  const output = await collectStream(createUIMessageStream(input));
  assert.deepEqual(output, [
    {
      type: 'text-start',
      id: 'txt-1',
      providerMetadata: { provider: { id: 'test' } },
    },
    {
      type: 'reasoning-start',
      id: 'r-1',
      providerMetadata: { provider: { id: 'test' } },
    },
    {
      type: 'reasoning-delta',
      id: 'r-1',
      delta: 'thinking',
      providerMetadata: { provider: { id: 'test' } },
    },
    {
      type: 'reasoning-end',
      id: 'r-1',
      providerMetadata: { provider: { id: 'test' } },
    },
    {
      type: 'tool-input-start',
      toolCallId: 'call-meta',
      toolName: 'search',
      providerExecuted: true,
      providerMetadata: { provider: { id: 'test' } },
      dynamic: true,
      title: 'Search',
    },
    {
      type: 'tool-input-error',
      toolCallId: 'call-meta',
      toolName: 'search',
      input: { q: 'hello' },
      providerExecuted: undefined,
      providerMetadata: undefined,
      dynamic: undefined,
      title: undefined,
      errorText: 'Invalid tool call',
    },
    {
      type: 'tool-output-error',
      toolCallId: 'call-meta',
      providerExecuted: undefined,
      dynamic: undefined,
      errorText: 'plain-error',
    },
    {
      type: 'source-url',
      sourceId: 'src-meta',
      url: 'https://example.com/meta',
      title: 'Meta',
      providerMetadata: { provider: { id: 'test' } },
    },
    {
      type: 'text-end',
      id: 'txt-1',
      providerMetadata: { provider: { id: 'test' } },
    },
  ]);
});

void test('JsonToSseTransformStream and response helper emit SSE protocol', async () => {
  const sse = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'start' });
      controller.enqueue({ type: 'finish', finishReason: 'stop' });
      controller.close();
    },
  }).pipeThrough(new JsonToSseTransformStream());

  const sseText = await collectStream(sse);
  assert.deepEqual(sseText, [
    'data: {"type":"start"}\n\n',
    'data: {"type":"finish","finishReason":"stop"}\n\n',
    'data: [DONE]\n\n',
  ]);

  const response = createUIMessageStreamResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'start' });
        controller.close();
      },
    }),
  );

  for (const [key, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
    assert.equal(response.headers.get(key), value);
  }

  const bodyChunks = await collectTextStream(response.body as ReadableStream<Uint8Array>);
  assert.match(bodyChunks.join(''), /data: \{"type":"start"\}/);
  assert.match(bodyChunks.join(''), /data: \[DONE\]/);
});

void test('response helper preserves explicit headers while filling missing defaults', async () => {
  const response = createUIMessageStreamResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'finish', finishReason: 'stop' });
        controller.close();
      },
    }),
    {
      headers: {
        'content-type': 'application/custom',
      },
    },
  );

  assert.equal(response.headers.get('content-type'), 'application/custom');
  assert.equal(response.headers.get('cache-control'), UI_MESSAGE_STREAM_HEADERS['cache-control']);
  const bodyChunks = await collectTextStream(response.body as ReadableStream<Uint8Array>);
  assert.match(bodyChunks.join(''), /data: \{"type":"finish","finishReason":"stop"\}/);
});

void test('default error formatter uses Error.message values', async () => {
  const input = new ReadableStream<StreamTextPart<{}>>({
    start(controller) {
      controller.enqueue({
        type: 'tool-error',
        toolCallId: 'call-error',
        toolName: 'tool',
        error: new Error('tool failed'),
      });
      controller.close();
    },
  });

  const output = await collectStream(createUIMessageStream(input));
  assert.deepEqual(output, [
    {
      type: 'tool-output-error',
      toolCallId: 'call-error',
      providerExecuted: undefined,
      dynamic: undefined,
      errorText: 'tool failed',
    },
  ]);
});

void test('ui stream transform throws for unknown stream part tags', async () => {
  const input = new ReadableStream<StreamTextPart<{}>>({
    start(controller) {
      controller.enqueue({ type: 'unknown-part' } as unknown as StreamTextPart<{}>);
      controller.close();
    },
  });

  await assert.rejects(collectStream(createUIMessageStream(input)), /unhandled stream part/u);
});
