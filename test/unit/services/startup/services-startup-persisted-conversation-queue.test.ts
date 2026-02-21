import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { StartupPersistedConversationQueueService } from '../../../../src/services/startup-persisted-conversation-queue.ts';

interface ConversationRecord {
  live: boolean;
}

void test('startup persisted conversation queue service enqueues only non-live non-active conversations', async () => {
  const conversations = new Map<string, ConversationRecord>([
    ['session-active', { live: false }],
    ['session-live', { live: true }],
    ['session-background', { live: false }],
    ['session-background-2', { live: false }],
  ]);
  const calls: string[] = [];
  const tasks: Array<() => Promise<void>> = [];
  const service = new StartupPersistedConversationQueueService<ConversationRecord>({
    orderedConversationIds: () => [
      'session-active',
      'session-live',
      'session-missing',
      'session-background',
      'session-background-2',
    ],
    conversationById: (sessionId) => conversations.get(sessionId),
    queueBackgroundOp: (task, label) => {
      calls.push(`queued:${label}`);
      tasks.push(task);
    },
    startConversation: async (sessionId) => {
      calls.push(`start:${sessionId}`);
      conversations.set(sessionId, { live: true });
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  const queued = service.queuePersistedConversationsInBackground('session-active');
  assert.equal(queued, 2);
  assert.deepEqual(calls, [
    'queued:background-start:session-background',
    'queued:background-start:session-background-2',
  ]);

  await tasks[0]?.();
  await tasks[1]?.();
  assert.deepEqual(calls, [
    'queued:background-start:session-background',
    'queued:background-start:session-background-2',
    'start:session-background',
    'markDirty',
    'start:session-background-2',
    'markDirty',
  ]);
});

void test('startup persisted conversation queue service rechecks live state before starting queued task', async () => {
  const conversations = new Map<string, ConversationRecord>([
    ['session-background', { live: false }],
  ]);
  const calls: string[] = [];
  let queuedTask: (() => Promise<void>) | null = null;
  const service = new StartupPersistedConversationQueueService<ConversationRecord>({
    orderedConversationIds: () => ['session-background'],
    conversationById: (sessionId) => conversations.get(sessionId),
    queueBackgroundOp: (task, label) => {
      calls.push(`queued:${label}`);
      queuedTask = task;
    },
    startConversation: async (sessionId) => {
      calls.push(`start:${sessionId}`);
    },
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  const queued = service.queuePersistedConversationsInBackground(null);
  assert.equal(queued, 1);
  conversations.set('session-background', { live: true });
  const capturedTask = queuedTask as (() => Promise<void>) | null;
  if (capturedTask === null) {
    throw new Error('expected queued task to be captured');
  }
  await capturedTask();
  assert.deepEqual(calls, ['queued:background-start:session-background']);
});

void test('startup persisted conversation queue service returns zero when nothing is queueable', () => {
  const service = new StartupPersistedConversationQueueService<ConversationRecord>({
    orderedConversationIds: () => [],
    conversationById: () => undefined,
    queueBackgroundOp: () => {},
    startConversation: async () => {},
    markDirty: () => {},
  });
  assert.equal(service.queuePersistedConversationsInBackground('session-any'), 0);
});
