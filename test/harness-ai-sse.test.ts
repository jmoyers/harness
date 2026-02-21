import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createSseEventStream, parseSseEventBlock } from '../packages/harness-ai/src/sse.ts';
import { createByteStream, collectStream } from './support/harness-ai.ts';

void test('parseSseEventBlock parses data and event name', () => {
  const parsed = parseSseEventBlock('event: message\ndata: {"ok":true}');
  assert.deepEqual(parsed, {
    event: 'message',
    data: '{"ok":true}',
  });
});

void test('parseSseEventBlock ignores comments and empty blocks', () => {
  assert.equal(parseSseEventBlock(':keepalive\n'), null);
  assert.equal(parseSseEventBlock(''), null);
});

void test('createSseEventStream parses chunked blocks', async () => {
  const stream = createByteStream([
    'event: ping\n',
    'data: {"type":"ping"}\n\n',
    'data: {"type":"done"}\n\n',
  ]);
  const events = await collectStream(createSseEventStream(stream));
  assert.deepEqual(events, [
    {
      event: 'ping',
      data: '{"type":"ping"}',
    },
    {
      event: 'message',
      data: '{"type":"done"}',
    },
  ]);
});

void test('createSseEventStream emits trailing event without final boundary', async () => {
  const stream = createByteStream(['data: {"type":"tail"}\n']);
  const events = await collectStream(createSseEventStream(stream));
  assert.deepEqual(events, [
    {
      event: 'message',
      data: '{"type":"tail"}',
    },
  ]);
});

void test('createSseEventStream forwards reader errors', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"head"}\n\n'));
      controller.error(new Error('sse-stream-failure'));
    },
  });

  await assert.rejects(collectStream(createSseEventStream(stream)), /sse-stream-failure/u);
});
