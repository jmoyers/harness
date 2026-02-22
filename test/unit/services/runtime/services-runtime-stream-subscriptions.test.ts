import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeStreamSubscriptions } from '../../../../src/services/runtime-stream-subscriptions.ts';

void test('runtime stream subscriptions swallows recoverable conversation subscribe/unsubscribe errors', async () => {
  const calls: string[] = [];
  const subscriptions = new RuntimeStreamSubscriptions({
    subscribePtyEvents: async (sessionId) => {
      calls.push(`subscribePtyEvents:${sessionId}`);
      throw new Error('not found');
    },
    unsubscribePtyEvents: async (sessionId) => {
      calls.push(`unsubscribePtyEvents:${sessionId}`);
      throw new Error('not live');
    },
    isSessionNotFoundError: (error) => error instanceof Error && error.message === 'not found',
    isSessionNotLiveError: (error) => error instanceof Error && error.message === 'not live',
    subscribeObservedStream: async () => 'subscription-1',
    unsubscribeObservedStream: async () => {},
  });

  await subscriptions.subscribeConversationEvents('session-1');
  await subscriptions.unsubscribeConversationEvents('session-1');

  assert.deepEqual(calls, ['subscribePtyEvents:session-1', 'unsubscribePtyEvents:session-1']);
});

void test('runtime stream subscriptions rethrows non-recoverable conversation subscribe/unsubscribe errors', async () => {
  const subscriptions = new RuntimeStreamSubscriptions({
    subscribePtyEvents: async () => {
      throw new Error('boom-subscribe');
    },
    unsubscribePtyEvents: async () => {
      throw new Error('boom-unsubscribe');
    },
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    subscribeObservedStream: async () => 'subscription-1',
    unsubscribeObservedStream: async () => {},
  });

  await assert.rejects(async () => {
    await subscriptions.subscribeConversationEvents('session-2');
  }, /boom-subscribe/);
  await assert.rejects(async () => {
    await subscriptions.unsubscribeConversationEvents('session-2');
  }, /boom-unsubscribe/);
});

void test('runtime stream subscriptions de-dupes task-planning subscribe and clears id on unsubscribe', async () => {
  const calls: string[] = [];
  const subscriptions = new RuntimeStreamSubscriptions({
    subscribePtyEvents: async () => {},
    unsubscribePtyEvents: async () => {},
    isSessionNotFoundError: () => false,
    isSessionNotLiveError: () => false,
    subscribeObservedStream: async (afterCursor) => {
      calls.push(`subscribeObservedStream:${afterCursor}`);
      return 'subscription-42';
    },
    unsubscribeObservedStream: async (subscriptionId) => {
      calls.push(`unsubscribeObservedStream:${subscriptionId}`);
    },
  });

  await subscriptions.subscribeTaskPlanningEvents(123);
  await subscriptions.subscribeTaskPlanningEvents(456);
  await subscriptions.unsubscribeTaskPlanningEvents();
  await subscriptions.unsubscribeTaskPlanningEvents();

  assert.deepEqual(calls, [
    'subscribeObservedStream:123',
    'unsubscribeObservedStream:subscription-42',
  ]);
});
