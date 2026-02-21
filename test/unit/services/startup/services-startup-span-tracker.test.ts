import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupSpanTracker } from '../../../../src/services/startup-span-tracker.ts';

void test('startup span tracker begins session spans and exposes target session id', () => {
  const calls: string[] = [];
  const tracker = new StartupSpanTracker((name, attrs) => {
    calls.push(`start:${name}:${JSON.stringify(attrs)}`);
    return {
      end: () => {},
    };
  }, 300);

  tracker.beginForSession('session-a');

  assert.equal(tracker.firstPaintTargetSessionId, 'session-a');
  assert.deepEqual(calls, [
    'start:mux.startup.active-start-command:{"sessionId":"session-a"}',
    'start:mux.startup.active-first-output:{"sessionId":"session-a"}',
    'start:mux.startup.active-first-visible-paint:{"sessionId":"session-a"}',
    'start:mux.startup.active-settled:{"sessionId":"session-a","quietMs":300}',
  ]);
});

void test('startup span tracker ends each span at most once', () => {
  const calls: string[] = [];
  const tracker = new StartupSpanTracker((name) => {
    return {
      end: (attrs) => {
        calls.push(`end:${name}:${JSON.stringify(attrs)}`);
      },
    };
  }, 100);

  tracker.beginForSession('session-a');
  tracker.endStartCommandSpan({ observed: true });
  tracker.endFirstOutputSpan({ observed: true });
  tracker.endFirstPaintSpan({ observed: true });
  tracker.endSettledSpan({ observed: true, gate: 'header' });

  tracker.endStartCommandSpan({ observed: false });
  tracker.endFirstOutputSpan({ observed: false });
  tracker.endFirstPaintSpan({ observed: false });
  tracker.endSettledSpan({ observed: false, gate: 'none' });

  assert.deepEqual(calls, [
    'end:mux.startup.active-start-command:{"observed":true}',
    'end:mux.startup.active-first-output:{"observed":true}',
    'end:mux.startup.active-first-visible-paint:{"observed":true}',
    'end:mux.startup.active-settled:{"observed":true,"gate":"header"}',
  ]);
});

void test('startup span tracker clearTargetSession clears first-paint target id', () => {
  const tracker = new StartupSpanTracker(
    () => ({
      end: () => {},
    }),
    100,
  );

  tracker.beginForSession('session-a');
  tracker.clearTargetSession();
  assert.equal(tracker.firstPaintTargetSessionId, null);
});
