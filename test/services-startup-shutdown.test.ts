import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  finalizeStartupShutdown,
  type StartupShutdownServiceOptions,
} from '../src/services/startup-shutdown.ts';

void test('startup shutdown service finalizes startup spans and settled gate', () => {
  const calls: string[] = [];
  const options: StartupShutdownServiceOptions = {
    startupSequencer: {
      snapshot: () => ({
        firstOutputObserved: true,
        firstPaintObserved: false,
        settledObserved: true,
        settleGate: 'header',
      }),
    },
    startupSpanTracker: {
      endStartCommandSpan: (attrs) => calls.push(`start:${JSON.stringify(attrs)}`),
      endFirstOutputSpan: (attrs) => calls.push(`output:${JSON.stringify(attrs)}`),
      endFirstPaintSpan: (attrs) => calls.push(`paint:${JSON.stringify(attrs)}`),
      endSettledSpan: (attrs) => calls.push(`settled:${JSON.stringify(attrs)}`),
    },
    startupSettledGate: {
      clearTimer: () => calls.push('clear'),
      signalSettled: () => calls.push('signal'),
    },
  };

  finalizeStartupShutdown(options);

  assert.deepEqual(calls, [
    'start:{"observed":false}',
    'output:{"observed":true}',
    'paint:{"observed":false}',
    'clear',
    'settled:{"observed":true,"gate":"header"}',
    'signal',
  ]);
});

void test('startup shutdown service falls back to none gate when startup snapshot has no gate', () => {
  const settledCalls: string[] = [];
  const options: StartupShutdownServiceOptions = {
    startupSequencer: {
      snapshot: () => ({
        firstOutputObserved: false,
        firstPaintObserved: false,
        settledObserved: false,
        settleGate: null,
      }),
    },
    startupSpanTracker: {
      endStartCommandSpan: () => {},
      endFirstOutputSpan: () => {},
      endFirstPaintSpan: () => {},
      endSettledSpan: (attrs) => settledCalls.push(JSON.stringify(attrs)),
    },
    startupSettledGate: {
      clearTimer: () => {},
      signalSettled: () => {},
    },
  };

  finalizeStartupShutdown(options);

  assert.deepEqual(settledCalls, ['{"observed":false,"gate":"none"}']);
});
