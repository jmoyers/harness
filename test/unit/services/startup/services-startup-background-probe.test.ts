import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupBackgroundProbeService } from '../../../../src/services/startup-background-probe.ts';

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

void test('startup background probe records wait and disabled-skip events', () => {
  const events: string[] = [];
  const service = new StartupBackgroundProbeService({
    enabled: false,
    maxWaitMs: 5000,
    isShuttingDown: () => false,
    waitForSettled: async () => {},
    settledObserved: () => false,
    refreshProcessUsage: () => {},
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  service.recordWaitPhase();
  service.stop();

  assert.deepEqual(events, [
    'mux.startup.background-probes.wait:{"maxWaitMs":5000,"enabled":0}',
    'mux.startup.background-probes.skipped:{"reason":"disabled"}',
  ]);
});

void test('startup background probe enabled path waits then starts once and schedules interval refresh', async () => {
  const events: string[] = [];
  const refreshes: string[] = [];
  const ticks: Array<() => void> = [];
  let intervalHandleIndex = 0;
  let timeoutHandleIndex = 0;
  let clearIntervalCount = 0;
  let clearTimeoutCount = 0;
  const intervalHandles: IntervalHandle[] = [];
  const timeoutHandles: TimeoutHandle[] = [];

  const service = new StartupBackgroundProbeService({
    enabled: true,
    maxWaitMs: 5000,
    isShuttingDown: () => false,
    waitForSettled: async () => {},
    settledObserved: () => true,
    refreshProcessUsage: (reason) => {
      refreshes.push(reason);
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    setIntervalFn: (handler, _ms) => {
      ticks.push(handler);
      intervalHandleIndex += 1;
      const nextHandle = { intervalHandleIndex } as unknown as IntervalHandle;
      intervalHandles.push(nextHandle);
      return nextHandle;
    },
    clearIntervalFn: (_handle) => {
      clearIntervalCount += 1;
    },
    setTimeoutFn: (_handler, _ms) => {
      timeoutHandleIndex += 1;
      const nextHandle = { timeoutHandleIndex } as unknown as TimeoutHandle;
      timeoutHandles.push(nextHandle);
      return nextHandle;
    },
    clearTimeoutFn: (_handle) => {
      clearTimeoutCount += 1;
    },
  });

  service.recordWaitPhase();
  await service.startWhenSettled();
  await service.startWhenSettled();
  const intervalTick = ticks.at(-1);
  if (intervalTick === undefined) {
    throw new Error('interval callback not set');
  }
  intervalTick();
  service.stop();

  assert.deepEqual(events, [
    'mux.startup.background-probes.wait:{"maxWaitMs":5000,"enabled":1}',
    'mux.startup.background-probes.begin:{"timedOut":false,"settledObserved":true}',
  ]);
  assert.deepEqual(refreshes, ['startup', 'interval']);
  assert.equal(clearTimeoutCount, 2);
  assert.equal(clearIntervalCount, 1);
  assert.equal(intervalHandles.length, 1);
  assert.equal(timeoutHandles.length, 2);
});

void test('startup background probe timeout path starts with timedOut true', async () => {
  const events: string[] = [];

  const service = new StartupBackgroundProbeService({
    enabled: true,
    maxWaitMs: 5000,
    isShuttingDown: () => false,
    waitForSettled: () => new Promise<void>(() => {}),
    settledObserved: () => false,
    refreshProcessUsage: () => {},
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    setTimeoutFn: (handler, _ms) => {
      handler();
      return { timeout: true } as unknown as TimeoutHandle;
    },
    clearTimeoutFn: () => {},
    setIntervalFn: () => ({ interval: true }) as unknown as IntervalHandle,
    clearIntervalFn: () => {},
  });

  await service.startWhenSettled();

  assert.deepEqual(events, [
    'mux.startup.background-probes.begin:{"timedOut":true,"settledObserved":false}',
  ]);
});

void test('startup background probe does not start while shutting down', async () => {
  const events: string[] = [];

  const service = new StartupBackgroundProbeService({
    enabled: true,
    maxWaitMs: 5000,
    isShuttingDown: () => true,
    waitForSettled: async () => {},
    settledObserved: () => true,
    refreshProcessUsage: () => {},
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
    setIntervalFn: () => {
      throw new Error('interval should not start while shutting down');
    },
    setTimeoutFn: () => ({ timeout: true }) as unknown as TimeoutHandle,
    clearTimeoutFn: () => {},
  });

  await service.startWhenSettled();
  service.stop();

  assert.deepEqual(events, []);
});
