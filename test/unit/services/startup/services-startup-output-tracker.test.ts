import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupOutputTracker } from '../../../../src/services/startup-output-tracker.ts';

void test('startup output tracker records per-session first output once', () => {
  const events: string[] = [];
  const startupOutputTracker = new StartupOutputTracker({
    startupSequencer: {
      snapshot: () => ({ firstOutputObserved: true }),
      markFirstOutput: () => false,
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: null,
      endFirstOutputSpan: () => {},
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  startupOutputTracker.onOutputChunk('session-a', 10);
  startupOutputTracker.onOutputChunk('session-a', 20);
  startupOutputTracker.onOutputChunk('session-b', 30);

  assert.deepEqual(events, [
    'mux.session.first-output:{"sessionId":"session-a","bytes":10}',
    'mux.session.first-output:{"sessionId":"session-b","bytes":30}',
  ]);
});

void test('startup output tracker records startup first-output once for target session', () => {
  const events: string[] = [];
  const spanEnds: string[] = [];
  let firstOutputObserved = false;
  const startupOutputTracker = new StartupOutputTracker({
    startupSequencer: {
      snapshot: () => ({ firstOutputObserved }),
      markFirstOutput: (sessionId) => {
        if (sessionId !== 'session-a') {
          return false;
        }
        firstOutputObserved = true;
        return true;
      },
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endFirstOutputSpan: (attrs) => spanEnds.push(JSON.stringify(attrs)),
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  startupOutputTracker.onOutputChunk('session-a', 42);
  startupOutputTracker.onOutputChunk('session-a', 84);
  startupOutputTracker.onOutputChunk('session-b', 11);

  assert.deepEqual(events, [
    'mux.session.first-output:{"sessionId":"session-a","bytes":42}',
    'mux.startup.active-first-output:{"sessionId":"session-a","bytes":42}',
    'mux.session.first-output:{"sessionId":"session-b","bytes":11}',
  ]);
  assert.deepEqual(spanEnds, ['{"observed":true,"bytes":42}']);
});

void test('startup output tracker ignores startup output when markFirstOutput returns false', () => {
  const events: string[] = [];
  const spanEnds: string[] = [];
  const startupOutputTracker = new StartupOutputTracker({
    startupSequencer: {
      snapshot: () => ({ firstOutputObserved: false }),
      markFirstOutput: () => false,
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endFirstOutputSpan: (attrs) => spanEnds.push(JSON.stringify(attrs)),
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  startupOutputTracker.onOutputChunk('session-a', 12);

  assert.deepEqual(events, ['mux.session.first-output:{"sessionId":"session-a","bytes":12}']);
  assert.deepEqual(spanEnds, []);
});
