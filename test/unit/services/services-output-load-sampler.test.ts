import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { OutputLoadSampler } from '../../../src/services/output-load-sampler.ts';

interface FakeMonitor {
  enableCalls: number;
  disableCalls: number;
  resetCalls: number;
  p95Ns: number;
  maxNs: number;
}

function createMonitor(state: FakeMonitor) {
  return {
    enable: () => {
      state.enableCalls += 1;
    },
    disable: () => {
      state.disableCalls += 1;
    },
    reset: () => {
      state.resetCalls += 1;
    },
    percentile: () => state.p95Ns,
    get max() {
      return state.maxNs;
    },
  };
}

void test('output load sampler aggregates samples, updates status row, and emits perf payload', () => {
  let nowMs = 0;
  const events: string[] = [];
  let statusChangeCalls = 0;
  const monitorState: FakeMonitor = {
    enableCalls: 0,
    disableCalls: 0,
    resetCalls: 0,
    p95Ns: 2_500_000,
    maxNs: 6_700_000,
  };
  const sampler = new OutputLoadSampler({
    recordPerfEvent: (name, attrs) => {
      events.push(`${name}:${JSON.stringify(attrs)}`);
    },
    getControlPlaneQueueMetrics: () => ({
      interactiveQueued: 2,
      backgroundQueued: 1,
      running: true,
    }),
    getActiveConversationId: () => 'session-a',
    getPendingPersistedEvents: () => 4,
    onStatusRowChanged: () => {
      statusChangeCalls += 1;
    },
    nowMs: () => nowMs,
    createEventLoopDelayMonitor: () => createMonitor(monitorState),
  });

  sampler.recordOutputChunk('session-a', 1024, true);
  sampler.recordOutputChunk('session-b', 2048, false);
  sampler.recordOutputHandled(3);
  sampler.recordOutputHandled(5);
  sampler.recordRenderSample(10, 2);
  sampler.recordRenderSample(20, 4);

  nowMs = 1000;
  sampler.sampleNow();

  assert.deepEqual(sampler.currentStatusRow(), {
    fps: 2,
    kbPerSecond: 3,
    renderAvgMs: 15,
    renderMaxMs: 20,
    outputHandleAvgMs: 4,
    outputHandleMaxMs: 5,
    eventLoopP95Ms: 2.5,
  });
  assert.equal(statusChangeCalls, 1);
  assert.equal(monitorState.resetCalls, 1);
  assert.deepEqual(events, [
    'mux.output-load.sample:{"windowMs":1000,"activeChunks":1,"inactiveChunks":1,"activeBytes":1024,"inactiveBytes":2048,"outputHandleCount":2,"outputHandleAvgMs":4,"outputHandleMaxMs":5,"renderCount":2,"renderAvgMs":15,"renderMaxMs":20,"renderChangedRows":6,"eventLoopP95Ms":2.5,"eventLoopMaxMs":6.7,"activeConversationId":"session-a","sessionsWithOutput":2,"pendingPersistedEvents":4,"interactiveQueued":2,"backgroundQueued":1,"controlPlaneOpRunning":1}',
  ]);

  monitorState.p95Ns = 0;
  monitorState.maxNs = 0;
  nowMs = 2000;
  sampler.sampleNow();
  assert.equal(statusChangeCalls, 2);
  assert.deepEqual(sampler.currentStatusRow(), {
    fps: 0,
    kbPerSecond: 0,
    renderAvgMs: 0,
    renderMaxMs: 0,
    outputHandleAvgMs: 0,
    outputHandleMaxMs: 0,
    eventLoopP95Ms: 0,
  });
  assert.equal(events.length, 1);
});

void test('output load sampler start/stop is idempotent and manages monitor lifecycle', () => {
  let timerCallback: (() => void) | null = null;
  const monitorState: FakeMonitor = {
    enableCalls: 0,
    disableCalls: 0,
    resetCalls: 0,
    p95Ns: 0,
    maxNs: 0,
  };
  const setIntervalCalls: number[] = [];
  const clearIntervalCalls: number[] = [];
  const sampler = new OutputLoadSampler({
    recordPerfEvent: () => {},
    getControlPlaneQueueMetrics: () => ({
      interactiveQueued: 0,
      backgroundQueued: 0,
      running: false,
    }),
    getActiveConversationId: () => null,
    getPendingPersistedEvents: () => 0,
    onStatusRowChanged: () => {},
    createEventLoopDelayMonitor: () => createMonitor(monitorState),
    setIntervalFn: (callback, delayMs) => {
      timerCallback = callback;
      setIntervalCalls.push(delayMs);
      return 7 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => {
      clearIntervalCalls.push(1);
    },
  });

  sampler.start();
  sampler.start();
  if (timerCallback === null) {
    throw new Error('expected timer callback');
  }
  (timerCallback as () => void)();
  sampler.stop();
  sampler.stop();

  assert.deepEqual(setIntervalCalls, [1000]);
  assert.deepEqual(clearIntervalCalls, [1]);
  assert.equal(monitorState.enableCalls, 1);
  assert.equal(monitorState.disableCalls, 1);
});

void test('output load sampler falls back to default event-loop monitor factory', () => {
  const sampler = new OutputLoadSampler({
    recordPerfEvent: () => {},
    getControlPlaneQueueMetrics: () => ({
      interactiveQueued: 0,
      backgroundQueued: 0,
      running: false,
    }),
    getActiveConversationId: () => null,
    getPendingPersistedEvents: () => 0,
    onStatusRowChanged: () => {},
    setIntervalFn: () => 11 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
  });

  sampler.start();
  sampler.stop();
});
