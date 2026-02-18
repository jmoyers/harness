import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupPaintTracker } from '../src/services/startup-paint-tracker.ts';
import type { ConversationState } from '../src/mux/live-mux/conversation-state.ts';

function createConversation(): ConversationState {
  return {} as ConversationState;
}

void test('startup paint tracker records paint/header/gate events for active target render flush', () => {
  const events: string[] = [];
  const spanEnds: string[] = [];
  const scheduled: string[] = [];
  const conversation = createConversation();
  const startupPaintTracker = new StartupPaintTracker({
    startupSequencer: {
      snapshot: () => ({
        firstOutputObserved: true,
        firstPaintObserved: false,
      }),
      markFirstPaintVisible: (sessionId) => sessionId === 'session-a',
      markHeaderVisible: (sessionId, visible) => sessionId === 'session-a' && visible,
      maybeSelectSettleGate: (sessionId) => (sessionId === 'session-a' ? 'header' : null),
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endFirstPaintSpan: (attrs) => spanEnds.push(JSON.stringify(attrs)),
    },
    startupVisibility: {
      visibleGlyphCellCount: () => 9,
      codexHeaderVisible: () => true,
    },
    startupSettledGate: {
      scheduleProbe: (sessionId) => scheduled.push(sessionId),
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  startupPaintTracker.onRenderFlush({
    activeConversation: conversation,
    activeConversationId: 'session-a',
    rightFrameVisible: true,
    changedRowCount: 3,
  });

  assert.deepEqual(events, [
    'mux.startup.active-first-visible-paint:{"sessionId":"session-a","changedRows":3,"glyphCells":9}',
    'mux.startup.active-header-visible:{"sessionId":"session-a","glyphCells":9}',
    'mux.startup.active-settle-gate:{"sessionId":"session-a","gate":"header","glyphCells":9}',
  ]);
  assert.deepEqual(spanEnds, ['{"observed":true,"changedRows":3,"glyphCells":9}']);
  assert.deepEqual(scheduled, ['session-a']);
});

void test('startup paint tracker ignores ineligible render flush states', () => {
  const events: string[] = [];
  const spanEnds: string[] = [];
  const scheduled: string[] = [];
  const startupPaintTracker = new StartupPaintTracker({
    startupSequencer: {
      snapshot: () => ({
        firstOutputObserved: false,
        firstPaintObserved: false,
      }),
      markFirstPaintVisible: () => {
        events.push('markFirstPaintVisible');
        return false;
      },
      markHeaderVisible: () => {
        events.push('markHeaderVisible');
        return false;
      },
      maybeSelectSettleGate: () => {
        events.push('maybeSelectSettleGate');
        return null;
      },
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endFirstPaintSpan: (attrs) => spanEnds.push(JSON.stringify(attrs)),
    },
    startupVisibility: {
      visibleGlyphCellCount: () => 0,
      codexHeaderVisible: () => false,
    },
    startupSettledGate: {
      scheduleProbe: (sessionId) => scheduled.push(sessionId),
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  startupPaintTracker.onRenderFlush({
    activeConversation: null,
    activeConversationId: null,
    rightFrameVisible: false,
    changedRowCount: 0,
  });
  startupPaintTracker.onRenderFlush({
    activeConversation: createConversation(),
    activeConversationId: 'session-b',
    rightFrameVisible: true,
    changedRowCount: 1,
  });
  startupPaintTracker.onRenderFlush({
    activeConversation: createConversation(),
    activeConversationId: 'session-a',
    rightFrameVisible: true,
    changedRowCount: 1,
  });

  assert.deepEqual(events, []);
  assert.deepEqual(spanEnds, []);
  assert.deepEqual(scheduled, []);
});

void test('startup paint tracker schedules output probes only for target session', () => {
  const scheduled: string[] = [];
  const startupPaintTracker = new StartupPaintTracker({
    startupSequencer: {
      snapshot: () => ({
        firstOutputObserved: true,
        firstPaintObserved: true,
      }),
      markFirstPaintVisible: () => false,
      markHeaderVisible: () => false,
      maybeSelectSettleGate: () => null,
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endFirstPaintSpan: () => {},
    },
    startupVisibility: {
      visibleGlyphCellCount: () => 0,
      codexHeaderVisible: () => false,
    },
    startupSettledGate: {
      scheduleProbe: (sessionId) => scheduled.push(sessionId),
    },
    recordPerfEvent: () => {},
  });

  startupPaintTracker.onOutputChunk('session-b');
  startupPaintTracker.onOutputChunk('session-a');

  assert.deepEqual(scheduled, ['session-a']);
});

void test('startup paint tracker records header and gate even when first paint was already observed', () => {
  const events: string[] = [];
  const startupPaintTracker = new StartupPaintTracker({
    startupSequencer: {
      snapshot: () => ({
        firstOutputObserved: true,
        firstPaintObserved: true,
      }),
      markFirstPaintVisible: () => {
        throw new Error('markFirstPaintVisible should not be called');
      },
      markHeaderVisible: () => true,
      maybeSelectSettleGate: () => null,
    },
    startupSpanTracker: {
      firstPaintTargetSessionId: 'session-a',
      endFirstPaintSpan: () => {
        throw new Error('endFirstPaintSpan should not be called');
      },
    },
    startupVisibility: {
      visibleGlyphCellCount: () => 2,
      codexHeaderVisible: () => true,
    },
    startupSettledGate: {
      scheduleProbe: () => {},
    },
    recordPerfEvent: (name, attrs) => events.push(`${name}:${JSON.stringify(attrs)}`),
  });

  startupPaintTracker.onRenderFlush({
    activeConversation: createConversation(),
    activeConversationId: 'session-a',
    rightFrameVisible: true,
    changedRowCount: 1,
  });

  assert.deepEqual(events, [
    'mux.startup.active-header-visible:{"sessionId":"session-a","glyphCells":2}',
  ]);
});
