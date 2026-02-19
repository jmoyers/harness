import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeControlActions } from '../src/services/runtime-control-actions.ts';

interface TestConversationState {
  live: boolean;
  status: string;
  attentionReason: string | null;
  lastEventAt: string;
}

void test('runtime control actions interrupt is a no-op for missing conversation', async () => {
  let interruptedCalls = 0;
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => {
      interruptedCalls += 1;
      return { interrupted: true };
    },
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: null,
    setTaskPaneNotice: () => {},
    setDebugFooterNotice: () => {},
  });

  await actions.interruptConversation('session-1');

  assert.equal(interruptedCalls, 0);
  assert.equal(dirtyCalls, 0);
});

void test('runtime control actions interrupt updates live conversation when interrupt succeeds', async () => {
  let dirtyCalls = 0;
  const conversation: TestConversationState = {
    live: true,
    status: 'running',
    attentionReason: 'waiting',
    lastEventAt: 'old',
  };
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => conversation,
    interruptSession: async () => ({ interrupted: true }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: null,
    setTaskPaneNotice: () => {},
    setDebugFooterNotice: () => {},
  });

  await actions.interruptConversation('session-2');

  assert.equal(conversation.status, 'completed');
  assert.equal(conversation.attentionReason, null);
  assert.equal(conversation.lastEventAt, '2026-02-18T00:00:00.000Z');
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions interrupt keeps state unchanged when interrupt not applied', async () => {
  let dirtyCalls = 0;
  const conversation: TestConversationState = {
    live: true,
    status: 'running',
    attentionReason: 'waiting',
    lastEventAt: 'old',
  };
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => conversation,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: null,
    setTaskPaneNotice: () => {},
    setDebugFooterNotice: () => {},
  });

  await actions.interruptConversation('session-3');

  assert.equal(conversation.status, 'running');
  assert.equal(conversation.attentionReason, 'waiting');
  assert.equal(conversation.lastEventAt, 'old');
  assert.equal(dirtyCalls, 0);
});

void test('runtime control actions toggle gateway profiler writes success notice with session scope', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async (input) => {
      assert.equal(input.invocationDirectory, '/tmp/work');
      assert.equal(input.sessionName, 'mux-main');
      return { message: 'profile started' };
    },
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: 'mux-main',
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
  });

  await actions.toggleGatewayProfiler();

  assert.deepEqual(notices, [
    'task:[profile:mux-main] profile started',
    'debug:[profile:mux-main] profile started',
  ]);
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions toggle gateway profiler writes failure notice with default scope', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => {
      throw new Error('profile start failed');
    },
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: null,
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
  });

  await actions.toggleGatewayProfiler();

  assert.deepEqual(notices, [
    'task:[profile] profile start failed',
    'debug:[profile] profile start failed',
  ]);
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions toggle gateway status timeline writes success notice with session scope', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async (input) => {
      assert.equal(input.invocationDirectory, '/tmp/work');
      assert.equal(input.sessionName, 'mux-main');
      return { message: 'status timeline started' };
    },
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: 'mux-main',
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
  });

  await actions.toggleGatewayStatusTimeline();

  assert.deepEqual(notices, [
    'task:[status-trace:mux-main] status timeline started',
    'debug:[status-trace:mux-main] status timeline started',
  ]);
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions toggle gateway status timeline writes failure notice with default scope', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => {
      throw new Error('status timeline start failed');
    },
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: null,
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
  });

  await actions.toggleGatewayStatusTimeline();

  assert.deepEqual(notices, [
    'task:[status-trace] status timeline start failed',
    'debug:[status-trace] status timeline start failed',
  ]);
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions toggle gateway render trace writes scoped notice and forwards conversation id', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async (input) => {
      assert.equal(input.invocationDirectory, '/tmp/work');
      assert.equal(input.sessionName, 'mux-main');
      assert.equal(input.conversationId, 'session-123');
      return { message: 'render trace started' };
    },
    invocationDirectory: '/tmp/work',
    sessionName: 'mux-main',
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
  });

  await actions.toggleGatewayRenderTrace('session-123');

  assert.deepEqual(notices, [
    'task:[render-trace:mux-main] render trace started',
    'debug:[render-trace:mux-main] render trace started',
  ]);
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions refreshAllConversationTitles reports unavailable when callbacks are missing', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: null,
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
  });

  await actions.refreshAllConversationTitles();

  assert.deepEqual(notices, [
    'task:[thread-title] refresh unavailable',
    'debug:[thread-title] refresh unavailable',
  ]);
  assert.equal(dirtyCalls, 1);
});

void test('runtime control actions refreshAllConversationTitles tracks progress and filters non-agent threads', async () => {
  const notices: string[] = [];
  let dirtyCalls = 0;
  const refreshedSessionIds: string[] = [];
  const actions = new RuntimeControlActions<TestConversationState>({
    conversationById: () => undefined,
    interruptSession: async () => ({ interrupted: false }),
    nowIso: () => '2026-02-18T00:00:00.000Z',
    markDirty: () => {
      dirtyCalls += 1;
    },
    toggleGatewayProfiler: async () => ({ message: 'ignored' }),
    toggleGatewayStatusTimeline: async () => ({ message: 'ignored' }),
    toggleGatewayRenderTrace: async () => ({ message: 'ignored' }),
    invocationDirectory: '/tmp/work',
    sessionName: 'mux-main',
    setTaskPaneNotice: (message) => {
      notices.push(`task:${message}`);
    },
    setDebugFooterNotice: (message) => {
      notices.push(`debug:${message}`);
    },
    listConversationIdsForTitleRefresh: () => ['agent-a', 'terminal-a', 'agent-b'],
    conversationAgentTypeForTitleRefresh: (sessionId) => {
      if (sessionId === 'terminal-a') {
        return 'terminal';
      }
      return 'codex';
    },
    refreshConversationTitle: async (sessionId) => {
      refreshedSessionIds.push(sessionId);
      return {
        status: sessionId === 'agent-a' ? 'updated' : 'unchanged',
        reason: null,
      };
    },
  });

  await actions.refreshAllConversationTitles();

  assert.deepEqual(refreshedSessionIds, ['agent-a', 'agent-b']);
  assert.deepEqual(notices, [
    'task:[thread-title:mux-main] refreshing names 0/2',
    'debug:[thread-title:mux-main] refreshing names 0/2',
    'task:[thread-title:mux-main] refreshing names 1/2',
    'debug:[thread-title:mux-main] refreshing names 1/2',
    'task:[thread-title:mux-main] refreshing names 2/2',
    'debug:[thread-title:mux-main] refreshing names 2/2',
    'task:[thread-title:mux-main] refreshed 1 updated 1 unchanged 0 skipped',
    'debug:[thread-title:mux-main] refreshed 1 updated 1 unchanged 0 skipped',
  ]);
  assert.equal(dirtyCalls, 4);
});
