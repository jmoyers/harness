import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createNormalizedEvent,
  type NormalizedEventEnvelope,
} from '../../../src/events/normalized-events.ts';
import { EventPersistence } from '../../../src/services/event-persistence.ts';

function createEvent(suffix: string): NormalizedEventEnvelope {
  return createNormalizedEvent(
    'provider',
    'provider-text-delta',
    {
      tenantId: 'tenant',
      userId: 'user',
      workspaceId: 'workspace',
      worktreeId: 'worktree',
      conversationId: 'conversation',
      turnId: 'turn',
    },
    {
      kind: 'text-delta',
      threadId: 'thread',
      turnId: 'turn',
      delta: suffix,
    },
    () => new Date('2026-02-18T00:00:00.000Z'),
    () => `event-${suffix}`,
  );
}

void test('event persistence flushes on timer and emits success span', () => {
  const appended: string[][] = [];
  const spanEndCalls: string[] = [];
  let scheduledCallback: (() => void) | null = null;
  const eventPersistence = new EventPersistence({
    appendEvents: (events) => appended.push(events.map((event) => event.eventId)),
    startPerfSpan: (_name, attrs) => {
      spanEndCalls.push(`start:${JSON.stringify(attrs)}`);
      return {
        end: (endAttrs) => spanEndCalls.push(`end:${JSON.stringify(endAttrs)}`),
      };
    },
    writeStderr: () => {},
    setTimeoutFn: (callback) => {
      scheduledCallback = callback;
      return { id: 1 } as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {},
  });

  eventPersistence.enqueue(createEvent('a'));
  assert.equal(eventPersistence.pendingCount(), 1);
  if (scheduledCallback === null) {
    throw new Error('expected scheduled callback');
  }
  (scheduledCallback as () => void)();

  assert.equal(eventPersistence.pendingCount(), 0);
  assert.deepEqual(appended, [['event-a']]);
  assert.deepEqual(spanEndCalls, [
    'start:{"reason":"timer","count":1}',
    'end:{"reason":"timer","status":"ok","count":1}',
  ]);
});

void test('event persistence flushes immediately at max batch and clears timer', () => {
  const appended: string[][] = [];
  const cleared: number[] = [];
  const scheduled: number[] = [];
  const eventPersistence = new EventPersistence({
    appendEvents: (events) => appended.push(events.map((event) => event.eventId)),
    startPerfSpan: () => ({
      end: () => {},
    }),
    writeStderr: () => {},
    flushMaxBatch: 2,
    setTimeoutFn: () => {
      scheduled.push(1);
      return 42 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {
      cleared.push(1);
    },
  });

  eventPersistence.enqueue(createEvent('a'));
  eventPersistence.enqueue(createEvent('b'));

  assert.equal(eventPersistence.pendingCount(), 0);
  assert.deepEqual(appended, [['event-a', 'event-b']]);
  assert.deepEqual(scheduled, [1]);
  assert.deepEqual(cleared, [1]);
});

void test('event persistence keeps one scheduled timer across multiple under-limit enqueues', () => {
  const scheduled: number[] = [];
  const eventPersistence = new EventPersistence({
    appendEvents: () => {},
    startPerfSpan: () => ({
      end: () => {},
    }),
    writeStderr: () => {},
    flushMaxBatch: 10,
    setTimeoutFn: () => {
      scheduled.push(1);
      return { id: 7 } as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {},
  });

  eventPersistence.enqueue(createEvent('a'));
  eventPersistence.enqueue(createEvent('b'));
  eventPersistence.enqueue(createEvent('c'));

  assert.equal(eventPersistence.pendingCount(), 3);
  assert.deepEqual(scheduled, [1]);
});

void test('event persistence flush reports append errors and writes stderr', () => {
  const spanEndCalls: string[] = [];
  const stderr: string[] = [];
  const eventPersistence = new EventPersistence({
    appendEvents: () => {
      throw new Error('boom');
    },
    startPerfSpan: () => ({
      end: (attrs) => spanEndCalls.push(JSON.stringify(attrs)),
    }),
    writeStderr: (text) => stderr.push(text),
  });

  eventPersistence.enqueue(createEvent('a'));
  eventPersistence.flush('shutdown');

  assert.deepEqual(spanEndCalls, [
    '{"reason":"shutdown","status":"error","count":1,"message":"boom"}',
  ]);
  assert.deepEqual(stderr, ['[mux] event-store error boom\n']);
  assert.equal(eventPersistence.pendingCount(), 0);
});

void test('event persistence handles non-error throw values and empty flush calls', () => {
  const spanEndCalls: string[] = [];
  const stderr: string[] = [];
  const eventPersistence = new EventPersistence({
    appendEvents: () => {
      throw 'bad';
    },
    startPerfSpan: () => ({
      end: (attrs) => spanEndCalls.push(JSON.stringify(attrs)),
    }),
    writeStderr: (text) => stderr.push(text),
  });

  eventPersistence.flush('shutdown');
  eventPersistence.enqueue(createEvent('z'));
  eventPersistence.flush('immediate');
  eventPersistence.flush('shutdown');

  assert.deepEqual(spanEndCalls, [
    '{"reason":"immediate","status":"error","count":1,"message":"bad"}',
  ]);
  assert.deepEqual(stderr, ['[mux] event-store error bad\n']);
});
