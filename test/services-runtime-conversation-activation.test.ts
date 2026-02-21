import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeConversationActivation } from '../src/services/runtime-conversation-activation.ts';

interface ConversationRecord {
  readonly directoryId: string | null;
  readonly live: boolean;
  readonly status: string;
}

void test('runtime conversation activation keeps active conversation when already in conversation pane', async () => {
  const calls: string[] = [];
  const activation = new RuntimeConversationActivation({
    getActiveConversationId: () => 'session-1',
    setActiveConversationId: () => {
      calls.push('setActiveConversationId');
    },
    isConversationPaneMode: () => true,
    enterConversationPaneForActiveSession: () => {
      calls.push('enterActivePane');
    },
    enterConversationPaneForSessionSwitch: () => {
      calls.push('enterSwitchPane');
    },
    stopConversationTitleEditForOtherSession: () => {
      calls.push('stopTitleEdit');
    },
    clearSelectionState: () => {
      calls.push('clearSelection');
    },
    detachConversation: async () => {
      calls.push('detachConversation');
    },
    conversationById: () => undefined,
    noteGitActivity: () => {
      calls.push('noteGit');
    },
    startConversation: async () => {
      calls.push('startConversation');
    },
    attachConversation: async () => {
      calls.push('attachConversation');
    },
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    markSessionUnavailable: () => {
      calls.push('markUnavailable');
    },
    schedulePtyResizeImmediate: () => {
      calls.push('resize');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  await activation.activateConversation('session-1');
  assert.deepEqual(calls, []);
});

void test('runtime conversation activation restores conversation pane for already-active session', async () => {
  const calls: string[] = [];
  const activation = new RuntimeConversationActivation({
    getActiveConversationId: () => 'session-1',
    setActiveConversationId: () => {},
    isConversationPaneMode: () => false,
    enterConversationPaneForActiveSession: (sessionId) => {
      calls.push(`enterActive:${sessionId}`);
    },
    enterConversationPaneForSessionSwitch: () => {},
    stopConversationTitleEditForOtherSession: () => {},
    clearSelectionState: () => {},
    detachConversation: async () => {},
    conversationById: () => undefined,
    noteGitActivity: () => {},
    startConversation: async () => {},
    attachConversation: async () => {},
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    markSessionUnavailable: () => {},
    schedulePtyResizeImmediate: () => {},
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  await activation.activateConversation('session-1');
  assert.deepEqual(calls, ['enterActive:session-1', 'markDirty']);
});

void test('runtime conversation activation readies already-active session when switching from home/project pane', async () => {
  const calls: string[] = [];
  const activation = new RuntimeConversationActivation({
    getActiveConversationId: () => 'session-1',
    setActiveConversationId: () => {},
    isConversationPaneMode: () => false,
    enterConversationPaneForActiveSession: (sessionId) => {
      calls.push(`enterActive:${sessionId}`);
    },
    enterConversationPaneForSessionSwitch: () => {},
    stopConversationTitleEditForOtherSession: () => {},
    clearSelectionState: () => {},
    detachConversation: async () => {},
    conversationById: () => ({
      directoryId: 'directory-1',
      live: false,
      status: 'running',
    }),
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    startConversation: async (sessionId) => {
      calls.push(`start:${sessionId}`);
    },
    attachConversation: async (sessionId) => {
      calls.push(`attach:${sessionId}`);
    },
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    markSessionUnavailable: () => {
      calls.push('markUnavailable');
    },
    schedulePtyResizeImmediate: () => {
      calls.push('resize');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  await activation.activateConversation('session-1');

  assert.deepEqual(calls, [
    'start:session-1',
    'attach:session-1',
    'enterActive:session-1',
    'noteGit:directory-1',
    'resize',
    'markDirty',
  ]);
});

void test('runtime conversation activation switches session and retries attach on recoverable errors', async () => {
  const calls: string[] = [];
  const conversations = new Map<string, ConversationRecord>([
    ['session-2', { directoryId: 'directory-2', live: false, status: 'running' }],
  ]);
  let activeSessionId: string | null = 'session-1';
  let attachAttempts = 0;

  const activation = new RuntimeConversationActivation({
    getActiveConversationId: () => activeSessionId,
    setActiveConversationId: (sessionId) => {
      activeSessionId = sessionId;
      calls.push(`setActive:${sessionId}`);
    },
    isConversationPaneMode: () => false,
    enterConversationPaneForActiveSession: () => {},
    enterConversationPaneForSessionSwitch: (sessionId) => {
      calls.push(`enterSwitch:${sessionId}`);
    },
    stopConversationTitleEditForOtherSession: (sessionId) => {
      calls.push(`stopTitle:${sessionId}`);
    },
    clearSelectionState: () => {
      calls.push('clearSelection');
    },
    detachConversation: async (sessionId) => {
      calls.push(`detach:${sessionId}`);
    },
    conversationById: (sessionId) => conversations.get(sessionId),
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    startConversation: async (sessionId) => {
      calls.push(`start:${sessionId}`);
    },
    attachConversation: async (sessionId) => {
      attachAttempts += 1;
      calls.push(`attach:${sessionId}:${attachAttempts}`);
      if (attachAttempts === 1) {
        const error = new Error('session not found');
        throw error;
      }
    },
    isSessionNotFoundError: (error) =>
      error instanceof Error && error.message === 'session not found',
    isSessionNotLiveError: () => false,
    markSessionUnavailable: (sessionId) => {
      calls.push(`markUnavailable:${sessionId}`);
    },
    schedulePtyResizeImmediate: () => {
      calls.push('resize');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  await activation.activateConversation('session-2');

  assert.equal(activeSessionId, 'session-2');
  assert.deepEqual(calls, [
    'stopTitle:session-2',
    'clearSelection',
    'detach:session-1',
    'start:session-2',
    'attach:session-2:1',
    'markUnavailable:session-2',
    'start:session-2',
    'attach:session-2:2',
    'setActive:session-2',
    'enterSwitch:session-2',
    'noteGit:directory-2',
    'resize',
    'markDirty',
  ]);
});

void test('runtime conversation activation does not commit session switch when aborted mid-flight', async () => {
  const calls: string[] = [];
  let activeSessionId: string | null = 'session-1';
  let releaseAttach = (): void => {};
  const attachPromise = new Promise<void>((resolve) => {
    releaseAttach = () => {
      resolve();
    };
  });
  const controller = new AbortController();

  const activation = new RuntimeConversationActivation({
    getActiveConversationId: () => activeSessionId,
    setActiveConversationId: (sessionId) => {
      activeSessionId = sessionId;
      calls.push(`setActive:${sessionId}`);
    },
    isConversationPaneMode: () => false,
    enterConversationPaneForActiveSession: () => {},
    enterConversationPaneForSessionSwitch: (sessionId) => {
      calls.push(`enterSwitch:${sessionId}`);
    },
    stopConversationTitleEditForOtherSession: (sessionId) => {
      calls.push(`stopTitle:${sessionId}`);
    },
    clearSelectionState: () => {
      calls.push('clearSelection');
    },
    detachConversation: async (sessionId) => {
      calls.push(`detach:${sessionId}`);
    },
    conversationById: () => ({
      directoryId: 'directory-2',
      live: true,
      status: 'running',
    }),
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    startConversation: async (sessionId) => {
      calls.push(`start:${sessionId}`);
    },
    attachConversation: async (sessionId) => {
      calls.push(`attach:${sessionId}`);
      await attachPromise;
    },
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    markSessionUnavailable: () => {
      calls.push('markUnavailable');
    },
    schedulePtyResizeImmediate: () => {
      calls.push('resize');
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  const activationPromise = activation.activateConversation('session-2', {
    signal: controller.signal,
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  controller.abort();
  releaseAttach();
  await activationPromise;

  assert.equal(activeSessionId, 'session-1');
  assert.deepEqual(calls, [
    'stopTitle:session-2',
    'clearSelection',
    'detach:session-1',
    'attach:session-2',
  ]);
});

void test('runtime conversation activation rethrows non-recoverable attach errors', async () => {
  const activation = new RuntimeConversationActivation({
    getActiveConversationId: () => null,
    setActiveConversationId: () => {},
    isConversationPaneMode: () => false,
    enterConversationPaneForActiveSession: () => {},
    enterConversationPaneForSessionSwitch: () => {},
    stopConversationTitleEditForOtherSession: () => {},
    clearSelectionState: () => {},
    detachConversation: async () => {},
    conversationById: () => ({
      directoryId: null,
      live: true,
      status: 'running',
    }),
    noteGitActivity: () => {},
    startConversation: async () => {},
    attachConversation: async () => {
      throw new Error('boom');
    },
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    markSessionUnavailable: () => {},
    schedulePtyResizeImmediate: () => {},
    markDirty: () => {},
  });

  await assert.rejects(async () => {
    await activation.activateConversation('session-x');
  }, /boom/);
});
