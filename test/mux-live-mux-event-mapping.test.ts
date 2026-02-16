import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isConversationNotFoundError,
  isSessionNotFoundError,
  isSessionNotLiveError,
  mapSessionEventToNormalizedEvent,
  mapTerminalOutputToNormalizedEvent,
  normalizeExitCode,
  observedAtFromSessionEvent
} from '../src/mux/live-mux/event-mapping.ts';
import type { EventScope } from '../src/events/normalized-events.ts';
import type { StreamSessionEvent } from '../src/control-plane/stream-protocol.ts';

const scope: EventScope = {
  tenantId: 'tenant',
  userId: 'user',
  workspaceId: 'workspace',
  worktreeId: 'worktree',
  conversationId: 'conversation',
  turnId: 'turn-1'
};

const scopeNoTurn: EventScope = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  workspaceId: scope.workspaceId,
  worktreeId: scope.worktreeId,
  conversationId: scope.conversationId
};

void test('normalizeExitCode prefers explicit code then signal fallback', () => {
  assert.equal(normalizeExitCode({ code: 0, signal: null }), 0);
  assert.equal(normalizeExitCode({ code: null, signal: 'SIGTERM' }), 128);
  assert.equal(normalizeExitCode({ code: null, signal: null }), 1);
});

void test('session and conversation error detectors match expected messages only', () => {
  assert.equal(isSessionNotFoundError(new Error('Session not found')), true);
  assert.equal(isSessionNotFoundError(new Error('other')), false);
  assert.equal(isSessionNotFoundError('bad'), false);

  assert.equal(isSessionNotLiveError(new Error('session is not live yet')), true);
  assert.equal(isSessionNotLiveError(new Error('other')), false);
  assert.equal(isSessionNotLiveError(42), false);

  assert.equal(isConversationNotFoundError(new Error('conversation not found')), true);
  assert.equal(isConversationNotFoundError(new Error('other')), false);
  assert.equal(isConversationNotFoundError(null), false);
});

void test('mapTerminalOutputToNormalizedEvent emits provider text delta event', () => {
  const event = mapTerminalOutputToNormalizedEvent(Buffer.from('hello', 'utf8'), scope, () => 'event-1');

  assert.equal(event.eventId, 'event-1');
  assert.equal(event.source, 'provider');
  assert.equal(event.type, 'provider-text-delta');
  assert.equal(event.payload.kind, 'text-delta');
  assert.equal(event.payload.delta, 'hello');

  const noTurnEvent = mapTerminalOutputToNormalizedEvent(
    Buffer.from('hi', 'utf8'),
    scopeNoTurn,
    () => 'event-1b'
  );
  assert.equal(noTurnEvent.payload.kind, 'text-delta');
  if (noTurnEvent.payload.kind !== 'text-delta') {
    assert.fail('expected text-delta payload');
  }
  assert.equal(noTurnEvent.payload.turnId, 'turn-live');
});

void test('mapSessionEventToNormalizedEvent emits attention clear for session-exit', () => {
  const mapped = mapSessionEventToNormalizedEvent(
    {
      type: 'session-exit',
      exit: {
        code: 0,
        signal: null
      }
    },
    scope,
    () => 'event-2'
  );
  assert.equal(mapped?.eventId, 'event-2');
  assert.equal(mapped?.source, 'meta');
  assert.equal(mapped?.type, 'meta-attention-cleared');

  const mappedNoTurn = mapSessionEventToNormalizedEvent(
    {
      type: 'session-exit',
      exit: {
        code: null,
        signal: 'SIGTERM'
      }
    },
    scopeNoTurn,
    () => 'event-2b'
  );
  assert.equal(mappedNoTurn?.payload.kind, 'attention');
  if (mappedNoTurn?.payload.kind !== 'attention') {
    assert.fail('expected attention payload');
  }
  assert.equal(mappedNoTurn.payload.turnId, 'turn-live');

  const unmapped = mapSessionEventToNormalizedEvent(
    {
      type: 'notify',
      record: {
        ts: '2026-01-01T00:00:00.000Z',
        payload: {}
      }
    },
    scope,
    () => 'event-3'
  );
  assert.equal(unmapped, null);
});

void test('observedAtFromSessionEvent prefers notify timestamp and falls back to now', () => {
  const fromNotify = observedAtFromSessionEvent({
    type: 'notify',
    record: {
      ts: '2026-01-01T00:00:00.000Z',
      payload: {}
    }
  } satisfies StreamSessionEvent);
  assert.equal(fromNotify, '2026-01-01T00:00:00.000Z');

  const fromMissingTs = observedAtFromSessionEvent({
    type: 'notify',
    record: {
      ts: 42 as unknown as string,
      payload: {}
    }
  } as unknown as StreamSessionEvent);
  assert.match(fromMissingTs, /^\d{4}-\d{2}-\d{2}T/);

  const fromMalformedRecord = observedAtFromSessionEvent({
    type: 'notify',
    record: 'invalid' as unknown as { ts: string; payload: Record<string, unknown> }
  });
  assert.match(fromMalformedRecord, /^\d{4}-\d{2}-\d{2}T/);

  const fromExit = observedAtFromSessionEvent({
    type: 'session-exit',
    exit: {
      code: null,
      signal: 'SIGTERM'
    }
  });
  assert.match(fromExit, /^\d{4}-\d{2}-\d{2}T/);
});
