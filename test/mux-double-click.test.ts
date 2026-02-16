import assert from 'node:assert/strict';
import test from 'node:test';
import { detectConversationDoubleClick, detectEntityDoubleClick } from '../src/mux/double-click.ts';

void test('entity double click detector requires same entity id within window', () => {
  const first = detectEntityDoubleClick(null, 'task-a', 1_000, 350);
  assert.equal(first.doubleClick, false);
  assert.deepEqual(first.nextState, {
    entityId: 'task-a',
    atMs: 1_000
  });

  const second = detectEntityDoubleClick(first.nextState, 'task-a', 1_200, 350);
  assert.equal(second.doubleClick, true);
  assert.equal(second.nextState, null);
});

void test('conversation double click detector requires same conversation id within window', () => {
  const first = detectConversationDoubleClick(null, 'conversation-a', 1_000, 350);
  assert.equal(first.doubleClick, false);
  assert.deepEqual(first.nextState, {
    conversationId: 'conversation-a',
    atMs: 1_000
  });

  const second = detectConversationDoubleClick(first.nextState, 'conversation-a', 1_200, 350);
  assert.equal(second.doubleClick, true);
  assert.equal(second.nextState, null);
});

void test('conversation double click detector rejects stale mismatched and regressed timestamps', () => {
  const stale = detectConversationDoubleClick(
    {
      conversationId: 'conversation-a',
      atMs: 1_000
    },
    'conversation-a',
    1_400,
    350
  );
  assert.equal(stale.doubleClick, false);
  assert.deepEqual(stale.nextState, {
    conversationId: 'conversation-a',
    atMs: 1_400
  });

  const mismatched = detectConversationDoubleClick(
    {
      conversationId: 'conversation-a',
      atMs: 1_000
    },
    'conversation-b',
    1_150,
    350
  );
  assert.equal(mismatched.doubleClick, false);
  assert.deepEqual(mismatched.nextState, {
    conversationId: 'conversation-b',
    atMs: 1_150
  });

  const regressedClock = detectConversationDoubleClick(
    {
      conversationId: 'conversation-a',
      atMs: 1_000
    },
    'conversation-a',
    900,
    350
  );
  assert.equal(regressedClock.doubleClick, false);
  assert.deepEqual(regressedClock.nextState, {
    conversationId: 'conversation-a',
    atMs: 900
  });
});
