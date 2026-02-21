import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeControlPlaneOps } from '../src/services/runtime-control-plane-ops.ts';

async function flushManualSchedule(queue: Array<() => void>): Promise<void> {
  while (queue.length > 0) {
    const callback = queue.shift();
    callback?.();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

void test('runtime control-plane ops prioritizes interactive tasks and records enqueue/start/success spans', async () => {
  const scheduled: Array<() => void> = [];
  const taskOrder: string[] = [];
  const perfEvents: Array<{ name: string; attrs: Readonly<Record<string, unknown>> | undefined }> =
    [];
  const endedSpans: Array<Readonly<Record<string, unknown>> | undefined> = [];
  const stderrLines: string[] = [];
  const nowByCall = [100, 100, 108, 122];

  const service = new RuntimeControlPlaneOps({
    onFatal: (error) => {
      throw error;
    },
    startPerfSpan: (_name, _attrs) => ({
      end: (attrs) => {
        endedSpans.push(attrs);
      },
    }),
    recordPerfEvent: (name, attrs) => {
      perfEvents.push({ name, attrs });
    },
    writeStderr: (text) => {
      stderrLines.push(text);
    },
    nowMs: () => nowByCall.shift() ?? 122,
    schedule: (callback) => {
      scheduled.push(callback);
    },
  });

  service.enqueueBackground(async () => {
    taskOrder.push('background');
  }, 'bg');
  service.enqueueInteractive(async () => {
    taskOrder.push('interactive');
  }, 'fg');

  assert.deepEqual(service.metrics(), {
    interactiveQueued: 1,
    backgroundQueued: 1,
    running: false,
  });
  assert.equal(scheduled.length, 1);

  await flushManualSchedule(scheduled);
  await service.waitForDrain();

  assert.deepEqual(taskOrder, ['interactive', 'background']);
  assert.deepEqual(
    perfEvents.map((event) => event.name),
    [
      'mux.control-plane.op.enqueued',
      'mux.control-plane.op.enqueued',
      'mux.control-plane.op.start',
      'mux.control-plane.op.start',
    ],
  );
  assert.deepEqual(
    endedSpans.map((entry) => entry?.['status'] ?? null),
    ['ok', 'ok'],
  );
  assert.deepEqual(stderrLines, []);
  assert.deepEqual(service.metrics(), {
    interactiveQueued: 0,
    backgroundQueued: 0,
    running: false,
  });
});

void test('runtime control-plane ops records error spans, reports stderr, and continues queue drain', async () => {
  const scheduled: Array<() => void> = [];
  const taskOrder: string[] = [];
  const endedSpans: Array<Readonly<Record<string, unknown>> | undefined> = [];
  const stderrLines: string[] = [];

  const service = new RuntimeControlPlaneOps({
    onFatal: (error) => {
      throw error;
    },
    startPerfSpan: () => ({
      end: (attrs) => {
        endedSpans.push(attrs);
      },
    }),
    recordPerfEvent: () => {},
    writeStderr: (text) => {
      stderrLines.push(text);
    },
    schedule: (callback) => {
      scheduled.push(callback);
    },
  });

  service.enqueueInteractive(async () => {
    taskOrder.push('first');
    throw new Error('boom');
  }, 'first');
  service.enqueueInteractive(async () => {
    taskOrder.push('second');
  }, 'second');

  await flushManualSchedule(scheduled);
  await service.waitForDrain();

  assert.deepEqual(taskOrder, ['first', 'second']);
  assert.deepEqual(
    endedSpans.map((entry) => entry?.['status'] ?? null),
    ['error', 'ok'],
  );
  assert.equal(endedSpans[0]?.['message'], 'boom');
  assert.deepEqual(stderrLines, ['[mux] control-plane error boom\n']);
});

void test('runtime control-plane ops routes fatal callback failures through onFatal', async () => {
  const scheduled: Array<() => void> = [];
  const fatalMessages: string[] = [];
  let completed = false;

  const service = new RuntimeControlPlaneOps({
    onFatal: (error) => {
      fatalMessages.push(error instanceof Error ? error.message : String(error));
    },
    startPerfSpan: (_name, attrs) => {
      if (attrs?.['label'] === 'bad') {
        throw new Error('fatal-start');
      }
      return {
        end: () => {},
      };
    },
    recordPerfEvent: () => {},
    writeStderr: () => {},
    schedule: (callback) => {
      scheduled.push(callback);
    },
  });

  service.enqueueInteractive(async () => {}, 'bad');
  service.enqueueInteractive(async () => {
    completed = true;
  }, 'good');

  await flushManualSchedule(scheduled);
  await service.waitForDrain();

  assert.deepEqual(fatalMessages, ['fatal-start']);
  assert.equal(completed, true);
});

void test('runtime control-plane ops marks superseded latest interactive operations as canceled', async () => {
  const scheduled: Array<() => void> = [];
  const endedSpans: Array<Readonly<Record<string, unknown>> | undefined> = [];
  let firstObservedAbort = false;
  const ran: string[] = [];

  const service = new RuntimeControlPlaneOps({
    onFatal: (error) => {
      throw error;
    },
    startPerfSpan: () => ({
      end: (attrs) => {
        endedSpans.push(attrs);
      },
    }),
    recordPerfEvent: () => {},
    writeStderr: () => {},
    schedule: (callback) => {
      scheduled.push(callback);
    },
  });

  service.enqueueInteractiveLatest(
    'left-nav:activate',
    async ({ signal }) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          firstObservedAbort = true;
          resolve();
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            firstObservedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
      ran.push('first');
    },
    'first',
  );
  await flushManualSchedule(scheduled);

  service.enqueueInteractiveLatest(
    'left-nav:activate',
    async () => {
      ran.push('second');
    },
    'second',
  );
  await flushManualSchedule(scheduled);
  await service.waitForDrain();

  assert.equal(firstObservedAbort, true);
  assert.deepEqual(ran, ['first', 'second']);
  assert.deepEqual(
    endedSpans.map((entry) => entry?.['status'] ?? null),
    ['canceled', 'ok'],
  );
});
