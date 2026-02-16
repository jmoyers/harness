import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  StartupSequencer
} from '../src/mux/startup-sequencer.ts';

interface TimerEntry {
  readonly callback: () => void;
  readonly delayMs: number;
}

function createFakeTimers(): {
  readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  readonly fire: (handle: ReturnType<typeof setTimeout>) => void;
  readonly handles: () => readonly ReturnType<typeof setTimeout>[];
  readonly clearCount: () => number;
} {
  const timers = new Map<ReturnType<typeof setTimeout>, TimerEntry>();
  let nextHandle = 1;
  let cleared = 0;
  return {
    setTimer: (callback, delayMs) => {
      const handle = nextHandle as unknown as ReturnType<typeof setTimeout>;
      nextHandle += 1;
      timers.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimer: (handle) => {
      if (timers.delete(handle)) {
        cleared += 1;
      }
    },
    fire: (handle) => {
      const entry = timers.get(handle);
      if (entry === undefined) {
        return;
      }
      timers.delete(handle);
      entry.callback();
    },
    handles: () => [...timers.keys()],
    clearCount: () => cleared
  };
}

void test('startup sequencer initializes, resets target state, and enforces target matching', () => {
  let nowMs = 1000;
  const sequencer = new StartupSequencer({
    quietMs: 25,
    nonemptyFallbackMs: 50,
    nowMs: () => nowMs
  });

  assert.equal(sequencer.snapshot().phase, 'inactive');
  assert.equal(sequencer.markFirstOutput('conversation-a'), false);

  sequencer.setTargetSession('conversation-a');
  assert.equal(sequencer.snapshot().phase, 'waiting-for-output');
  assert.equal(sequencer.markFirstPaintVisible('conversation-a', 5), false);
  assert.equal(sequencer.markHeaderVisible('conversation-a', false), false);
  assert.equal(sequencer.maybeSelectSettleGate('conversation-a', 5), null);
  assert.equal(sequencer.markFirstOutput('conversation-b'), false);

  assert.equal(sequencer.markFirstOutput('conversation-a'), true);
  nowMs += 10;
  assert.equal(sequencer.snapshot().firstOutputAtMs, 1000);
  assert.equal(sequencer.markFirstOutput('conversation-a'), false);

  sequencer.setTargetSession(null);
  const snapshot = sequencer.snapshot();
  assert.equal(snapshot.targetSessionId, null);
  assert.equal(snapshot.phase, 'inactive');
  assert.equal(snapshot.firstOutputObserved, false);
  assert.equal(snapshot.settleGate, null);
});

void test('startup sequencer uses Date.now when nowMs override is not provided', () => {
  const sequencer = new StartupSequencer({
    quietMs: 0,
    nonemptyFallbackMs: 0
  });
  sequencer.setTargetSession('default-now');
  assert.equal(sequencer.markFirstOutput('default-now'), true);
  const firstOutputAtMs = sequencer.snapshot().firstOutputAtMs;
  assert.equal(typeof firstOutputAtMs, 'number');
  assert.equal((firstOutputAtMs ?? 0) > 0, true);
});

void test('startup sequencer header gate schedules once and settles through timer callback', async () => {
  const nowMs = 2000;
  const timers = createFakeTimers();
  const settledEvents: Array<{ sessionId: string; gate: string; quietMs: number }> = [];
  const sequencer = new StartupSequencer({
    quietMs: 40,
    nonemptyFallbackMs: 300,
    nowMs: () => nowMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  sequencer.setTargetSession('session-1');
  assert.equal(sequencer.markFirstOutput('session-1'), true);
  assert.equal(sequencer.markFirstPaintVisible('session-1', 0), false);
  assert.equal(sequencer.markFirstPaintVisible('session-1', 3), true);
  assert.equal(sequencer.markFirstPaintVisible('session-1', 4), false);
  assert.equal(sequencer.markHeaderVisible('session-1', true), true);
  assert.equal(sequencer.markHeaderVisible('session-1', true), false);
  assert.equal(sequencer.maybeSelectSettleGate('session-1', 3), 'header');
  assert.equal(sequencer.maybeSelectSettleGate('session-1', 3), null);

  assert.equal(
    sequencer.scheduleSettledProbe('session-1', (event) => {
      settledEvents.push({ sessionId: event.sessionId, gate: event.gate, quietMs: event.quietMs });
    }),
    true
  );
  assert.equal(
    sequencer.scheduleSettledProbe('session-1', (event) => {
      settledEvents.push({ sessionId: event.sessionId, gate: event.gate, quietMs: event.quietMs });
    }),
    false
  );
  const [handle] = timers.handles();
  assert.notEqual(handle, undefined);
  timers.fire(handle!);
  assert.deepEqual(settledEvents, [{ sessionId: 'session-1', gate: 'header', quietMs: 40 }]);
  assert.equal(sequencer.snapshot().phase, 'settled');
  assert.equal(sequencer.snapshot().settledObserved, true);
  assert.equal(sequencer.signalSettled(), false);

  let settledResolved = false;
  const wait = sequencer.waitForSettled().then(() => {
    settledResolved = true;
  });
  await wait;
  assert.equal(settledResolved, true);
});

void test('startup sequencer nonempty gate reschedules settle timer and ignores stale timer callback', () => {
  let nowMs = 3000;
  const timers = createFakeTimers();
  const settledEvents: Array<{ sessionId: string; gate: string; quietMs: number }> = [];
  const sequencer = new StartupSequencer({
    quietMs: 30,
    nonemptyFallbackMs: 120,
    nowMs: () => nowMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  sequencer.setTargetSession('session-2');
  assert.equal(sequencer.markFirstOutput('session-2'), true);
  assert.equal(sequencer.markFirstPaintVisible('session-2', 2), true);
  assert.equal(sequencer.markHeaderVisible('session-2', false), false);
  assert.equal(sequencer.maybeSelectSettleGate('session-2', 2), null);
  nowMs += 140;
  assert.equal(sequencer.maybeSelectSettleGate('session-2', 2), 'nonempty');

  assert.equal(
    sequencer.scheduleSettledProbe('session-2', (event) => {
      settledEvents.push({ sessionId: event.sessionId, gate: event.gate, quietMs: event.quietMs });
    }),
    true
  );
  const [firstHandle] = timers.handles();
  assert.notEqual(firstHandle, undefined);

  assert.equal(
    sequencer.scheduleSettledProbe('session-2', (event) => {
      settledEvents.push({ sessionId: event.sessionId, gate: event.gate, quietMs: event.quietMs });
    }),
    true
  );
  const [secondHandle] = timers.handles();
  assert.notEqual(secondHandle, undefined);
  assert.notEqual(firstHandle, secondHandle);
  assert.equal(timers.clearCount(), 1);

  timers.fire(firstHandle!);
  assert.deepEqual(settledEvents, []);
  timers.fire(secondHandle!);
  assert.deepEqual(settledEvents, [{ sessionId: 'session-2', gate: 'nonempty', quietMs: 30 }]);
});

void test('startup sequencer finalization clears timers, signals waiters, and retargets wait promise', async () => {
  let nowMs = 4000;
  const timers = createFakeTimers();
  const sequencer = new StartupSequencer({
    quietMs: 50,
    nonemptyFallbackMs: 0,
    nowMs: () => nowMs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  sequencer.setTargetSession('session-3');
  assert.equal(sequencer.clearSettledTimer(), false);
  assert.equal(sequencer.signalSettled(), true);
  assert.equal(sequencer.signalSettled(), false);

  sequencer.setTargetSession('session-4');
  let settledResolved = false;
  const wait = sequencer.waitForSettled().then(() => {
    settledResolved = true;
  });

  assert.equal(sequencer.markFirstOutput('session-4'), true);
  nowMs += 5;
  assert.equal(sequencer.markFirstPaintVisible('session-4', 1), true);
  assert.equal(sequencer.markHeaderVisible('session-4', true), true);
  assert.equal(sequencer.maybeSelectSettleGate('session-4', 1), 'header');
  assert.equal(sequencer.scheduleSettledProbe('session-4', () => {}), true);
  const [handle] = timers.handles();
  assert.notEqual(handle, undefined);

  sequencer.finalize();
  assert.equal(timers.clearCount(), 1);
  await wait;
  assert.equal(settledResolved, true);

  sequencer.setTargetSession('session-5');
  assert.equal(sequencer.scheduleSettledProbe('session-5', () => {}), false);
  timers.fire(handle!);
  assert.equal(sequencer.snapshot().settledObserved, false);
});

void test('startup sequencer ignores stale timer callback when state resets to same target', () => {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const sequencer = new StartupSequencer({
    quietMs: 10,
    nonemptyFallbackMs: 0,
    nowMs: () => 5000,
    setTimer: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      // Intentionally noop so we can fire stale callbacks after reset.
    }
  });

  sequencer.setTargetSession('same-session');
  assert.equal(sequencer.markFirstOutput('same-session'), true);
  assert.equal(sequencer.markFirstPaintVisible('same-session', 1), true);
  assert.equal(sequencer.markHeaderVisible('same-session', true), true);
  assert.equal(sequencer.maybeSelectSettleGate('same-session', 1), 'header');
  assert.equal(sequencer.scheduleSettledProbe('same-session', () => {}), true);
  const staleHandle = [...callbacks.keys()][0];
  assert.notEqual(staleHandle, undefined);

  sequencer.setTargetSession('same-session');
  callbacks.get(staleHandle!)?.();
  assert.equal(sequencer.snapshot().settledObserved, false);
});

void test('startup sequencer default timer helpers are used when no timer overrides are provided', async () => {
  const sequencer = new StartupSequencer({
    quietMs: 25,
    nonemptyFallbackMs: 0,
    nowMs: () => 7000
  });
  sequencer.setTargetSession('default-timers');
  assert.equal(sequencer.markFirstOutput('default-timers'), true);
  assert.equal(sequencer.markFirstPaintVisible('default-timers', 1), true);
  assert.equal(sequencer.markHeaderVisible('default-timers', true), true);
  assert.equal(sequencer.maybeSelectSettleGate('default-timers', 1), 'header');
  assert.equal(sequencer.scheduleSettledProbe('default-timers', () => {}), true);
  assert.equal(sequencer.clearSettledTimer(), true);
  sequencer.finalize();
  await sequencer.waitForSettled();
  assert.equal(sequencer.snapshot().settledSignaled, true);
});

void test('startup sequencer ignores stale nonempty timer callback after already settling', () => {
  let nowMs = 9000;
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const settledEvents: string[] = [];
  const sequencer = new StartupSequencer({
    quietMs: 20,
    nonemptyFallbackMs: 0,
    nowMs: () => nowMs,
    setTimer: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      // noop to preserve stale callbacks for branch coverage checks.
    }
  });

  sequencer.setTargetSession('session-stale');
  assert.equal(sequencer.markFirstOutput('session-stale'), true);
  nowMs += 1;
  assert.equal(sequencer.markFirstPaintVisible('session-stale', 1), true);
  assert.equal(sequencer.maybeSelectSettleGate('session-stale', 1), 'nonempty');
  assert.equal(
    sequencer.scheduleSettledProbe('session-stale', (event) => {
      settledEvents.push(event.sessionId);
    }),
    true
  );
  const firstHandle = [...callbacks.keys()][0];
  assert.notEqual(firstHandle, undefined);
  assert.equal(
    sequencer.scheduleSettledProbe('session-stale', (event) => {
      settledEvents.push(event.sessionId);
    }),
    true
  );
  const secondHandle = [...callbacks.keys()][1];
  assert.notEqual(secondHandle, undefined);

  callbacks.get(secondHandle!)?.();
  callbacks.get(firstHandle!)?.();
  assert.deepEqual(settledEvents, ['session-stale']);
});
