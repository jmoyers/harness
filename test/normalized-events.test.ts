import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createNormalizedEvent,
  type EventScope
} from '../src/events/normalized-events.ts';

const baseScope: EventScope = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  worktreeId: 'worktree-1',
  conversationId: 'conversation-1'
};

void test('createNormalizedEvent uses defaults when no clock or id factory are provided', () => {
  const event = createNormalizedEvent('provider', 'provider-thread-started', baseScope, {
    kind: 'thread',
    threadId: 'thread-1'
  });

  assert.equal(event.schemaVersion, '1');
  assert.equal(typeof event.eventId, 'string');
  assert.equal(event.eventId.length > 0, true);
  assert.equal(event.source, 'provider');
  assert.equal(event.type, 'provider-thread-started');
  assert.equal(event.scope.conversationId, 'conversation-1');
  assert.equal(event.payload.kind, 'thread');
  assert.equal(Number.isNaN(Date.parse(event.ts)), false);
});

void test('createNormalizedEvent respects deterministic clock and id factory', () => {
  let idCounter = 0;
  const event = createNormalizedEvent(
    'meta',
    'meta-attention-raised',
    {
      ...baseScope,
      turnId: 'turn-1'
    },
    {
      kind: 'attention',
      threadId: 'thread-1',
      turnId: 'turn-1',
      reason: 'approval',
      detail: 'item/commandExecution/requestApproval'
    },
    () => new Date('2026-02-14T00:00:00.000Z'),
    () => {
      idCounter += 1;
      return `event-${idCounter}`;
    }
  );

  assert.equal(event.eventId, 'event-1');
  assert.equal(event.ts, '2026-02-14T00:00:00.000Z');
  assert.equal(event.scope.turnId, 'turn-1');
  assert.equal(event.type, 'meta-attention-raised');
  assert.equal(event.payload.kind, 'attention');
});
