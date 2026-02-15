import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ControlPlaneOpQueue,
  type ControlPlaneOpPriority
} from '../src/mux/control-plane-op-queue.ts';

async function flushManualSchedule(queue: Array<() => void>): Promise<void> {
  while (queue.length > 0) {
    const next = queue.shift();
    next?.();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

void test('control-plane op queue prioritizes interactive tasks and deduplicates scheduled pump', async () => {
  const scheduled: Array<() => void> = [];
  const nowByCall = [100, 100, 108, 120, 130];
  const started: Array<{ label: string; priority: ControlPlaneOpPriority; waitMs: number }> = [];
  const completed: string[] = [];
  const ran: string[] = [];
  const enqueued: Array<{ label: string; priority: ControlPlaneOpPriority }> = [];

  const queue = new ControlPlaneOpQueue({
    nowMs: () => nowByCall.shift() ?? 130,
    schedule: (callback) => {
      scheduled.push(callback);
    },
    onEnqueued: (event) => {
      enqueued.push({ label: event.label, priority: event.priority });
    },
    onStart: (event) => {
      started.push({ label: event.label, priority: event.priority, waitMs: event.waitMs });
    },
    onSuccess: (event) => {
      completed.push(event.label);
    }
  });

  queue.enqueueBackground(() => {
    ran.push('background');
    return Promise.resolve();
  });
  queue.enqueueInteractive(() => {
    ran.push('interactive');
    return Promise.resolve();
  });

  assert.equal(scheduled.length, 1);
  await flushManualSchedule(scheduled);
  await queue.waitForDrain();

  assert.deepEqual(enqueued, [
    { label: 'background-op', priority: 'background' },
    { label: 'interactive-op', priority: 'interactive' }
  ]);
  assert.deepEqual(ran, ['interactive', 'background']);
  assert.deepEqual(completed, ['interactive-op', 'background-op']);
  assert.deepEqual(started.map((entry) => entry.priority), ['interactive', 'background']);
  assert.equal(started[0]?.waitMs, 8);
  assert.equal(started[1]?.waitMs, 20);
});

void test('control-plane op queue waitForDrain resolves immediately when queue is idle', async () => {
  const queue = new ControlPlaneOpQueue({
    schedule: () => {
      throw new Error('schedule should not be called for idle wait');
    }
  });
  assert.deepEqual(queue.metrics(), {
    interactiveQueued: 0,
    backgroundQueued: 0,
    running: false
  });
  await queue.waitForDrain();
  assert.ok(true);
});

void test('control-plane op queue metrics reflect enqueued and running operations', async () => {
  const scheduled: Array<() => void> = [];
  let releaseTask: () => void = () => {
    throw new Error('expected task release callback');
  };
  const heldTask = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });
  const queue = new ControlPlaneOpQueue({
    schedule: (callback) => {
      scheduled.push(callback);
    }
  });

  queue.enqueueBackground(async () => {
    await heldTask;
  }, 'held');
  assert.deepEqual(queue.metrics(), {
    interactiveQueued: 0,
    backgroundQueued: 1,
    running: false
  });

  await flushManualSchedule(scheduled);
  assert.deepEqual(queue.metrics(), {
    interactiveQueued: 0,
    backgroundQueued: 0,
    running: true
  });

  releaseTask();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await flushManualSchedule(scheduled);
  await queue.waitForDrain();
  assert.deepEqual(queue.metrics(), {
    interactiveQueued: 0,
    backgroundQueued: 0,
    running: false
  });
});

void test('control-plane op queue reports task errors and continues draining subsequent tasks', async () => {
  const scheduled: Array<() => void> = [];
  const errors: string[] = [];
  const completed: string[] = [];
  const ran: string[] = [];

  const queue = new ControlPlaneOpQueue({
    schedule: (callback) => {
      scheduled.push(callback);
    },
    onError: (event, _metrics, error) => {
      errors.push(`${event.label}:${error instanceof Error ? error.message : String(error)}`);
    },
    onSuccess: (event) => {
      completed.push(event.label);
    }
  });

  queue.enqueueInteractive(() => {
    throw new Error('boom');
  }, 'first');
  queue.enqueueInteractive(() => {
    ran.push('second');
    return Promise.resolve();
  }, 'second');

  await flushManualSchedule(scheduled);
  await queue.waitForDrain();

  assert.deepEqual(errors, ['first:boom']);
  assert.deepEqual(completed, ['second']);
  assert.deepEqual(ran, ['second']);
});

void test('control-plane op queue surfaces fatal callback errors without blocking queue progress', async () => {
  const scheduled: Array<() => void> = [];
  const fatalMessages: string[] = [];
  const completed: string[] = [];

  const queue = new ControlPlaneOpQueue({
    schedule: (callback) => {
      scheduled.push(callback);
    },
    onStart: (event) => {
      if (event.label === 'bad') {
        throw new Error('fatal-start');
      }
    },
    onSuccess: (event) => {
      completed.push(event.label);
    },
    onFatal: (error) => {
      fatalMessages.push(error instanceof Error ? error.message : String(error));
    }
  });

  queue.enqueueInteractive(() => Promise.resolve(), 'bad');
  queue.enqueueInteractive(() => Promise.resolve(), 'good');

  await flushManualSchedule(scheduled);
  await queue.waitForDrain();

  assert.deepEqual(fatalMessages, ['fatal-start']);
  assert.deepEqual(completed, ['good']);
});

void test('control-plane op queue supports default scheduler and options', async () => {
  const queue = new ControlPlaneOpQueue();
  let ran = false;
  queue.enqueueInteractive(() => {
    ran = true;
    return Promise.resolve();
  }, 'default');
  await queue.waitForDrain();
  assert.equal(ran, true);
});

void test('control-plane op queue ignores pump execution while an operation is already running', async () => {
  const scheduled: Array<() => void> = [];
  const ran: string[] = [];
  let releaseFirst: () => void = () => {
    throw new Error('expected first task resolver');
  };
  const firstTask = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const queue = new ControlPlaneOpQueue({
    schedule: (callback) => {
      scheduled.push(callback);
    }
  });

  queue.enqueueInteractive(async () => {
    ran.push('first-start');
    await firstTask;
    ran.push('first-end');
  }, 'first');
  await flushManualSchedule(scheduled);
  assert.deepEqual(ran, ['first-start']);

  queue.enqueueInteractive(() => {
    ran.push('second');
    return Promise.resolve();
  }, 'second');
  await flushManualSchedule(scheduled);
  assert.deepEqual(ran, ['first-start']);

  releaseFirst();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await flushManualSchedule(scheduled);
  await queue.waitForDrain();
  assert.deepEqual(ran, ['first-start', 'first-end', 'second']);
});
