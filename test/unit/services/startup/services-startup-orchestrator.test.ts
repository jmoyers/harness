import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupOrchestrator } from '../../../../src/services/startup-orchestrator.ts';
import type { ConversationState } from '../../../../src/mux/live-mux/conversation-state.ts';

void test('startup orchestrator handles disabled background services and null initial activation', async () => {
  const perfEvents: string[] = [];
  const startupSpanEnds: Array<Record<string, boolean | number | string> | undefined> = [];
  const hydratedCursors: Array<number | null> = [];

  const startupOrchestrator = new StartupOrchestrator({
    startupSettleQuietMs: 5,
    startupSettleNonemptyFallbackMs: 10,
    backgroundWaitMaxMs: 1,
    backgroundProbeEnabled: false,
    backgroundResumeEnabled: false,
    startPerfSpan: () => ({
      end: () => {},
    }),
    startupSpan: {
      end: (attrs) => {
        startupSpanEnds.push(attrs);
      },
    },
    recordPerfEvent: (name, attrs) => {
      perfEvents.push(`${name}:${JSON.stringify(attrs)}`);
    },
    getConversation: () => undefined,
    isShuttingDown: () => false,
    refreshProcessUsage: () => {},
    queuePersistedConversationsInBackground: () => 0,
    hydrateStartupState: async (afterCursor) => {
      hydratedCursors.push(afterCursor);
    },
    activateConversation: async () => {},
    conversationCount: () => 2,
  });

  startupOrchestrator.startBackgroundProbe();
  await startupOrchestrator.hydrateStartupState(7);
  await startupOrchestrator.activateInitialConversation(null);
  startupOrchestrator.finalizeStartup(null);
  startupOrchestrator.stop();
  startupOrchestrator.finalize();

  assert.deepEqual(hydratedCursors, [7]);
  assert.deepEqual(startupSpanEnds, [{ conversations: 2 }]);
  assert.deepEqual(perfEvents, [
    'mux.startup.background-probes.wait:{"maxWaitMs":1,"enabled":0}',
    'mux.startup.background-probes.skipped:{"reason":"disabled"}',
    'mux.startup.ready:{"conversations":2}',
    'mux.startup.background-start.wait:{"sessionId":"none","maxWaitMs":1,"enabled":0}',
    'mux.startup.background-start.skipped:{"sessionId":"none","reason":"disabled"}',
  ]);
});

void test('startup orchestrator activates initial session and forwards startup tracking signals', async () => {
  const perfEvents: string[] = [];
  const startedSpans: string[] = [];
  const endedSpans: string[] = [];
  const activatedSessions: string[] = [];

  const startupOrchestrator = new StartupOrchestrator({
    startupSettleQuietMs: 5,
    startupSettleNonemptyFallbackMs: 10,
    backgroundWaitMaxMs: 1,
    backgroundProbeEnabled: false,
    backgroundResumeEnabled: false,
    startPerfSpan: (name) => {
      startedSpans.push(name);
      return {
        end: () => {
          endedSpans.push(name);
        },
      };
    },
    startupSpan: {
      end: () => {},
    },
    recordPerfEvent: (name, attrs) => {
      perfEvents.push(`${name}:${JSON.stringify(attrs)}`);
    },
    getConversation: () => undefined,
    isShuttingDown: () => false,
    refreshProcessUsage: () => {},
    queuePersistedConversationsInBackground: () => 0,
    hydrateStartupState: async () => {},
    activateConversation: async (sessionId) => {
      activatedSessions.push(sessionId);
    },
    conversationCount: () => 1,
  });

  await startupOrchestrator.activateInitialConversation('session-1');
  startupOrchestrator.endStartCommandSpan({
    observed: true,
  });
  startupOrchestrator.onOutputChunk('session-1', 8);
  startupOrchestrator.onPaintOutputChunk('session-1');
  startupOrchestrator.onRenderFlush({
    activeConversation: null,
    activeConversationId: 'session-1',
    rightFrameVisible: false,
    changedRowCount: 4,
  });
  startupOrchestrator.finalizeStartup('session-1');
  startupOrchestrator.finalize();

  assert.deepEqual(activatedSessions, ['session-1']);
  assert.equal(startupOrchestrator.firstPaintTargetSessionId, 'session-1');
  assert.equal(startedSpans.includes('mux.startup.activate-initial'), true);
  assert.equal(endedSpans.includes('mux.startup.activate-initial'), true);
  assert.equal(
    perfEvents.includes('mux.session.first-output:{"sessionId":"session-1","bytes":8}'),
    true,
  );
  assert.equal(
    perfEvents.includes('mux.startup.active-first-output:{"sessionId":"session-1","bytes":8}'),
    true,
  );
});

void test('startup orchestrator executes enabled background wait paths and paint visibility flow', async () => {
  const perfEvents: string[] = [];
  const queuedSessions: Array<string | null> = [];
  const activeConversation = {
    oracle: {
      snapshotWithoutHash: () => ({
        richLines: [
          {
            cells: [
              { glyph: 'OpenAI Codex', continued: false },
              { glyph: ' model: gpt-5', continued: false },
              { glyph: ' directory: /tmp', continued: false },
            ],
          },
        ],
      }),
    },
  };

  const startupOrchestrator = new StartupOrchestrator({
    startupSettleQuietMs: 0,
    startupSettleNonemptyFallbackMs: 0,
    backgroundWaitMaxMs: 1,
    backgroundProbeEnabled: true,
    backgroundResumeEnabled: true,
    startPerfSpan: () => ({
      end: () => {},
    }),
    startupSpan: {
      end: () => {},
    },
    recordPerfEvent: (name, attrs) => {
      perfEvents.push(`${name}:${JSON.stringify(attrs)}`);
    },
    getConversation: () => activeConversation as unknown as ConversationState,
    isShuttingDown: () => false,
    refreshProcessUsage: () => {},
    queuePersistedConversationsInBackground: (initialActiveId) => {
      queuedSessions.push(initialActiveId);
      return 1;
    },
    hydrateStartupState: async () => {},
    activateConversation: async () => {},
    conversationCount: () => 1,
  });

  startupOrchestrator.startBackgroundProbe();
  await startupOrchestrator.activateInitialConversation('session-a');
  startupOrchestrator.onOutputChunk('session-a', 3);
  startupOrchestrator.onRenderFlush({
    activeConversation: activeConversation as unknown as ConversationState,
    activeConversationId: 'session-a',
    rightFrameVisible: true,
    changedRowCount: 1,
  });
  startupOrchestrator.finalizeStartup('session-a');
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 15);
  });
  startupOrchestrator.stop();
  startupOrchestrator.finalize();

  assert.equal(
    perfEvents.some((event) => event.startsWith('mux.startup.background-probes.begin:')),
    true,
  );
  assert.equal(
    perfEvents.some((event) => event.startsWith('mux.startup.background-start.begin:')),
    true,
  );
  assert.equal(
    perfEvents.some((event) => event.startsWith('mux.startup.active-first-visible-paint:')),
    true,
  );
  assert.deepEqual(queuedSessions, ['session-a']);
});
