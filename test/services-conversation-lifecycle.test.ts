import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ConversationLifecycle } from '../src/services/conversation-lifecycle.ts';

interface TestConversation {
  sessionId: string;
  directoryId: string | null;
  agentType: string;
  adapterState: Record<string, unknown>;
  live: boolean;
  status: string;
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
    status: 'running',
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
    status: 'running',
    lastOutputCursor: 0,
    launchCommand: null,
  });

  const lifecycle = new ConversationLifecycle<
    TestConversation,
    TestSessionSummary,
    { controllerId: string }
  >({
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
          status: 'running',
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
    activation: {
      getActiveConversationId: () => null,
      setActiveConversationId: () => {},
      isConversationPaneMode: () => true,
      enterConversationPaneForActiveSession: () => {},
      enterConversationPaneForSessionSwitch: () => {},
      stopConversationTitleEditForOtherSession: () => {},
      clearSelectionState: () => {},
      detachConversation: async () => {},
      conversationById: (sessionId) => conversations.get(sessionId),
      noteGitActivity: () => {},
      attachConversation: async () => {},
      isSessionNotFoundError: () => false,
      isSessionNotLiveError: () => false,
      markSessionUnavailable: () => {},
      schedulePtyResizeImmediate: () => {},
      markDirty: () => {},
    },
    actions: {
      controlPlaneService: {
        createConversation: async () => {},
        claimSession: async () => null,
      },
      createConversationId: () => 'conversation-unused',
      ensureConversation: () => {},
      noteGitActivity: () => {},
      orderedConversationIds: () => ['session-1', 'session-2'],
      conversationById: (sessionId) => {
        const conversation = conversations.get(sessionId);
        if (conversation === undefined) {
          return null;
        }
        return {
          directoryId: conversation.directoryId,
          agentType: conversation.agentType,
        };
      },
      conversationsHas: (sessionId) => conversations.has(sessionId),
      applyController: () => {},
      setLastEventNow: () => {},
      muxControllerId: 'mux-controller',
      muxControllerLabel: 'mux-controller',
      markDirty: () => {},
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

void test('conversation lifecycle delegates activation and conversation actions through subsystem surface', async () => {
  const calls: string[] = [];
  const conversations = new Map<string, TestConversation>([
    [
      'session-1',
      {
        sessionId: 'session-1',
        directoryId: 'directory-1',
        agentType: 'codex',
        adapterState: {},
        live: true,
        status: 'running',
        lastOutputCursor: 0,
        launchCommand: null,
      },
    ],
    [
      'session-cold',
      {
        sessionId: 'session-cold',
        directoryId: 'directory-cold',
        agentType: 'codex',
        adapterState: {},
        live: false,
        status: 'running',
        lastOutputCursor: 0,
        launchCommand: null,
      },
    ],
  ]);
  let activeSessionId: string | null = null;

  const lifecycle = new ConversationLifecycle<
    TestConversation,
    TestSessionSummary,
    { controllerId: string }
  >({
    streamSubscriptions: {
      subscribePtyEvents: async (sessionId) => {
        calls.push(`subscribe-pty:${sessionId}`);
      },
      unsubscribePtyEvents: async () => {},
      isSessionNotFoundError: () => false,
      isSessionNotLiveError: () => false,
      subscribeObservedStream: async () => 'subscription-id',
      unsubscribeObservedStream: async () => {},
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
          status: 'running',
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
      setPtySize: () => {},
      sendResize: () => {},
      sessionEnv: {},
      worktreeId: undefined,
      terminalForegroundHex: undefined,
      terminalBackgroundHex: undefined,
      recordStartCommand: () => {},
      getSessionStatus: async () => null,
      upsertFromSessionSummary: () => {},
    },
    startupHydration: {
      startHydrationSpan: () => ({
        end: () => {},
      }),
      hydrateDirectoryList: async () => {},
      directoryIds: () => [],
      hydratePersistedConversationsForDirectory: async () => 0,
      listSessions: async () => [],
      upsertFromSessionSummary: () => {},
    },
    startupQueue: {
      orderedConversationIds: () => [],
      conversationById: () => undefined,
      queueBackgroundOp: () => {},
      markDirty: () => {},
    },
    activation: {
      getActiveConversationId: () => activeSessionId,
      setActiveConversationId: (sessionId) => {
        activeSessionId = sessionId;
        calls.push(`set-active:${sessionId}`);
      },
      isConversationPaneMode: () => false,
      enterConversationPaneForActiveSession: (sessionId) => {
        calls.push(`enter-active-pane:${sessionId}`);
      },
      enterConversationPaneForSessionSwitch: (sessionId) => {
        calls.push(`enter-switch-pane:${sessionId}`);
      },
      stopConversationTitleEditForOtherSession: (sessionId) => {
        calls.push(`stop-title-edit-for-other:${sessionId}`);
      },
      clearSelectionState: () => {
        calls.push('clear-selection');
      },
      detachConversation: async (sessionId) => {
        calls.push(`detach:${sessionId}`);
      },
      conversationById: (sessionId) => conversations.get(sessionId),
      noteGitActivity: (directoryId) => {
        calls.push(`note-git:${directoryId}`);
      },
      attachConversation: async (sessionId) => {
        calls.push(`attach:${sessionId}`);
      },
      isSessionNotFoundError: () => false,
      isSessionNotLiveError: () => false,
      markSessionUnavailable: (sessionId) => {
        calls.push(`mark-unavailable:${sessionId}`);
      },
      schedulePtyResizeImmediate: () => {
        calls.push('schedule-resize');
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
    },
    actions: {
      controlPlaneService: {
        createConversation: async (input) => {
          calls.push(
            `create-conversation:${input.conversationId}:${input.directoryId}:${input.agentType}`,
          );
        },
        claimSession: async () => ({ controllerId: 'controller-1' }),
      },
      createConversationId: () => 'conversation-new',
      ensureConversation: (sessionId, seed) => {
        conversations.set(sessionId, {
          sessionId,
          directoryId: seed.directoryId,
          agentType: seed.agentType,
          adapterState: seed.adapterState,
          live: false,
          status: 'running',
          lastOutputCursor: 0,
          launchCommand: null,
        });
      },
      noteGitActivity: (directoryId) => {
        calls.push(`note-git:${directoryId}`);
      },
      orderedConversationIds: () => [...conversations.keys()],
      conversationById: (sessionId) => {
        const conversation = conversations.get(sessionId);
        if (conversation === undefined) {
          return null;
        }
        return {
          directoryId: conversation.directoryId,
          agentType: conversation.agentType,
        };
      },
      conversationsHas: (sessionId) => conversations.has(sessionId),
      applyController: (sessionId, controller) => {
        calls.push(`apply-controller:${sessionId}:${controller.controllerId}`);
      },
      setLastEventNow: (sessionId) => {
        calls.push(`set-last-event-now:${sessionId}`);
      },
      muxControllerId: 'mux-controller',
      muxControllerLabel: 'mux-controller',
      markDirty: () => {
        calls.push('mark-dirty');
      },
    },
  });

  await lifecycle.activateConversation('session-cold');
  await lifecycle.activateConversation('session-1');
  await lifecycle.createAndActivateConversationInDirectory('directory-2', 'critique');
  await lifecycle.openOrCreateCritiqueConversationInDirectory('directory-2');
  await lifecycle.takeoverConversation('session-1');

  assert.ok(calls.includes('set-active:session-1'));
  assert.ok(calls.includes('start-pty:session-cold'));
  assert.ok(calls.includes('create-conversation:conversation-new:directory-2:critique'));
  assert.ok(calls.includes('start-pty:conversation-new'));
  assert.ok(calls.includes('set-active:conversation-new'));
  assert.ok(calls.includes('apply-controller:session-1:controller-1'));
  assert.ok(calls.includes('set-last-event-now:session-1'));
});
