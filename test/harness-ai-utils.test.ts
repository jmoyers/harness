import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  collectReadableStream,
  consumeReadableStream,
  toAsyncIterableStream,
} from '../packages/harness-ai/src/async-iterable-stream.ts';
import {
  extractFirstBalancedJsonObject,
  parseJsonObjectFromText,
  safeJsonParse,
} from '../packages/harness-ai/src/json-parse.ts';

void test('toAsyncIterableStream supports async iteration', async () => {
  const stream = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
      controller.close();
    },
  });

  const iterable = toAsyncIterableStream(stream);
  const collected: number[] = [];
  for await (const value of iterable) {
    collected.push(value);
  }

  assert.deepEqual(collected, [1, 2]);
});

void test('toAsyncIterableStream keeps existing async iterator and skips undefined chunks', async () => {
  const stream = new ReadableStream<number | undefined>({
    start(controller) {
      controller.enqueue(undefined);
      controller.enqueue(9);
      controller.close();
    },
  });
  const existingIterator = stream[Symbol.asyncIterator];
  assert.equal(typeof existingIterator, 'function');
  const streamWithIterator = stream as ReadableStream<number | undefined> & {
    [Symbol.asyncIterator]: NonNullable<typeof existingIterator>;
  };
  streamWithIterator[Symbol.asyncIterator] = existingIterator!;

  const kept = toAsyncIterableStream(streamWithIterator);
  assert.equal(kept[Symbol.asyncIterator], existingIterator);

  const fallbackStream = new ReadableStream<number | undefined>({
    start(controller) {
      controller.enqueue(undefined);
      controller.enqueue(9);
      controller.close();
    },
  });
  Object.defineProperty(fallbackStream, Symbol.asyncIterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: undefined,
  });
  const converted = toAsyncIterableStream(fallbackStream);
  const values: number[] = [];
  for await (const value of converted) {
    values.push(value as number);
  }
  assert.deepEqual(values, [9]);
});

void test('collectReadableStream and consumeReadableStream consume streams', async () => {
  const streamA = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(3);
      controller.close();
    },
  });

  const streamB = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(4);
      controller.close();
    },
  });

  assert.deepEqual(await collectReadableStream(streamA), [3]);
  await consumeReadableStream(streamB);
});

void test('collectReadableStream and consumeReadableStream release reader locks on stream errors', async () => {
  const streamA = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.error(new Error('boom'));
    },
  });
  const streamB = new ReadableStream<number>({
    start(controller) {
      controller.error(new Error('boom'));
    },
  });

  await assert.rejects(collectReadableStream(streamA), /boom/u);
  await assert.rejects(consumeReadableStream(streamB), /boom/u);
});

void test('json parse helpers parse and extract balanced objects', () => {
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  assert.equal(safeJsonParse('x'), undefined);

  assert.equal(extractFirstBalancedJsonObject('prefix {"a":1} suffix'), '{"a":1}');
  assert.equal(extractFirstBalancedJsonObject('prefix {"a":'), undefined);

  assert.deepEqual(parseJsonObjectFromText('hello {"a":1} world'), { a: 1 });
  assert.equal(parseJsonObjectFromText('no object'), undefined);
});

void test('json parse helpers handle escaped strings and nested object text safely', () => {
  assert.equal(
    extractFirstBalancedJsonObject('x {"a":"{not a brace}", "b":"quote\\\\\\"ok"} y'),
    '{"a":"{not a brace}", "b":"quote\\\\\\"ok"}',
  );
  assert.equal(extractFirstBalancedJsonObject('abc'), undefined);
  assert.deepEqual(parseJsonObjectFromText('prefix {"a":{"b":2}} tail'), { a: { b: 2 } });
});
