import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ConversationLifecycle } from '../src/services/conversation-lifecycle.ts';

interface TestConversation {
  sessionId: string;
  directoryId: string | null;
  agentType: string;
  adapterState: Record<string, unknown>;
  live: boolean;
  lastOutputCursor: number;
  launchCommand: string | null;
}

interface TestSessionSummary {
  sessionId: string;
  live: boolean;
}

void test('conversation lifecycle composes subscriptions starter hydration and background queue', async () => {
  const calls: string[] = [];
  const queuedTasks: Array<() => Promise<void>> = [];
  const conversations = new Map<string, TestConversation>();
  const primaryConversation: TestConversation = {
    sessionId: 'session-1',
    directoryId: null,
    agentType: 'codex',
    adapterState: {},
    live: false,
    lastOutputCursor: 0,
    launchCommand: null,
  };
  conversations.set(primaryConversation.sessionId, primaryConversation);
  conversations.set('session-2', {
    sessionId: 'session-2',
    directoryId: null,
    agentType: 'codex',
    adapterState: {},
    live: false,
    lastOutputCursor: 0,
    launchCommand: null,
  });

  const lifecycle = new ConversationLifecycle<TestConversation, TestSessionSummary>({
    streamSubscriptions: {
      subscribePtyEvents: async (sessionId) => {
        calls.push(`subscribe-pty:${sessionId}`);
      },
      unsubscribePtyEvents: async (sessionId) => {
        calls.push(`unsubscribe-pty:${sessionId}`);
      },
      isSessionNotFoundError: () => false,
      isSessionNotLiveError: () => false,
      subscribeObservedStream: async (afterCursor) => {
        calls.push(`subscribe-observed:${afterCursor}`);
        return 'observed-subscription';
      },
      unsubscribeObservedStream: async (subscriptionId) => {
        calls.push(`unsubscribe-observed:${subscriptionId}`);
      },
    },
    starter: {
      runWithStartInFlight: async (_sessionId, run) => await run(),
      conversationById: (sessionId) => conversations.get(sessionId),
      ensureConversation: (sessionId) => {
        const existing = conversations.get(sessionId);
        if (existing !== undefined) {
          return existing;
        }
        const next: TestConversation = {
          sessionId,
          directoryId: null,
          agentType: 'codex',
          adapterState: {},
          live: false,
          lastOutputCursor: 0,
          launchCommand: null,
        };
        conversations.set(sessionId, next);
        return next;
      },
      normalizeThreadAgentType: (agentType) => agentType,
      codexArgs: [],
      critiqueDefaultArgs: [],
      sessionCwdForConversation: () => '/tmp',
      buildLaunchArgs: () => ['resume'],
      launchCommandForAgent: () => 'codex',
      formatCommandForDebugBar: (command, args) => [command, ...args].join(' '),
      startConversationSpan: () => ({
        end: () => {},
      }),
      firstPaintTargetSessionId: () => null,
      endStartCommandSpan: () => {},
      layout: () => ({
        rightCols: 120,
        paneRows: 40,
      }),
      startPtySession: async (input) => {
        calls.push(`start-pty:${input.sessionId}`);
        const conversation = conversations.get(input.sessionId);
        if (conversation !== undefined) {
          conversation.live = true;
        }
      },
      setPtySize: (_sessionId, _size) => {},
      sendResize: (_sessionId, _cols, _rows) => {},
      sessionEnv: {},
      worktreeId: undefined,
      terminalForegroundHex: undefined,
      terminalBackgroundHex: undefined,
      recordStartCommand: (_sessionId, _launchArgs) => {},
      getSessionStatus: async () => null,
      upsertFromSessionSummary: (_summary) => {},
    },
    startupHydration: {
      startHydrationSpan: () => ({
        end: (payload) => {
          calls.push(`hydrate-span:${String(payload?.persisted)}:${String(payload?.live)}`);
        },
      }),
      hydrateDirectoryList: async () => {
        calls.push('hydrate-directories');
      },
      directoryIds: () => ['directory-1'],
      hydratePersistedConversationsForDirectory: async (_directoryId) => {
        calls.push('hydrate-persisted-directory');
        return 1;
      },
      listSessions: async () => {
        calls.push('hydrate-list-sessions');
        return [{ sessionId: 'session-1', live: true }];
      },
      upsertFromSessionSummary: (_summary) => {
        calls.push('hydrate-upsert-summary');
      },
    },
    startupQueue: {
      orderedConversationIds: () => ['session-1', 'session-2'],
      conversationById: (sessionId) => conversations.get(sessionId),
      queueBackgroundOp: (task, label) => {
        calls.push(`queue-background:${label}`);
        queuedTasks.push(task);
      },
      markDirty: () => {
        calls.push('queue-mark-dirty');
      },
    },
  });

  await lifecycle.subscribeConversationEvents('session-1');
  await lifecycle.unsubscribeConversationEvents('session-1');
  await lifecycle.subscribeTaskPlanningEvents(42);
  await lifecycle.subscribeTaskPlanningEvents(50);
  await lifecycle.unsubscribeTaskPlanningEvents();
  await lifecycle.unsubscribeTaskPlanningEvents();

  await lifecycle.startConversation('session-1');
  await lifecycle.hydrateConversationList();
  const queued = lifecycle.queuePersistedConversationsInBackground('session-1');
  assert.equal(queued, 1);
  assert.equal(queuedTasks.length, 1);
  const queuedTask = queuedTasks[0];
  assert.ok(queuedTask);
  await queuedTask();

  assert.equal(conversations.get('session-1')?.live, true);
  assert.equal(conversations.get('session-2')?.live, true);
  assert.deepEqual(calls, [
    'subscribe-pty:session-1',
    'unsubscribe-pty:session-1',
    'subscribe-observed:42',
    'unsubscribe-observed:observed-subscription',
    'start-pty:session-1',
    'subscribe-pty:session-1',
    'hydrate-directories',
    'hydrate-persisted-directory',
    'hydrate-list-sessions',
    'hydrate-upsert-summary',
    'subscribe-pty:session-1',
    'hydrate-span:1:1',
    'queue-background:background-start:session-2',
    'start-pty:session-2',
    'subscribe-pty:session-2',
    'queue-mark-dirty',
  ]);
});
