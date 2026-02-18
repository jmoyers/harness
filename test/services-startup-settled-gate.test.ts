import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupSettledGate } from '../src/services/startup-settled-gate.ts';
import type { ConversationState } from '../src/mux/live-mux/conversation-state.ts';

function createConversation(): ConversationState {
  return {} as ConversationState;
}

void test('startup settled gate forwards clear and signal calls to sequencer', () => {
  const calls: string[] = [];
  const startupSettledGate = new StartupSettledGate({
    startupSequencer: {
      clearSettledTimer: () => calls.push('clear'),
      signalSettled: () => calls.push('signal'),
      scheduleSettledProbe: () => {},
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endSettledSpan: () => {},
    },
    getConversation: () => undefined,
    visibleGlyphCellCount: () => 0,
    recordPerfEvent: () => {},
  });

  startupSettledGate.clearTimer();
  startupSettledGate.signalSettled();
  assert.deepEqual(calls, ['clear', 'signal']);
});

void test('startup settled gate ignores scheduled events for non-target sessions', () => {
  const scheduled: Array<(event: { readonly sessionId: string; readonly gate: string; readonly quietMs: number }) => void> = [];
  const perfCalls: string[] = [];
  const spanCalls: string[] = [];
  const startupSettledGate = new StartupSettledGate({
    startupSequencer: {
      clearSettledTimer: () => {},
      signalSettled: () => {},
      scheduleSettledProbe: (_sessionId, onSettled) => {
        scheduled.push(onSettled);
      },
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endSettledSpan: (attrs) => spanCalls.push(JSON.stringify(attrs)),
    },
    getConversation: () => undefined,
    visibleGlyphCellCount: () => 0,
    recordPerfEvent: (_name, attrs) => perfCalls.push(JSON.stringify(attrs)),
  });

  startupSettledGate.scheduleProbe('session-a');
  const scheduledCallback = scheduled.at(-1);
  if (scheduledCallback === undefined) {
    throw new Error('scheduled callback not set');
  }
  scheduledCallback({
    sessionId: 'session-b',
    gate: 'header',
    quietMs: 300,
  });

  assert.deepEqual(perfCalls, []);
  assert.deepEqual(spanCalls, []);
});

void test('startup settled gate records settled events with glyph fallback and visible glyph count', () => {
  const scheduled: Array<(event: { readonly sessionId: string; readonly gate: string; readonly quietMs: number }) => void> = [];
  const perfCalls: string[] = [];
  const spanCalls: string[] = [];
  const signalCalls: string[] = [];
  const conversation = createConversation();
  let includeConversation = true;
  const startupSettledGate = new StartupSettledGate({
    startupSequencer: {
      clearSettledTimer: () => {},
      signalSettled: () => signalCalls.push('signal'),
      scheduleSettledProbe: (_sessionId, onSettled) => {
        scheduled.push(onSettled);
      },
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endSettledSpan: (attrs) => spanCalls.push(JSON.stringify(attrs)),
    },
    getConversation: (sessionId) =>
      includeConversation && sessionId === 'session-a' ? conversation : undefined,
    visibleGlyphCellCount: () => 7,
    recordPerfEvent: (_name, attrs) => perfCalls.push(JSON.stringify(attrs)),
  });

  startupSettledGate.scheduleProbe('session-a');
  const firstScheduled = scheduled.at(-1);
  if (firstScheduled === undefined) {
    throw new Error('scheduled callback not set');
  }
  firstScheduled({
    sessionId: 'session-a',
    gate: 'header',
    quietMs: 300,
  });
  includeConversation = false;
  startupSettledGate.scheduleProbe('session-b');
  const secondScheduled = scheduled.at(-1);
  if (secondScheduled === undefined) {
    throw new Error('scheduled callback not set');
  }
  secondScheduled({
    sessionId: 'session-a',
    gate: 'nonempty',
    quietMs: 400,
  });

  assert.deepEqual(perfCalls, [
    '{"sessionId":"session-a","gate":"header","quietMs":300,"glyphCells":7}',
    '{"sessionId":"session-a","gate":"nonempty","quietMs":400,"glyphCells":0}',
  ]);
  assert.deepEqual(spanCalls, [
    '{"observed":true,"gate":"header","quietMs":300,"glyphCells":7}',
    '{"observed":true,"gate":"nonempty","quietMs":400,"glyphCells":0}',
  ]);
  assert.deepEqual(signalCalls, ['signal', 'signal']);
});
